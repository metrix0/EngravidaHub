// lib/ai/assistantDataTools.ts
import { supabase } from "@/lib";
import {
    FINANCIAL_CATEGORIES,
    getFinancialCategoryLabel,
} from "@/lib/invoices/categories";
import {
    findDoctorBySourceName,
    type DoctorReference,
} from "@/lib/invoices/matchDoctor";
import { getPaidMediaOverview } from "@/lib/ai/assistantPaidMediaTool";
import { summarizeFirstHumanResponseTimes } from "@/lib/ai/assistantMetrics";
import {
    applyAssistantUnitScope,
    type AssistantToolContext,
    unitRestrictedToolOutput,
} from "@/lib/ai/assistantToolContext";
import {
    getScheduleStatusFlags,
    getScheduleStatusLabel,
    normalizeScheduleStatus,
    resolveScheduleStatusFilters,
    scheduleShowedUp,
    type ScheduleStatusGroup,
} from "@/lib/schedules/status";
import type {
    AssistantCard,
    AssistantClientCardData,
    AssistantConversationCardData,
} from "@/types/assistant";

type ToolExecution = {
    output: unknown;
    cards: AssistantCard[];
};

type JsonRecord = Record<string, unknown>;

const MAX_ANALYTICS_ROWS = 25_000;
const MAX_FINANCIAL_ROWS = 25_000;
const ANALYTICS_PAGE_SIZE = 1_000;
const TIME_ZONE = "America/Sao_Paulo";
const MIN_ANALYSIS_CONFIDENCE = 0.7;
const SCHEDULED_CONVERSATION_STATES = new Set([
    "scheduled",
    "rescheduled",
    "confirmed_attendance",
]);

type ScheduleSearchRow = {
    id: string;
    client_id: string | null;
    scheduled_for: string;
    created_in_source_at: string | null;
    patient_name: string | null;
    phone: string | null;
    unit_name: string | null;
    attendant_name: string | null;
    procedure_name: string | null;
    status: string | null;
};

type FinancialInvoiceRow = {
    source_invoice_id: number | string;
    issued_at: string;
    amount: number | string;
    category: string;
    status: string;
    unit_id: string | null;
    unit_name: string | null;
    doctor_id: string | null;
    doctor_name: string | null;
    patient_code: number | string | null;
    client_id: string | null;
    updated_at: string;
    doctors: DoctorReference | DoctorReference[] | null;
    clients:
        | { last_origin: string | null; last_tunnel: string | null }
        | Array<{ last_origin: string | null; last_tunnel: string | null }>
        | null;
};

export async function executeAssistantDataTool(
    name: string,
    rawArguments: unknown,
    context: AssistantToolContext,
): Promise<ToolExecution> {
    const args = applyAssistantUnitScope(
        isRecord(rawArguments) ? rawArguments : {},
        context,
    );

    switch (name) {
        case "search_clients":
            return searchClients(args, context.unitLock?.id ?? null);
        case "get_client_context":
            return getClientContext(args, context.unitLock?.id ?? null);
        case "search_appointments":
            return searchAppointments(args, context.unitLock?.id ?? null);
        case "get_schedule_overview":
            return getScheduleOverview(args);
        case "search_conversations":
            return searchConversations(args);
        case "get_conversation_context":
            return getConversationContext(args, context.unitLock?.id ?? null);
        case "get_conversation_analysis_overview":
            return getConversationAnalysisOverview(args);
        case "analyze_unit_performance":
            return analyzeUnitPerformance(args, Boolean(context.unitLock));
        case "compare_unit_performance":
            if (context.unitLock) {
                return unitRestrictedToolOutput(
                    context,
                    "A comparação entre unidades",
                );
            }
            return compareUnitPerformance(args);
        case "get_business_overview":
            if (context.unitLock) {
                return unitRestrictedToolOutput(
                    context,
                    "A visão geral do negócio",
                );
            }
            return getBusinessOverview(args);
        case "get_financial_overview":
            return getFinancialOverview(args);
        case "get_paid_media_overview":
            if (context.unitLock) {
                return unitRestrictedToolOutput(
                    context,
                    "A visão de mídia paga",
                );
            }
            return getPaidMediaOverview(args);
        default:
            return {
                output: { ok: false, error: `Unknown tool: ${name}` },
                cards: [],
            };
    }
}

async function searchClients(
    args: JsonRecord,
    unitId: string | null,
): Promise<ToolExecution> {
    const query = stringArg(args, "query");
    const limit = integerArg(args, "limit", 8, 1, 25);

    if (!query || query.length < 2) {
        return {
            output: {
                ok: false,
                error: "Informe pelo menos 2 caracteres para buscar um cliente.",
            },
            cards: [],
        };
    }

    const filters = buildClientSearchFilters(query);
    if (filters.length === 0) {
        return { output: { ok: true, matches: [] }, cards: [] };
    }

    let clientQuery = supabase
        .from("clients")
        .select(`
            id,
            name,
            phone,
            email,
            city,
            state,
            last_interaction_at,
            units (id, name),
            funnel_stages (
                id,
                name,
                funnels (id, name)
            )
        `)
        .or(filters.join(","));

    if (unitId) clientQuery = clientQuery.eq("unit_id", unitId);

    const { data, error } = await clientQuery
        .order("last_interaction_at", {
            ascending: false,
            nullsFirst: false,
        })
        .limit(limit);

    if (error) throw new Error(`Falha ao buscar clientes: ${error.message}`);

    const matches = (data ?? []).map((row) => {
        const unit = relationOne(row.units);
        const stage = relationOne(row.funnel_stages);
        const funnel = relationOne(stage?.funnels);

        return {
            id: row.id,
            name: row.name ?? "Cliente sem nome",
            phone: row.phone ?? null,
            email: row.email ?? null,
            city: row.city ?? null,
            state: row.state ?? null,
            unit_name: unit?.name ?? null,
            funnel_name: funnel?.name ?? null,
            stage_name: stage?.name ?? null,
            last_interaction_at: row.last_interaction_at ?? null,
        };
    });

    return {
        output: {
            ok: true,
            matches,
            note:
                matches.length > 1
                    ? "Há mais de um resultado. Confirme o cliente correto com get_client_context."
                    : "Use get_client_context para confirmar agenda e histórico.",
        },
        cards: [],
    };
}

async function getClientContext(
    args: JsonRecord,
    unitId: string | null,
): Promise<ToolExecution> {
    const clientId = stringArg(args, "client_id");

    if (!clientId) {
        return {
            output: { ok: false, error: "client_id is required" },
            cards: [],
        };
    }

    const context = await loadClientContext(clientId, unitId);

    if (!context) {
        return {
            output: { ok: false, error: "Cliente não encontrado." },
            cards: [],
        };
    }

    return {
        output: {
            ok: true,
            client: context.client,
            upcoming_appointments: context.upcomingAppointments,
            schedule_history: context.scheduleHistory,
            open_thread: context.openThread,
            recent_conversations: context.recentConversations,
        },
        cards: [{ type: "client", data: context.card }],
    };
}

async function searchAppointments(
    args: JsonRecord,
    unitId: string | null,
): Promise<ToolExecution> {
    const query = stringArg(args, "query");
    const doctorName = stringArg(args, "doctor_name");
    const unitName = stringArg(args, "unit_name");
    const startDate = stringArg(args, "start_date");
    const endDate = stringArg(args, "end_date");
    const futureOnly = booleanArg(args, "future_only", !startDate);
    const statuses = stringArrayArg(args, "statuses");
    const limit = integerArg(args, "limit", 20, 1, 50);

    let databaseQuery = supabase
        .from("schedules")
        .select(
            "id, client_id, scheduled_for, created_in_source_at, patient_name, phone, unit_name, attendant_name, procedure_name, status",
            { count: "exact" },
        )
        .order("scheduled_for", { ascending: true })
        .limit(limit);

    const effectiveStartDate = startDate ?? (futureOnly ? todayInBrazil() : null);
    if (effectiveStartDate) {
        databaseQuery = databaseQuery.gte("scheduled_for", effectiveStartDate);
    }
    if (endDate) {
        databaseQuery = databaseQuery.lte("scheduled_for", endDate);
    }
    if (unitName) {
        databaseQuery = databaseQuery.ilike(
            "unit_name",
            unitId
                ? sanitizePostgrestText(unitName)
                : `%${sanitizePostgrestText(unitName)}%`,
        );
    }

    const scheduleStatuses = resolveScheduleStatusFilters(statuses);
    if (scheduleStatuses.length > 0) {
        databaseQuery = databaseQuery.in(
            "status",
            [...new Set(scheduleStatuses)],
        );
    }

    if (query) {
        const safeText = sanitizePostgrestText(query);
        const digits = query.replace(/\D/g, "");
        const filters: string[] = [];

        if (safeText) {
            filters.push(`patient_name.ilike.%${safeText}%`);
            filters.push(`unit_name.ilike.%${safeText}%`);
            filters.push(`procedure_name.ilike.%${safeText}%`);
            filters.push(`attendant_name.ilike.%${safeText}%`);
        }
        if (digits.length >= 3) {
            filters.push(`phone.ilike.%${digits}%`);
        }
        if (filters.length > 0) databaseQuery = databaseQuery.or(filters.join(","));
    }

    const { data, error, count } = await databaseQuery;
    if (error) throw new Error(`Falha ao buscar agendamentos: ${error.message}`);

    const schedules = (data ?? []) as unknown as ScheduleSearchRow[];
    const appointments = schedules.map((row) => {
        const statusFlags = getScheduleStatusFlags(row.status);

        return {
            id: row.id,
            client_id: row.client_id,
            patient_name: row.patient_name,
            patient_phone: row.phone,
            scheduled_for: row.scheduled_for,
            starts_at: `${row.scheduled_for}T00:00:00-03:00`,
            ends_at: null,
            status: row.status,
            ...statusFlags,
            status_field: "agenda_chegou",
            procedure_name: row.procedure_name,
            attendant_name: row.attendant_name,
            doctor: null,
            unit: row.unit_name ? { name: row.unit_name } : null,
            source: "schedules",
        };
    });

    const uniqueClientIds: string[] = [
        ...new Set<string>(
            appointments
                .map((appointment) => appointment.client_id)
                .filter((value): value is string => typeof value === "string"),
        ),
    ];

    const cards: AssistantCard[] = [];
    if (uniqueClientIds.length === 1) {
        const card = await loadClientCard(uniqueClientIds[0], unitId);
        if (card) cards.push({ type: "client", data: card });
    }

    const publicAppointments = appointments.map((appointment) => ({
        patient_name: appointment.patient_name,
        patient_phone: appointment.patient_phone,
        scheduled_for: appointment.scheduled_for,
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        status: appointment.status,
        status_group: appointment.status_group,
        status_label: appointment.status_label,
        cancelled: appointment.cancelled,
        showed_up: appointment.showed_up,
        completed: appointment.completed,
        no_show: appointment.no_show,
        rescheduled: appointment.rescheduled,
        pending: appointment.pending,
        status_field: appointment.status_field,
        procedure_name: appointment.procedure_name,
        attendant_name: appointment.attendant_name,
        unit: appointment.unit,
        source: appointment.source,
    }));

    return {
        output: {
            ok: true,
            appointments: publicAppointments,
            total_returned: publicAppointments.length,
            total_matches: count ?? publicAppointments.length,
            source: "schedules",
            current_time: new Date().toISOString(),
            note: doctorName
                ? "A agenda importada não possui campo de médico; a busca priorizou os registros da agenda do CliniSys."
                : "O status vem de agenda_chegou: Não = pendente, Sim = chegou, Em Atendimento = compareceu e está em atendimento, Atendido = concluído, Faltou = não compareceu, Desmarcou = cancelado e Remarcou = remarcado.",
        },
        cards,
    };
}

type ScheduleOverviewRow = {
    id: string;
    scheduled_for: string;
    unit_name: string | null;
    status: string | null;
};

type ScheduleOverviewTotals = {
    total: number;
    pending: number;
    arrived: number;
    in_service: number;
    attended: number;
    showed_up: number;
    cancelled: number;
    no_show: number;
    rescheduled: number;
    unknown: number;
};

async function getScheduleOverview(
    args: JsonRecord,
): Promise<ToolExecution> {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const requestedDateFrom =
        requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const requestedDateTo =
        requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const today = todayInBrazil();
    const includeFuture = booleanArg(args, "include_future", false);
    const crossesToday =
        requestedDateFrom <= today && requestedDateTo > today;
    const dateFrom = requestedDateFrom;
    const dateTo =
        crossesToday && !includeFuture ? today : requestedDateTo;
    const requestedUnitName = stringArg(args, "unit_name");
    const unit = requestedUnitName
        ? await resolveSingleUnit(requestedUnitName)
        : null;

    if (requestedUnitName && !unit) {
        return {
            output: {
                ok: true,
                period: {
                    date_from: dateFrom,
                    date_to: dateTo,
                    requested_date_to: requestedDateTo,
                    future_included: dateTo > today,
                },
                totals: emptyScheduleOverviewTotals(),
                note: `Unidade “${requestedUnitName}” não encontrada.`,
            },
            cards: [],
        };
    }

    const rows = await loadScheduleOverviewRows({
        dateFrom,
        dateTo,
        unitName: unit?.name ?? null,
    });
    const totals = emptyScheduleOverviewTotals();
    const outcomeEligibleTotals = emptyScheduleOverviewTotals();
    const daily = new Map(
        dateKeysBetween(dateFrom, dateTo).map((date) => [
            date,
            {
                date,
                total: 0,
                showed_up: 0,
                cancelled: 0,
                no_show: 0,
                rescheduled: 0,
                pending: 0,
            },
        ]),
    );
    const byUnit = new Map<string, ScheduleOverviewTotals>();
    const rawStatuses = new Map<string, number>();

    for (const row of rows) {
        const group = normalizeScheduleStatus(row.status);
        incrementScheduleOverviewTotals(totals, group);
        if (row.scheduled_for <= today) {
            incrementScheduleOverviewTotals(outcomeEligibleTotals, group);
        }

        const day = daily.get(row.scheduled_for);
        if (day) {
            day.total += 1;
            if (scheduleShowedUp(group)) day.showed_up += 1;
            if (group === "cancelled") day.cancelled += 1;
            if (group === "no_show") day.no_show += 1;
            if (group === "rescheduled") day.rescheduled += 1;
            if (group === "pending") day.pending += 1;
        }

        const unitName = row.unit_name?.trim() || "Sem unidade";
        const unitTotals = byUnit.get(unitName) ?? emptyScheduleOverviewTotals();
        incrementScheduleOverviewTotals(unitTotals, group);
        byUnit.set(unitName, unitTotals);

        const rawStatus = row.status?.trim() || "Sem status";
        rawStatuses.set(rawStatus, (rawStatuses.get(rawStatus) ?? 0) + 1);
    }

    const attendanceObserved =
        outcomeEligibleTotals.showed_up + outcomeEligibleTotals.no_show;
    const resolvedOutcomes =
        outcomeEligibleTotals.showed_up +
        outcomeEligibleTotals.no_show +
        outcomeEligibleTotals.cancelled +
        outcomeEligibleTotals.rescheduled;

    return {
        output: {
            ok: true,
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                requested_date_to: requestedDateTo,
                future_included: dateTo > today,
                date_field: "scheduled_for",
                timezone: TIME_ZONE,
            },
            unit: unit ? { name: unit.name } : null,
            totals,
            rates: {
                attendance_rate_observed: rateOrNull(
                    outcomeEligibleTotals.showed_up,
                    attendanceObserved,
                ),
                cancellation_rate_all_schedules: rateOrNull(
                    outcomeEligibleTotals.cancelled,
                    outcomeEligibleTotals.total,
                ),
                cancellation_rate_resolved_outcomes: rateOrNull(
                    outcomeEligibleTotals.cancelled,
                    resolvedOutcomes,
                ),
                outcome_coverage_rate: rateOrNull(
                    resolvedOutcomes,
                    outcomeEligibleTotals.total,
                ),
            },
            rates_basis: {
                through_date:
                    dateFrom > today
                        ? null
                        : dateTo < today
                          ? dateTo
                          : today,
                schedules: outcomeEligibleTotals.total,
                future_schedules_excluded:
                    totals.total - outcomeEligibleTotals.total,
            },
            status_distribution: [...rawStatuses.entries()]
                .map(([status, count]) => ({ status, count }))
                .sort((first, second) => second.count - first.count),
            daily: [...daily.values()],
            by_unit: [...byUnit.entries()]
                .map(([unitName, values]) => ({
                    unit_name: unitName,
                    ...values,
                    percentage: rateOrNull(values.total, totals.total),
                }))
                .sort(
                    (first, second) =>
                        second.total - first.total ||
                        first.unit_name.localeCompare(
                            second.unit_name,
                            "pt-BR",
                        ),
                ),
            metric_definitions: {
                showed_up:
                    "Compareceu: soma de Sim, Em Atendimento e Atendido.",
                attended: "Atendimento concluído: status Atendido.",
                cancelled: "Consulta cancelada: status Desmarcou.",
                no_show: "Não compareceu: status Faltou.",
                rescheduled: "Consulta remarcada: status Remarcou.",
                pending:
                    "Status Não: agenda pendente ou sem desfecho registrado; nunca significa automaticamente falta.",
                attendance_rate_observed:
                    "Compareceu dividido por Compareceu + Faltou; pendentes, cancelados e remarcados ficam fora.",
                cancellation_rate_all_schedules:
                    "Cancelados divididos pelos agendamentos não futuros do período.",
                outcome_coverage_rate:
                    "Desfechos divididos somente pelos agendamentos não futuros; datas futuras ficam fora.",
            },
            truncated: rows.length >= MAX_ANALYTICS_ROWS,
        },
        cards: [],
    };
}

async function loadScheduleOverviewRows({
    dateFrom,
    dateTo,
    unitName,
}: {
    dateFrom: string;
    dateTo: string;
    unitName: string | null;
}) {
    const rows: ScheduleOverviewRow[] = [];

    for (
        let offset = 0;
        offset < MAX_ANALYTICS_ROWS;
        offset += ANALYTICS_PAGE_SIZE
    ) {
        let query = supabase
            .from("schedules")
            .select("id, scheduled_for, unit_name, status")
            .gte("scheduled_for", dateFrom)
            .lte("scheduled_for", dateTo)
            .order("scheduled_for", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);

        if (unitName) query = query.ilike("unit_name", unitName);

        const { data, error } = await query;
        if (error) {
            throw new Error(
                `Falha ao carregar situação dos agendamentos: ${error.message}`,
            );
        }

        const page = (data ?? []) as ScheduleOverviewRow[];
        rows.push(...page);
        if (page.length < ANALYTICS_PAGE_SIZE) break;
    }

    return rows;
}

function emptyScheduleOverviewTotals(): ScheduleOverviewTotals {
    return {
        total: 0,
        pending: 0,
        arrived: 0,
        in_service: 0,
        attended: 0,
        showed_up: 0,
        cancelled: 0,
        no_show: 0,
        rescheduled: 0,
        unknown: 0,
    };
}

function incrementScheduleOverviewTotals(
    totals: ScheduleOverviewTotals,
    group: ScheduleStatusGroup,
) {
    totals.total += 1;
    totals[group] += 1;
    if (scheduleShowedUp(group)) totals.showed_up += 1;
}

function rateOrNull(value: number, total: number) {
    return total > 0 ? Math.round((value / total) * 10_000) / 100 : null;
}

async function searchConversations(args: JsonRecord): Promise<ToolExecution> {
    const query = stringArg(args, "query");
    const clientId = stringArg(args, "client_id");
    const unitName = stringArg(args, "unit_name");
    const dateFrom = stringArg(args, "date_from");
    const dateTo = stringArg(args, "date_to");
    const finalState = stringArg(args, "final_state");
    const goalStatus = stringArg(args, "goal_status");
    const dropoffOnly = booleanArg(args, "dropoff_only", false);
    const limit = integerArg(args, "limit", 12, 1, 30);

    let clientIds: string[] | null = clientId ? [clientId] : null;

    if (unitName) {
        const unit = await resolveSingleUnit(unitName);

        if (!unit) {
            return {
                output: {
                    ok: true,
                    conversations: [],
                    note: `Unidade “${unitName}” não encontrada.`,
                },
                cards: [],
            };
        }

        clientIds = await loadClientIdsForUnit(unit.id, 500);
    } else if (query) {
        const matches = await searchClientIds(query, 100);
        if (matches.length > 0) clientIds = matches;
    }

    let conversationQuery = supabase
        .from("conversations")
        .select(`
            id,
            client_id,
            started_at,
            ended_at,
            source,
            tunnel,
            origin,
            attendant_chat_name,
            last_message_text,
            conversation_analysis_id
        `)
        .eq("channel", "WhatsApp")
        .order("started_at", { ascending: false })
        .limit(500);

    if (clientIds) {
        if (clientIds.length === 0) {
            return {
                output: { ok: true, conversations: [] },
                cards: [],
            };
        }

        conversationQuery = conversationQuery.in("client_id", clientIds);
    }

    if (dateFrom) {
        conversationQuery = conversationQuery.gte(
            "started_at",
            brazilDayBoundary(dateFrom),
        );
    }

    if (dateTo) {
        conversationQuery = conversationQuery.lt(
            "started_at",
            brazilDayBoundary(addDays(dateTo, 1)),
        );
    }

    const { data: conversationRows, error: conversationError } =
        await conversationQuery;

    if (conversationError) {
        throw new Error(
            `Falha ao buscar conversas: ${conversationError.message}`,
        );
    }

    const rows = conversationRows ?? [];
    const clientIdList: string[] = [
        ...new Set<string>(
            rows
                .map((row) => row.client_id)
                .filter((value): value is string => typeof value === "string"),
        ),
    ];
    const analysisIds: string[] = [
        ...new Set<string>(
            rows
                .map((row) => row.conversation_analysis_id)
                .filter((value): value is string => Boolean(value)),
        ),
    ];

    const [clients, analyses] = await Promise.all([
        loadClientsByIds(clientIdList),
        loadAnalysesByIds(analysisIds),
    ]);

    const normalizedTerm = query?.toLocaleLowerCase("pt-BR") ?? "";

    const conversations = rows
        .map((row) => {
            const client = clients.get(row.client_id);
            const analysis = row.conversation_analysis_id
                ? analyses.get(row.conversation_analysis_id)
                : null;

            return {
                id: row.id,
                client_id: row.client_id,
                client_name: client?.name ?? "Cliente sem nome",
                unit_name: client?.unit_name ?? null,
                started_at: row.started_at,
                ended_at: row.ended_at,
                attendant_name: row.attendant_chat_name ?? null,
                source: row.source,
                tunnel: row.tunnel ?? null,
                origin: row.origin ?? null,
                preview: row.last_message_text ?? null,
                analysis,
            };
        })
        .filter((item) => {
            if (dropoffOnly && !item.analysis?.dropoff_happened) return false;
            if (
                finalState &&
                item.analysis?.customer_final_state !== finalState
            ) {
                return false;
            }
            if (goalStatus && item.analysis?.goal_status !== goalStatus) {
                return false;
            }

            if (!normalizedTerm || clientIds) return true;

            const searchable = [
                item.client_name,
                item.unit_name,
                item.preview,
                item.analysis?.short_label,
                item.analysis?.notable_reason,
                item.analysis?.dropoff_likely_reason,
                item.analysis?.conversation_goal,
                item.analysis?.customer_final_state,
            ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase("pt-BR");

            return searchable.includes(normalizedTerm);
        })
        .slice(0, limit);

    return {
        output: {
            ok: true,
            conversations,
            total_returned: conversations.length,
            note:
                "Para citar uma conversa como evidência e exibir o card, use get_conversation_context.",
        },
        cards: [],
    };
}

async function getConversationContext(
    args: JsonRecord,
    unitId: string | null,
): Promise<ToolExecution> {
    const conversationId = stringArg(args, "conversation_id");

    if (!conversationId) {
        return {
            output: { ok: false, error: "conversation_id is required" },
            cards: [],
        };
    }

    const context = await loadConversationContext(conversationId, unitId);

    if (!context) {
        return {
            output: { ok: false, error: "Conversa não encontrada." },
            cards: [],
        };
    }

    return {
        output: {
            ok: true,
            conversation: context.conversation,
            analysis: context.analysis,
            transcript: context.transcript,
            transcript_truncated: context.transcriptTruncated,
        },
        cards: [{ type: "conversation", data: context.card }],
    };
}

async function getConversationAnalysisOverview(
    args: JsonRecord,
): Promise<ToolExecution> {
    const relativeDays = integerArg(args, "relative_days", 0, 0, 365);
    const today = todayInBrazil();
    const requestedFrom =
        relativeDays > 0
            ? addDays(today, 1 - relativeDays)
            : validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo =
        relativeDays > 0
            ? today
            : validDateArg(args, "date_to") ?? today;
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const unitName = stringArg(args, "unit_name");
    const includeExample = booleanArg(args, "include_example", true);
    const unit = unitName ? await resolveSingleUnit(unitName) : null;

    if (unitName && !unit) {
        return {
            output: {
                ok: true,
                period: { date_from: dateFrom, date_to: dateTo },
                channel: "WhatsApp",
                unit: null,
                note: `Unidade “${unitName}” não encontrada.`,
            },
            cards: [],
        };
    }

    const [rows, conversationCoverage] = await Promise.all([
        loadAnalysisRows({
            dateFrom,
            dateTo,
            unitId: unit?.id,
            channel: "WhatsApp",
        }),
        countWhatsAppConversations({
            dateFrom,
            dateTo,
            unitId: unit?.id,
        }),
    ]);
    const scheduledRows = rows.filter(isScheduledConversationOutcome);
    const notScheduledRows = rows.filter(
        (row) => !isScheduledConversationOutcome(row),
    );
    const rowsWithObjections = notScheduledRows.filter(hasTypedObjection);
    const highConfidenceObjectionRows = notScheduledRows.filter(
        hasHighConfidenceTypedObjection,
    );
    const lowConfidenceObjectionRows = notScheduledRows.filter(
        hasLowConfidenceTypedObjection,
    );
    const dropoffRows = notScheduledRows.filter(
        (row) => row.dropoff_happened === true,
    );
    const highConfidenceDropoffRows = dropoffRows.filter((row) =>
        hasHighAnalysisConfidence(row.dropoff_confidence),
    );
    const metrics = calculateAnalysisMetrics(rows);
    const cards: AssistantCard[] = [];

    if (includeExample) {
        const evidenceRows =
            rowsWithObjections.length > 0
                ? rowsWithObjections
                : notScheduledRows;
        const conversationId = selectRepresentativeConversations(
            evidenceRows,
            1,
        )[0];

        if (conversationId) {
            const context = await loadConversationContext(
                conversationId,
                unit?.id ?? null,
            );
            if (context) cards.push({ type: "conversation", data: context.card });
        }
    }

    const coverageNote = conversationCoverage.error
        ? conversationCoverage.error
        : rows.length >= MAX_ANALYTICS_ROWS
          ? `A leitura atingiu o limite de ${MAX_ANALYTICS_ROWS.toLocaleString("pt-BR")} análises; refine o período para precisão total.`
          : "Todas as análises disponíveis no período foram lidas.";

    return {
        output: {
            ok: true,
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            channel: "WhatsApp",
            unit: unit ? { name: unit.name } : null,
            classification: {
                source: "Análise automática das conversas",
                confidence_threshold: MIN_ANALYSIS_CONFIDENCE,
                providers: topValues(
                    rows.map((row) => row.analysis_provider),
                    5,
                ),
                prompt_versions: topValues(
                    rows.map((row) => row.analysis_prompt_version),
                    5,
                ),
            },
            coverage: {
                total_conversations: conversationCoverage.count,
                analyzed_conversations: rows.length,
                analysis_coverage_rate:
                    conversationCoverage.count === null
                        ? null
                        : percentage(rows.length, conversationCoverage.count),
                capped: rows.length >= MAX_ANALYTICS_ROWS,
                note: coverageNote,
            },
            outcomes: {
                scheduled_or_confirmed_conversations: scheduledRows.length,
                not_scheduled_conversations: notScheduledRows.length,
                scheduling_or_confirmation_rate: percentage(
                    scheduledRows.length,
                    rows.length,
                ),
                goal_achievement_rate: metrics.goal_achievement_rate,
            },
            non_scheduling: {
                conversations: notScheduledRows.length,
                conversations_with_objections: rowsWithObjections.length,
                high_confidence_conversations_with_objections:
                    highConfidenceObjectionRows.length,
                low_confidence_conversations_with_objections:
                    lowConfidenceObjectionRows.length,
                objection_coverage_rate: percentage(
                    rowsWithObjections.length,
                    notScheduledRows.length,
                ),
                unresolved_objection_conversations: notScheduledRows.filter(
                    hasUnresolvedObjection,
                ).length,
                dropoffs: dropoffRows.length,
                high_confidence_dropoffs:
                    highConfidenceDropoffRows.length,
                low_or_unrated_confidence_dropoffs:
                    dropoffRows.length - highConfidenceDropoffRows.length,
                dropoff_rate: percentage(
                    dropoffRows.length,
                    notScheduledRows.length,
                ),
                top_objections: summarizeConversationObjections(
                    notScheduledRows,
                ),
                top_high_confidence_objections:
                    summarizeConversationObjections(
                        notScheduledRows,
                        "high",
                    ),
                top_low_confidence_objections:
                    summarizeConversationObjections(
                        notScheduledRows,
                        "low",
                    ),
                top_dropoff_moments: labeledTopValues(
                    dropoffRows.map((row) => row.dropoff_moment),
                    dropoffMomentLabel,
                    10,
                ),
                top_dropoff_reasons: topValues(
                    dropoffRows.map((row) => row.dropoff_likely_reason),
                    12,
                ),
            },
            quality: {
                resolution_rate: metrics.resolution_rate,
                average_satisfaction_score:
                    metrics.average_satisfaction_score,
                average_attendant_quality_score:
                    metrics.average_attendant_quality_score,
                average_first_human_response_seconds:
                    metrics.average_first_human_response_seconds,
                raw_average_first_human_response_seconds:
                    metrics.raw_average_first_human_response_seconds,
                median_first_human_response_seconds:
                    metrics.median_first_human_response_seconds,
                p90_first_human_response_seconds:
                    metrics.p90_first_human_response_seconds,
                first_human_response_observed:
                    metrics.first_human_response_observed,
                first_human_response_included_in_average:
                    metrics.first_human_response_included_in_average,
                first_human_response_excluded_over_2h:
                    metrics.first_human_response_excluded_over_2h,
                first_human_response_normalization:
                    metrics.normalization_rule,
                average_human_response_seconds:
                    metrics.average_human_response_seconds,
            },
            data_notes: [
                `Objeções, abandono e sentimento são classificações automáticas; alta confiança significa valor maior ou igual a ${MIN_ANALYSIS_CONFIDENCE}.`,
                "Não agendamento exclui os estados agendado, reagendado e presença confirmada.",
                "Percentuais de objeção usam como base as conversas analisadas sem agendamento; uma conversa pode conter mais de uma objeção.",
            ],
        },
        cards,
    };
}

async function analyzeUnitPerformance(
    args: JsonRecord,
    restrictedToUnit = false,
): Promise<ToolExecution> {
    const unitName = stringArg(args, "unit_name");
    const dateFrom = stringArg(args, "date_from") ?? dateDaysAgo(30);
    const dateTo = stringArg(args, "date_to") ?? todayInBrazil();

    if (!unitName) {
        return {
            output: { ok: false, error: "unit_name is required" },
            cards: [],
        };
    }

    const unit = await resolveSingleUnit(unitName);

    if (!unit) {
        return {
            output: {
                ok: true,
                unit: null,
                note: `Unidade “${unitName}” não encontrada.`,
            },
            cards: [],
        };
    }

    const [unitRows, appointments] = await Promise.all([
        loadAnalysisRows({ dateFrom, dateTo, unitId: unit.id }),
        loadUnitAppointments(unit.id, dateFrom, dateTo),
    ]);
    const allRows = restrictedToUnit
        ? null
        : await loadAnalysisRows({ dateFrom, dateTo });

    const unitMetrics = calculateAnalysisMetrics(unitRows);
    const overallMetrics = allRows ? calculateAnalysisMetrics(allRows) : null;
    const representativeIds = selectRepresentativeConversations(unitRows, 1);
    const cards: AssistantCard[] = [];

    for (const conversationId of representativeIds.slice(0, 1)) {
        const context = await loadConversationContext(conversationId, unit.id);

        if (context) {
            cards.push({
                type: "conversation",
                data: context.card,
            });
        }
    }

    return {
        output: {
            ok: true,
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            unit: { name: unit.name },
            metrics: unitMetrics,
            overall_benchmark: overallMetrics,
            differences: overallMetrics
                ? compareMetrics(unitMetrics, overallMetrics)
                : null,
            appointments: summarizeAppointments(appointments),
            data_notes: [
                ...(restrictedToUnit
                    ? [
                          "O benchmark geral não foi consultado porque este acesso está restrito à unidade.",
                      ]
                    : []),
                "A unidade das conversas é derivada de clients.unit_id, pois conversations.unit_id não está preenchido de forma confiável.",
                allRows
                    ? `Foram consideradas ${unitRows.length} análises da unidade e ${allRows.length} análises no benchmark geral.`
                    : `Foram consideradas ${unitRows.length} análises da unidade.`,
            ],
        },
        cards,
    };
}

async function compareUnitPerformance(
    args: JsonRecord,
): Promise<ToolExecution> {
    const dateFrom = stringArg(args, "date_from") ?? dateDaysAgo(30);
    const dateTo = stringArg(args, "date_to") ?? todayInBrazil();
    const minimumConversations = integerArg(
        args,
        "minimum_conversations",
        20,
        1,
        10_000,
    );

    const rows = await loadAnalysisRows({ dateFrom, dateTo });

    const grouped = new Map<
        string,
        {
            unit_id: string;
            unit_name: string;
            rows: AnalysisRow[];
        }
    >();

    for (const row of rows) {
        if (!row.unit_id || !row.unit_name) continue;

        const current = grouped.get(row.unit_id) ?? {
            unit_id: row.unit_id,
            unit_name: row.unit_name,
            rows: [],
        };

        current.rows.push(row);
        grouped.set(row.unit_id, current);
    }

    const units = [...grouped.values()]
        .map((group) => ({
            unit_name: group.unit_name,
            ...calculateAnalysisMetrics(group.rows),
        }))
        .filter((unit) => unit.analyzed_conversations >= minimumConversations)
        .sort(
            (first, second) =>
                second.scheduled_rate - first.scheduled_rate ||
                first.dropoff_rate - second.dropoff_rate,
        );

    return {
        output: {
            ok: true,
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            units,
            note:
                rows.length >= MAX_ANALYTICS_ROWS
                    ? `Resultado limitado às ${MAX_ANALYTICS_ROWS} análises mais recentes.`
                    : null,
        },
        cards: [],
    };
}

async function getBusinessOverview(
    args: JsonRecord,
): Promise<ToolExecution> {
    const dateFrom = stringArg(args, "date_from") ?? dateDaysAgo(30);
    const dateTo = stringArg(args, "date_to") ?? todayInBrazil();
    const fromIso = brazilDayBoundary(dateFrom);
    const toIso = brazilDayBoundary(addDays(dateTo, 1));

    const [
        clientsResult,
        conversationsResult,
        analysesResult,
        appointmentsScheduledResult,
        appointmentsCreatedResult,
        openThreadsResult,
        activeMessagesResult,
        followupsResult,
    ] = await Promise.all([
        supabase
            .from("clients")
            .select("id", { count: "exact", head: true })
            .gte("created_at", fromIso)
            .lt("created_at", toIso),
        supabase
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .eq("channel", "WhatsApp")
            .gte("started_at", fromIso)
            .lt("started_at", toIso),
        supabase
            .from("conversation_analysis")
            .select("id", { count: "exact", head: true })
            .not("client_id", "is", null)
            .gte("started_at", fromIso)
            .lt("started_at", toIso),
        supabase
            .from("schedules")
            .select("id", { count: "exact", head: true })
            .gte("scheduled_for", dateFrom)
            .lte("scheduled_for", dateTo),
        supabase
            .from("schedules")
            .select("id", { count: "exact", head: true })
            .gte("created_in_source_at", dateFrom)
            .lte("created_in_source_at", dateTo),
        supabase
            .from("thread")
            .select("id", { count: "exact", head: true })
            .eq("channel", "WhatsApp")
            .eq("status", "open"),
        supabase
            .from("active_message_sends")
            .select("id", { count: "exact", head: true })
            .gte("created_at", fromIso)
            .lt("created_at", toIso),
        supabase
            .from("followups")
            .select("ticket_id", { count: "exact", head: true })
            .gte("storage_date", fromIso)
            .lt("storage_date", toIso),
    ]);

    const metricResults = [
        { metric: "new_clients", result: clientsResult },
        { metric: "conversations", result: conversationsResult },
        { metric: "analyzed_conversations", result: analysesResult },
        {
            metric: "appointments_scheduled_for_period",
            result: appointmentsScheduledResult,
        },
        {
            metric: "appointments_created",
            result: appointmentsCreatedResult,
        },
        { metric: "currently_open_threads", result: openThreadsResult },
        { metric: "active_messages_sent", result: activeMessagesResult },
        { metric: "followups_created", result: followupsResult },
    ];

    const warnings: Array<{ metric: string; error: string }> = metricResults
        .filter(({ result }) => Boolean(result.error))
        .map(({ metric, result }) => ({
            metric,
            error:
                result.error?.message?.trim() ||
                "Falha desconhecida ao consultar esta métrica.",
        }));

    let unitPerformance: unknown[] = [];
    let scheduleLifecycle: unknown = null;

    try {
        const overview = await getScheduleOverview({
            date_from: dateFrom,
            date_to: dateTo,
            unit_name: null,
        });
        const overviewOutput = isRecord(overview.output)
            ? overview.output
            : {};

        scheduleLifecycle = {
            totals: overviewOutput.totals ?? null,
            rates: overviewOutput.rates ?? null,
            status_distribution:
                overviewOutput.status_distribution ?? null,
        };
    } catch (error) {
        warnings.push({
            metric: "schedule_lifecycle",
            error:
                error instanceof Error && error.message.trim()
                    ? error.message
                    : "Não foi possível carregar cancelamentos e comparecimento.",
        });
    }

    try {
        const comparison = await compareUnitPerformance({
            date_from: dateFrom,
            date_to: dateTo,
            minimum_conversations: 1,
        });
        const comparisonOutput = isRecord(comparison.output)
            ? comparison.output
            : {};

        if (comparisonOutput.ok === false) {
            warnings.push({
                metric: "unit_performance",
                error:
                    typeof comparisonOutput.error === "string" &&
                    comparisonOutput.error.trim()
                        ? comparisonOutput.error
                        : "Não foi possível comparar o desempenho das unidades.",
            });
        } else {
            unitPerformance = Array.isArray(comparisonOutput.units)
                ? comparisonOutput.units
                : [];
        }
    } catch (error) {
        warnings.push({
            metric: "unit_performance",
            error:
                error instanceof Error && error.message.trim()
                    ? error.message
                    : "Não foi possível comparar o desempenho das unidades.",
        });
    }

    const countOrNull = (result: {
        count: number | null;
        error: { message?: string } | null;
    }) => (result.error ? null : (result.count ?? 0));

    return {
        output: {
            ok: true,
            partial_data: warnings.length > 0,
            warnings,
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            totals: {
                new_clients: countOrNull(clientsResult),
                conversations: countOrNull(conversationsResult),
                analyzed_conversations: countOrNull(analysesResult),

                // "appointments" is kept for backward compatibility and means
                // imported CliniSys schedules whose scheduled date falls inside the period.
                appointments: countOrNull(appointmentsScheduledResult),
                appointments_scheduled_for_period: countOrNull(
                    appointmentsScheduledResult,
                ),

                // Use this field for sales/bookings made during the period.
                appointments_created: countOrNull(appointmentsCreatedResult),

                currently_open_threads: countOrNull(openThreadsResult),
                active_messages_sent: countOrNull(activeMessagesResult),
                followups_created: countOrNull(followupsResult),
            },
            metric_definitions: {
                appointments_scheduled_for_period:
                    "Consultas cuja data marcada acontece dentro do período.",
                appointments_created:
                    "Agendamentos criados dentro do período; use como referência para vendas/agendamentos realizados.",
                followups_created:
                    "Follow-ups registrados pela data de armazenamento dentro do período.",
                currently_open_threads:
                    "Total atual de conversas abertas; não é limitado pelo período.",
            },
            schedule_lifecycle: scheduleLifecycle,
            unit_performance: unitPerformance,
        },
        cards: [],
    };
}

async function getFinancialOverview(
    args: JsonRecord,
): Promise<ToolExecution> {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const unitName = stringArg(args, "unit_name");
    const doctorName = stringArg(args, "doctor_name");
    const requestedCategories = stringArrayArg(args, "categories");
    const categories = resolveFinancialCategories(requestedCategories);

    const [unit, doctors] = await Promise.all([
        unitName ? resolveSingleUnit(unitName) : Promise.resolve(null),
        loadFinancialDoctors(),
    ]);

    if (unitName && !unit) {
        return {
            output: {
                ok: true,
                period: { date_from: dateFrom, date_to: dateTo },
                totals: emptyFinancialTotals(),
                note: `Unidade “${unitName}” não encontrada.`,
            },
            cards: [],
        };
    }

    const rows = await loadFinancialInvoices({
        dateFrom,
        dateTo,
        unitId: unit?.id ?? null,
        categories,
    });
    const requestedDoctor = doctorName
        ? resolveRequestedDoctor(doctorName, doctors)
        : null;
    const filteredRows = doctorName
        ? rows.filter((invoice) =>
              financialInvoiceMatchesDoctor(
                  invoice,
                  doctorName,
                  requestedDoctor,
                  doctors,
              ),
          )
        : rows;
    const authorized = filteredRows.filter(
        (invoice) => financialStatusGroup(invoice.status) === "authorized",
    );
    const cancelled = filteredRows.filter(
        (invoice) => financialStatusGroup(invoice.status) === "cancelled",
    );
    const authorizedRevenue = financialSum(authorized);
    const cancelledAmount = financialSum(cancelled);
    const finalInvoices = authorized.length + cancelled.length;
    const linkedAuthorized = authorized.filter((invoice) => invoice.client_id);
    const linkedRevenue = financialSum(linkedAuthorized);
    const resolvedDoctors = authorized.filter((invoice) =>
        financialDoctor(invoice, doctors),
    );
    const lastSyncedAt = filteredRows.reduce<string | null>(
        (latest, invoice) =>
            !latest || invoice.updated_at > latest
                ? invoice.updated_at
                : latest,
        null,
    );

    return {
        output: {
            ok: true,
            source: "NFS-e do CliniSys",
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            filters: {
                unit_name: unit?.name ?? null,
                doctor_name:
                    requestedDoctor?.name ?? doctorName ?? null,
                categories: categories.map(getFinancialCategoryLabel),
            },
            totals: {
                authorized_revenue: financialMoney(authorizedRevenue),
                authorized_invoices: authorized.length,
                average_ticket:
                    authorized.length > 0
                        ? financialMoney(
                              authorizedRevenue / authorized.length,
                          )
                        : null,
                billed_patients: new Set(
                    authorized.map(financialPatientKey),
                ).size,
                cancelled_amount: financialMoney(cancelledAmount),
                cancelled_invoices: cancelled.length,
                cancellation_rate: financialPercentage(
                    cancelled.length,
                    finalInvoices,
                ),
            },
            by_status: financialStatusBreakdown(filteredRows),
            by_category: financialCategoryBreakdown(authorized),
            by_unit: financialUnitBreakdown(authorized),
            by_doctor: financialDoctorBreakdown(authorized, doctors),
            by_origin: financialOriginBreakdown(authorized),
            evolution: financialEvolution(filteredRows),
            coverage: {
                invoices_with_client: linkedAuthorized.length,
                linked_revenue: financialMoney(linkedRevenue),
                linked_revenue_percentage: financialPercentage(
                    linkedRevenue,
                    authorizedRevenue,
                ),
                invoices_with_configured_doctor: resolvedDoctors.length,
                configured_doctor_percentage: financialPercentage(
                    resolvedDoctors.length,
                    authorized.length,
                ),
            },
            audit: {
                invoices_read: filteredRows.length,
                last_synced_at: lastSyncedAt,
                truncated: rows.length >= MAX_FINANCIAL_ROWS,
            },
            metric_definitions: {
                authorized_revenue:
                    "Soma das NFS-e autorizadas; não representa recebimento, caixa ou lucro.",
                cancellation_rate:
                    "Notas canceladas divididas por autorizadas mais canceladas.",
                average_ticket:
                    "Faturamento autorizado dividido pelas notas autorizadas.",
            },
        },
        cards: [],
    };
}

async function loadFinancialInvoices({
    dateFrom,
    dateTo,
    unitId,
    categories,
}: {
    dateFrom: string;
    dateTo: string;
    unitId: string | null;
    categories: string[];
}) {
    const rows: FinancialInvoiceRow[] = [];

    for (
        let offset = 0;
        offset < MAX_FINANCIAL_ROWS;
        offset += ANALYTICS_PAGE_SIZE
    ) {
        let query = supabase
            .from("clinisys_invoices")
            .select(`
                source_invoice_id,
                issued_at,
                amount,
                category,
                status,
                unit_id,
                unit_name,
                doctor_id,
                doctor_name,
                patient_code,
                client_id,
                updated_at,
                doctors!clinisys_invoices_doctor_id_fkey (id, name),
                clients!clinisys_invoices_client_id_fkey (
                    last_origin,
                    last_tunnel
                )
            `)
            .gte("issued_at", brazilDayBoundary(dateFrom))
            .lt("issued_at", brazilDayBoundary(addDays(dateTo, 1)))
            .order("issued_at", { ascending: true })
            .order("source_invoice_id", { ascending: true })
            .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);

        if (unitId) query = query.eq("unit_id", unitId);
        if (categories.length > 0) {
            query = query.in("category", categories);
        }

        const { data, error } = await query;
        if (error) {
            throw new Error(
                `Falha ao carregar faturamento: ${error.message}`,
            );
        }

        const page = (data ?? []) as unknown as FinancialInvoiceRow[];
        rows.push(...page);
        if (page.length < ANALYTICS_PAGE_SIZE) break;
    }

    return rows;
}

async function loadFinancialDoctors() {
    const { data, error } = await supabase
        .from("doctors")
        .select("id, name")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) {
        throw new Error(`Falha ao carregar médicos: ${error.message}`);
    }

    return (data ?? []) as DoctorReference[];
}

function resolveRequestedDoctor(
    requestedName: string,
    doctors: DoctorReference[],
) {
    const matched = findDoctorBySourceName(requestedName, doctors);
    if (matched) return matched;

    const requested = financialNormalizeText(requestedName);
    const matches = doctors.filter((doctor) => {
        const name = financialNormalizeText(doctor.name);
        return name.includes(requested) || requested.includes(name);
    });

    return matches.length === 1 ? matches[0] : null;
}

function financialInvoiceMatchesDoctor(
    invoice: FinancialInvoiceRow,
    requestedName: string,
    requestedDoctor: DoctorReference | null,
    doctors: DoctorReference[],
) {
    const doctor = financialDoctor(invoice, doctors);
    if (requestedDoctor) return doctor?.id === requestedDoctor.id;

    const requested = financialNormalizeText(requestedName);
    return [doctor?.name, invoice.doctor_name]
        .map(financialNormalizeText)
        .some((name) => name.includes(requested));
}

function financialDoctor(
    invoice: FinancialInvoiceRow,
    doctors: DoctorReference[],
) {
    return (
        relationOne(invoice.doctors) ??
        findDoctorBySourceName(invoice.doctor_name, doctors)
    );
}

function financialStatusBreakdown(rows: FinancialInvoiceRow[]) {
    const statuses = [
        ["authorized", "Autorizadas"],
        ["cancelled", "Canceladas"],
        ["pending", "Pendentes"],
        ["denied", "Negadas"],
        ["other", "Outros"],
    ] as const;

    return statuses
        .map(([status, label]) => {
            const matching = rows.filter(
                (invoice) => financialStatusGroup(invoice.status) === status,
            );
            return {
                status,
                label,
                invoices: matching.length,
                amount: financialMoney(financialSum(matching)),
                percentage: financialPercentage(matching.length, rows.length),
            };
        })
        .filter((item) => item.invoices > 0);
}

function financialCategoryBreakdown(rows: FinancialInvoiceRow[]) {
    const totalRevenue = financialSum(rows);
    const groups = groupFinancialRows(rows, (invoice) => invoice.category);

    return [...groups.entries()]
        .map(([category, invoices]) => {
            const revenue = financialSum(invoices);
            return {
                category: getFinancialCategoryLabel(category),
                invoices: invoices.length,
                revenue: financialMoney(revenue),
                average_ticket: invoices.length
                    ? financialMoney(revenue / invoices.length)
                    : null,
                percentage: financialPercentage(revenue, totalRevenue),
            };
        })
        .sort((first, second) => second.revenue - first.revenue)
        .slice(0, 10);
}

function financialUnitBreakdown(rows: FinancialInvoiceRow[]) {
    const groups = groupFinancialRows(
        rows,
        (invoice) => invoice.unit_name?.trim() || "Sem unidade",
    );

    return [...groups.entries()]
        .map(([unitName, invoices]) => {
            const revenue = financialSum(invoices);
            return {
                unit_name: unitName,
                invoices: invoices.length,
                revenue: financialMoney(revenue),
                average_ticket: invoices.length
                    ? financialMoney(revenue / invoices.length)
                    : null,
                patients: new Set(invoices.map(financialPatientKey)).size,
            };
        })
        .sort((first, second) => second.revenue - first.revenue)
        .slice(0, 15);
}

function financialDoctorBreakdown(
    rows: FinancialInvoiceRow[],
    doctors: DoctorReference[],
) {
    const groups = new Map<
        string,
        { doctor_name: string; invoices: FinancialInvoiceRow[] }
    >();

    for (const invoice of rows) {
        const doctor = financialDoctor(invoice, doctors);
        const doctorName =
            doctor?.name ?? invoice.doctor_name?.trim() ?? "Sem médico";
        const key = doctor?.id ?? `source:${financialNormalizeText(doctorName)}`;
        const group = groups.get(key) ?? { doctor_name: doctorName, invoices: [] };
        group.invoices.push(invoice);
        groups.set(key, group);
    }

    return [...groups.values()]
        .map((group) => {
            const revenue = financialSum(group.invoices);
            return {
                doctor_name: group.doctor_name,
                invoices: group.invoices.length,
                revenue: financialMoney(revenue),
                average_ticket: group.invoices.length
                    ? financialMoney(revenue / group.invoices.length)
                    : null,
            };
        })
        .sort((first, second) => second.revenue - first.revenue)
        .slice(0, 15);
}

function financialOriginBreakdown(rows: FinancialInvoiceRow[]) {
    const groups = new Map<string, FinancialInvoiceRow[]>();

    for (const invoice of rows) {
        const origin =
            relationOne(invoice.clients)?.last_origin?.trim() ||
            "Sem origem atribuída";
        const group = groups.get(origin) ?? [];
        group.push(invoice);
        groups.set(origin, group);
    }

    const totalRevenue = financialSum(rows);
    return [...groups.entries()]
        .map(([origin, invoices]) => {
            const revenue = financialSum(invoices);
            return {
                origin,
                invoices: invoices.length,
                revenue: financialMoney(revenue),
                percentage: financialPercentage(revenue, totalRevenue),
            };
        })
        .sort((first, second) => second.revenue - first.revenue)
        .slice(0, 10);
}

function financialEvolution(rows: FinancialInvoiceRow[]) {
    const groups = new Map<
        string,
        { authorized_revenue: number; cancelled_amount: number; invoices: number }
    >();

    for (const invoice of rows) {
        const date = saoPauloDateKey(invoice.issued_at);
        const group = groups.get(date) ?? {
            authorized_revenue: 0,
            cancelled_amount: 0,
            invoices: 0,
        };
        const status = financialStatusGroup(invoice.status);

        if (status === "authorized") {
            group.authorized_revenue += financialAmount(invoice.amount);
            group.invoices += 1;
        } else if (status === "cancelled") {
            group.cancelled_amount += financialAmount(invoice.amount);
        }

        groups.set(date, group);
    }

    return [...groups.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .slice(-120)
        .map(([date, values]) => ({
            date,
            authorized_revenue: financialMoney(values.authorized_revenue),
            cancelled_amount: financialMoney(values.cancelled_amount),
            authorized_invoices: values.invoices,
        }));
}

function financialStatusGroup(status: string) {
    const normalized = financialNormalizeText(status).replace(/\s+/g, "");

    if (
        normalized.startsWith("autorizada") ||
        normalized.includes("cancelamentonegado") ||
        normalized.includes("cancelamentorejeitado")
    ) {
        return "authorized" as const;
    }
    if (normalized === "cancelada") return "cancelled" as const;
    if (normalized.includes("aguardando")) return "pending" as const;
    if (normalized.includes("negada")) return "denied" as const;
    return "other" as const;
}

function resolveFinancialCategories(values: string[]) {
    const aliases = new Map<string, string>();

    for (const category of FINANCIAL_CATEGORIES) {
        aliases.set(financialNormalizeText(category.value), category.value);
        aliases.set(financialNormalizeText(category.label), category.value);
    }

    return [...new Set(
        values
            .map((value) => aliases.get(financialNormalizeText(value)))
            .filter((value): value is string => Boolean(value)),
    )];
}

function groupFinancialRows(
    rows: FinancialInvoiceRow[],
    keyFor: (row: FinancialInvoiceRow) => string,
) {
    const groups = new Map<string, FinancialInvoiceRow[]>();

    for (const row of rows) {
        const key = keyFor(row);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }

    return groups;
}

function financialPatientKey(invoice: FinancialInvoiceRow) {
    if (invoice.patient_code !== null) return `patient:${invoice.patient_code}`;
    if (invoice.client_id) return `client:${invoice.client_id}`;
    return `invoice:${invoice.source_invoice_id}`;
}

function financialSum(rows: FinancialInvoiceRow[]) {
    return rows.reduce(
        (total, invoice) => total + financialAmount(invoice.amount),
        0,
    );
}

function financialAmount(value: number | string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function financialMoney(value: number) {
    return Math.round(value * 100) / 100;
}

function financialPercentage(value: number, total: number) {
    return total > 0 ? Math.round((value / total) * 10_000) / 100 : null;
}

function financialNormalizeText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function saoPauloDateKey(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(value));
}

function emptyFinancialTotals() {
    return {
        authorized_revenue: 0,
        authorized_invoices: 0,
        average_ticket: null,
        billed_patients: 0,
        cancelled_amount: 0,
        cancelled_invoices: 0,
        cancellation_rate: null,
    };
}

type ClientContext = {
    client: unknown;
    upcomingAppointments: unknown[];
    scheduleHistory: unknown[];
    openThread: unknown;
    recentConversations: unknown[];
    card: AssistantClientCardData;
};

async function loadClientContext(
    clientId: string,
    unitId: string | null = null,
): Promise<ClientContext | null> {
    let clientQuery = supabase
        .from("clients")
        .select(`
            id,
            name,
            phone,
            email,
            cpf,
            birth_date,
            city,
            state,
            country,
            first_seen_at,
            last_interaction_at,
            utm_source,
            utm_medium,
            utm_campaign,
            utm_content,
            utm_term,
            units (
                id,
                name,
                city,
                state
            ),
            funnel_stages (
                id,
                name,
                position,
                color,
                funnels (
                    id,
                    name
                )
            )
        `)
        .eq("id", clientId);

    if (unitId) clientQuery = clientQuery.eq("unit_id", unitId);

    const { data: clientRow, error: clientError } =
        await clientQuery.maybeSingle();

    if (clientError) {
        throw new Error(`Falha ao carregar cliente: ${clientError.message}`);
    }

    if (!clientRow) return null;

    const [schedulesResult, threadResult, conversationResult] =
        await Promise.all([
            supabase
                .from("schedules")
                .select(`
                    id,
                    scheduled_for,
                    status,
                    procedure_name,
                    unit_name,
                    attendant_name
                `)
                .eq("client_id", clientId)
                .gte("scheduled_for", dateDaysAgo(365))
                .order("scheduled_for", { ascending: false })
                .limit(50),
            supabase
                .from("thread")
                .select(`
                    id,
                    status,
                    channel,
                    source,
                    assigned_attendant_id,
                    last_message_text,
                    last_message_at,
                    unread_count
                `)
                .eq("client_id", clientId)
                .eq("status", "open")
                .order("last_message_at", {
                    ascending: false,
                    nullsFirst: false,
                })
                .limit(1)
                .maybeSingle(),
            supabase
                .from("conversations")
                .select(`
                    id,
                    started_at,
                    ended_at,
                    attendant_chat_name,
                    source,
                    tunnel,
                    origin,
                    last_message_text,
                    analysis:conversation_analysis!conversations_conversation_analysis_id_fkey (
                        id,
                        short_label,
                        conversation_goal,
                        goal_status,
                        customer_final_state,
                        resolution_result,
                        dropoff_happened,
                        dropoff_moment,
                        satisfaction_score,
                        attendant_quality_score,
                        notable,
                        notable_reason
                    )
                `)
                .eq("client_id", clientId)
                .order("started_at", { ascending: false })
                .limit(10),
        ]);

    const errors = [
        schedulesResult.error,
        threadResult.error,
        conversationResult.error,
    ].filter(Boolean);

    if (errors.length > 0) {
        throw new Error(
            `Falha ao carregar contexto do cliente: ${errors[0]!.message}`,
        );
    }

    const unit = relationOne(clientRow.units);
    const stage = relationOne(clientRow.funnel_stages);
    const funnel = relationOne(stage?.funnels);
    const scheduleHistory = (schedulesResult.data ?? []).map((row) => {
        return {
            id: row.id,
            scheduled_for: row.scheduled_for,
            starts_at: `${row.scheduled_for}T00:00:00-03:00`,
            ends_at: null,
            status: row.status,
            ...getScheduleStatusFlags(row.status),
            procedure_name: row.procedure_name,
            unit_name: row.unit_name ?? null,
            attendant_name: row.attendant_name ?? null,
        };
    });
    const upcomingAppointments = scheduleHistory
        .filter(
            (appointment) =>
                appointment.scheduled_for >= todayInBrazil() &&
                !appointment.cancelled &&
                !appointment.rescheduled,
        )
        .sort((first, second) =>
            first.scheduled_for.localeCompare(second.scheduled_for),
        );
    const nextAppointment = upcomingAppointments[0] ?? null;

    const card: AssistantClientCardData = {
        id: clientRow.id,
        name: clientRow.name ?? "Cliente sem nome",
        phone: clientRow.phone ?? null,
        email: clientRow.email ?? null,
        city: clientRow.city ?? null,
        state: clientRow.state ?? null,
        unit_name: unit?.name ?? null,
        funnel_name: funnel?.name ?? null,
        stage_name: stage?.name ?? null,
        first_seen_at: clientRow.first_seen_at ?? null,
        last_interaction_at: clientRow.last_interaction_at ?? null,
        utm_source: clientRow.utm_source ?? null,
        utm_campaign: clientRow.utm_campaign ?? null,
        upcoming_appointment_count: upcomingAppointments.length,
        next_appointment: nextAppointment
            ? {
                  id: nextAppointment.id,
                  starts_at: nextAppointment.starts_at,
                  status: nextAppointment.status,
                  procedure_name: nextAppointment.procedure_name,
                  doctor_name: null,
                  attendant_name: nextAppointment.attendant_name,
                  unit_name: nextAppointment.unit_name,
              }
            : null,
    };

    return {
        client: {
            id: clientRow.id,
            name: clientRow.name ?? "Cliente sem nome",
            phone: clientRow.phone ?? null,
            email: clientRow.email ?? null,
            cpf: clientRow.cpf ?? null,
            birth_date: clientRow.birth_date ?? null,
            city: clientRow.city ?? null,
            state: clientRow.state ?? null,
            country: clientRow.country ?? null,
            first_seen_at: clientRow.first_seen_at,
            last_interaction_at: clientRow.last_interaction_at,
            unit: unit
                ? {
                      id: unit.id,
                      name: unit.name,
                      city: unit.city ?? null,
                      state: unit.state ?? null,
                  }
                : null,
            funnel: funnel
                ? { id: funnel.id, name: funnel.name }
                : null,
            stage: stage
                ? {
                      id: stage.id,
                      name: stage.name,
                      position: stage.position,
                  }
                : null,
            attribution: {
                source: clientRow.utm_source ?? null,
                medium: clientRow.utm_medium ?? null,
                campaign: clientRow.utm_campaign ?? null,
                content: clientRow.utm_content ?? null,
                term: clientRow.utm_term ?? null,
            },
        },
        upcomingAppointments,
        scheduleHistory,
        openThread: threadResult.data ?? null,
        recentConversations: (conversationResult.data ?? []).map((row) => ({
            id: row.id,
            started_at: row.started_at,
            ended_at: row.ended_at,
            attendant_name: row.attendant_chat_name ?? null,
            source: row.source,
            tunnel: row.tunnel ?? null,
            origin: row.origin ?? null,
            preview: row.last_message_text ?? null,
            analysis: relationOne(row.analysis),
        })),
        card,
    };
}

async function loadClientCard(
    clientId: string,
    unitId: string | null = null,
): Promise<AssistantClientCardData | null> {
    const context = await loadClientContext(clientId, unitId);
    return context?.card ?? null;
}

type ConversationContext = {
    conversation: unknown;
    analysis: unknown;
    transcript: string;
    transcriptTruncated: boolean;
    card: AssistantConversationCardData;
};

async function loadConversationContext(
    conversationId: string,
    unitId: string | null = null,
): Promise<ConversationContext | null> {
    let conversationQuery = supabase
        .from("conversations")
        .select(`
            id,
            client_id,
            started_at,
            ended_at,
            attendant_chat_name,
            source,
            tunnel,
            origin,
            last_message_text,
            conversation_analysis_id,
            clients!inner (unit_id)
        `)
        .eq("id", conversationId);

    if (unitId) {
        conversationQuery = conversationQuery.eq("clients.unit_id", unitId);
    }

    const { data: conversation, error: conversationError } =
        await conversationQuery.maybeSingle();

    if (conversationError) {
        throw new Error(
            `Falha ao carregar conversa: ${conversationError.message}`,
        );
    }

    if (!conversation) return null;

    const [clientResult, analysisResult, messagesResult, clientCard] = await Promise.all([
        supabase
            .from("clients")
            .select(`
                id,
                name,
                phone,
                email,
                city,
                state,
                units (
                    id,
                    name
                )
            `)
            .eq("id", conversation.client_id)
            .maybeSingle(),
        conversation.conversation_analysis_id
            ? supabase
                  .from("conversation_analysis")
                  .select("*")
                  .eq("id", conversation.conversation_analysis_id)
                  .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        supabase
            .from("messages")
            .select(`
                id,
                sender_type,
                sender_name,
                text,
                sent_at,
                sequence_index
            `)
            .eq("conversation_id", conversationId)
            .order("sent_at", { ascending: true })
            .order("sequence_index", { ascending: true })
            .limit(300),
        loadClientCard(conversation.client_id, unitId),
    ]);

    const errors = [
        clientResult.error,
        analysisResult.error,
        messagesResult.error,
    ].filter(Boolean);

    if (errors.length > 0) {
        throw new Error(
            `Falha ao carregar contexto da conversa: ${errors[0]!.message}`,
        );
    }

    const client = clientResult.data;
    const analysis = analysisResult.data;
    const unit = relationOne(client?.units);
    const messages = messagesResult.data ?? [];
    const cardMessageLimit = 60;
    const cardMessages = messages.slice(-cardMessageLimit);
    const transcriptLines = messages.map((message) => {
        const sender =
            message.sender_name ??
            senderLabel(message.sender_type ?? "unknown");
        const text = cleanMessageText(message.text ?? "").slice(0, 2_000);
        return `[${message.sent_at}] ${sender}: ${text}`;
    });
    const rawTranscript = transcriptLines.join("\n");
    const maxTranscriptChars = 24_000;
    const transcriptTruncated = rawTranscript.length > maxTranscriptChars;
    const transcript = transcriptTruncated
        ? rawTranscript.slice(-maxTranscriptChars)
        : rawTranscript;

    const card: AssistantConversationCardData = {
        id: conversation.id,
        client_id: conversation.client_id,
        client_name: client?.name ?? "Cliente sem nome",
        unit_name: unit?.name ?? null,
        started_at: conversation.started_at,
        ended_at: conversation.ended_at,
        attendant_name: conversation.attendant_chat_name ?? null,
        short_label: analysis?.short_label ?? null,
        conversation_goal: analysis?.conversation_goal ?? null,
        goal_status: analysis?.goal_status ?? null,
        customer_final_state: analysis?.customer_final_state ?? null,
        resolution_result: analysis?.resolution_result ?? null,
        resolution_score: numberOrNull(analysis?.resolution_score),
        dropoff_happened: Boolean(analysis?.dropoff_happened),
        dropoff_moment: analysis?.dropoff_moment ?? null,
        satisfaction_score: numberOrNull(analysis?.satisfaction_score),
        attendant_quality_score: numberOrNull(
            analysis?.attendant_quality_score,
        ),
        notable: Boolean(analysis?.notable),
        notable_reason: analysis?.notable_reason ?? null,
        preview: conversation.last_message_text ?? null,
        client_profile: clientCard,
        messages: cardMessages.map((message) => ({
            sender_type: normalizeSenderType(message.sender_type),
            sender_name: message.sender_name ?? null,
            text: cleanMessageDisplayText(message.text ?? ""),
            sent_at: message.sent_at,
        })),
        messages_truncated: messages.length > cardMessages.length,
    };

    return {
        conversation: {
            client_name: client?.name ?? "Cliente sem nome",
            unit_name: unit?.name ?? null,
            started_at: conversation.started_at,
            ended_at: conversation.ended_at,
            attendant_name: conversation.attendant_chat_name ?? null,
            source: conversation.source,
            tunnel: conversation.tunnel ?? null,
            origin: conversation.origin ?? null,
        },
        analysis,
        transcript,
        transcriptTruncated,
        card,
    };
}

type AnalysisRow = {
    conversation_id: string;
    client_id: string;
    started_at: string;
    customer_start_intent: string | null;
    conversation_goal: string | null;
    goal_status: string | null;
    customer_final_state: string | null;
    objections: unknown;
    dropoff_happened: boolean | null;
    dropoff_moment: string | null;
    dropoff_likely_reason: string | null;
    dropoff_confidence: number | null;
    customer_sentiment: string | null;
    satisfaction_score: number | null;
    sentiment_confidence: number | null;
    attendant_quality_score: number | null;
    first_human_response_time_seconds: number | null;
    average_human_response_time_seconds: number | null;
    resolution_result: string | null;
    resolution_score: number | null;
    short_label: string | null;
    notable: boolean | null;
    notable_reason: string | null;
    analysis_provider: string | null;
    analysis_prompt_version: string | null;
    unit_id: string | null;
    unit_name: string | null;
};

async function loadAnalysisRows({
    dateFrom,
    dateTo,
    unitId,
    channel,
}: {
    dateFrom: string;
    dateTo: string;
    unitId?: string;
    channel?: "WhatsApp";
}) {
    const rows: AnalysisRow[] = [];
    const fromIso = brazilDayBoundary(dateFrom);
    const toIso = brazilDayBoundary(addDays(dateTo, 1));

    for (
        let offset = 0;
        offset < MAX_ANALYTICS_ROWS;
        offset += ANALYTICS_PAGE_SIZE
    ) {
        let query = supabase
            .from("conversation_analysis")
            .select(`
                conversation_id,
                client_id,
                started_at,
                customer_start_intent,
                conversation_goal,
                goal_status,
                customer_final_state,
                objections,
                dropoff_happened,
                dropoff_moment,
                dropoff_likely_reason,
                dropoff_confidence,
                customer_sentiment,
                satisfaction_score,
                sentiment_confidence,
                attendant_quality_score,
                first_human_response_time_seconds,
                average_human_response_time_seconds,
                resolution_result,
                resolution_score,
                short_label,
                notable,
                notable_reason,
                analysis_provider,
                analysis_prompt_version,
                clients!inner (
                    unit_id,
                    units (
                        id,
                        name
                    )
                ),
                conversations!conversation_analysis_conversation_id_fkey!inner (
                    channel
                )
            `)
            .gte("started_at", fromIso)
            .lt("started_at", toIso)
            .order("started_at", { ascending: false })
            .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);

        if (unitId) query = query.eq("clients.unit_id", unitId);
        if (channel) query = query.eq("conversations.channel", channel);

        const { data, error } = await query;

        if (error) {
            throw new Error(`Falha ao carregar análises: ${error.message}`);
        }

        const page = data ?? [];

        for (const row of page) {
            const client = relationOne(row.clients);
            const unit = relationOne(client?.units);

            rows.push({
                conversation_id: row.conversation_id,
                client_id: row.client_id,
                started_at: row.started_at,
                customer_start_intent: row.customer_start_intent ?? null,
                conversation_goal: row.conversation_goal ?? null,
                goal_status: row.goal_status ?? null,
                customer_final_state: row.customer_final_state ?? null,
                objections: row.objections,
                dropoff_happened: row.dropoff_happened ?? null,
                dropoff_moment: row.dropoff_moment ?? null,
                dropoff_likely_reason: row.dropoff_likely_reason ?? null,
                dropoff_confidence: numberOrNull(row.dropoff_confidence),
                customer_sentiment: row.customer_sentiment ?? null,
                satisfaction_score: numberOrNull(row.satisfaction_score),
                sentiment_confidence: numberOrNull(
                    row.sentiment_confidence,
                ),
                attendant_quality_score: numberOrNull(
                    row.attendant_quality_score,
                ),
                first_human_response_time_seconds: numberOrNull(
                    row.first_human_response_time_seconds,
                ),
                average_human_response_time_seconds: numberOrNull(
                    row.average_human_response_time_seconds,
                ),
                resolution_result: row.resolution_result ?? null,
                resolution_score: numberOrNull(row.resolution_score),
                short_label: row.short_label ?? null,
                notable: row.notable ?? null,
                notable_reason: row.notable_reason ?? null,
                analysis_provider: row.analysis_provider ?? null,
                analysis_prompt_version:
                    row.analysis_prompt_version ?? null,
                unit_id: unit?.id ?? client?.unit_id ?? null,
                unit_name: unit?.name ?? null,
            });
        }

        if (page.length < ANALYTICS_PAGE_SIZE) break;
    }

    return rows;
}

function calculateAnalysisMetrics(rows: AnalysisRow[]) {
    const total = rows.length;
    const scheduled = rows.filter(isScheduledConversationOutcome).length;
    const achieved = rows.filter((row) => row.goal_status === "achieved").length;
    const dropoffs = rows.filter((row) => row.dropoff_happened === true).length;
    const highConfidenceDropoffs = rows.filter(
        (row) =>
            row.dropoff_happened === true &&
            hasHighAnalysisConfidence(row.dropoff_confidence),
    ).length;
    const resolved = rows.filter(
        (row) => row.resolution_result === "resolved",
    ).length;
    const firstHumanResponse = summarizeFirstHumanResponseTimes(
        rows.map((row) => row.first_human_response_time_seconds),
    );

    return {
        analyzed_conversations: total,
        scheduled_conversations: scheduled,
        scheduled_rate: percentage(scheduled, total),
        achieved_goals: achieved,
        goal_achievement_rate: percentage(achieved, total),
        resolved_conversations: resolved,
        resolution_rate: percentage(resolved, total),
        dropoffs,
        dropoff_rate: percentage(dropoffs, total),
        high_confidence_dropoffs: highConfidenceDropoffs,
        low_or_unrated_confidence_dropoffs:
            dropoffs - highConfidenceDropoffs,
        average_satisfaction_score: average(
            rows.map((row) => row.satisfaction_score),
        ),
        average_attendant_quality_score: average(
            rows.map((row) => row.attendant_quality_score),
        ),
        ...firstHumanResponse,
        average_human_response_seconds: average(
            rows.map((row) => row.average_human_response_time_seconds),
        ),
        top_final_states: topValues(
            rows.map((row) => row.customer_final_state),
        ),
        top_goals: topValues(rows.map((row) => row.conversation_goal)),
        top_dropoff_moments: topValues(
            rows
                .filter((row) => row.dropoff_happened)
                .map((row) => row.dropoff_moment),
        ),
        top_dropoff_reasons: topValues(
            rows
                .filter((row) => row.dropoff_happened)
                .map((row) => row.dropoff_likely_reason),
            8,
        ),
        top_objections: topObjections(rows),
        top_high_confidence_objections: topObjections(
            rows,
            "high",
        ),
        sentiment_distribution: topValues(
            rows.map((row) => row.customer_sentiment),
        ),
        confidence: {
            threshold: MIN_ANALYSIS_CONFIDENCE,
            high_confidence_sentiment_classifications: rows.filter((row) =>
                hasHighAnalysisConfidence(row.sentiment_confidence),
            ).length,
            low_or_unrated_sentiment_classifications: rows.filter(
                (row) => !hasHighAnalysisConfidence(row.sentiment_confidence),
            ).length,
        },
    };
}

async function countWhatsAppConversations({
    dateFrom,
    dateTo,
    unitId,
}: {
    dateFrom: string;
    dateTo: string;
    unitId?: string;
}): Promise<{ count: number | null; error: string | null }> {
    let query = supabase
        .from("conversations")
        .select(unitId ? "id, clients!inner(unit_id)" : "id", {
            count: "exact",
            head: true,
        })
        .eq("channel", "WhatsApp")
        .gte("started_at", brazilDayBoundary(dateFrom))
        .lt("started_at", brazilDayBoundary(addDays(dateTo, 1)));

    if (unitId) query = query.eq("clients.unit_id", unitId);

    const { count, error } = await query;

    if (error) {
        console.error("[assistente] conversation coverage failed", error);
        return {
            count: null,
            error: "A contagem total de conversas ficou indisponível.",
        };
    }

    return { count: count ?? 0, error: null };
}

function summarizeConversationObjections(
    rows: AnalysisRow[],
    confidenceBand: "all" | "high" | "low" = "all",
) {
    const summaries = new Map<
        string,
        {
            conversations: number;
            mentions: number;
            resolved: number;
            unresolved: number;
            severities: Map<string, number>;
        }
    >();

    for (const row of rows) {
        if (!Array.isArray(row.objections)) continue;

        const typesInConversation = new Set<string>();

        for (const objection of row.objections) {
            if (!isRecord(objection)) continue;

            const highConfidence = hasHighAnalysisConfidence(
                numberOrNull(objection.confidence),
            );
            if (confidenceBand === "high" && !highConfidence) continue;
            if (confidenceBand === "low" && highConfidence) continue;

            const type = stringValue(objection.type);
            if (!type) continue;

            const current = summaries.get(type) ?? {
                conversations: 0,
                mentions: 0,
                resolved: 0,
                unresolved: 0,
                severities: new Map<string, number>(),
            };

            current.mentions += 1;
            if (!typesInConversation.has(type)) {
                current.conversations += 1;
                typesInConversation.add(type);
            }

            if (objectionIsResolved(objection)) current.resolved += 1;
            else current.unresolved += 1;

            const severity = stringValue(objection.severity) ?? "unknown";
            current.severities.set(
                severity,
                (current.severities.get(severity) ?? 0) + 1,
            );
            summaries.set(type, current);
        }
    }

    return [...summaries.entries()]
        .map(([type, summary]) => ({
            type,
            label: objectionTypeLabel(type),
            conversations: summary.conversations,
            percentage_of_not_scheduled: percentage(
                summary.conversations,
                rows.length,
            ),
            mentions: summary.mentions,
            resolved: summary.resolved,
            unresolved: summary.unresolved,
            resolution_rate: percentage(
                summary.resolved,
                summary.resolved + summary.unresolved,
            ),
            severity_distribution: Object.fromEntries(
                [...summary.severities.entries()].sort(
                    (first, second) => second[1] - first[1],
                ),
            ),
        }))
        .sort(
            (first, second) =>
                second.conversations - first.conversations ||
                second.mentions - first.mentions,
        )
        .slice(0, 10);
}

function labeledTopValues(
    values: Array<string | null | undefined>,
    label: (value: string) => string,
    limit: number,
) {
    return topValues(values, limit).map((row) => ({
        key: row.value,
        label: label(row.value),
        count: row.count,
    }));
}

function isScheduledConversationOutcome(row: AnalysisRow) {
    return SCHEDULED_CONVERSATION_STATES.has(
        row.customer_final_state ?? "",
    );
}

function hasTypedObjection(row: AnalysisRow) {
    return (
        Array.isArray(row.objections) &&
        row.objections.some(
            (objection) =>
                isRecord(objection) && Boolean(stringValue(objection.type)),
        )
    );
}

function hasHighConfidenceTypedObjection(row: AnalysisRow) {
    return hasTypedObjectionWithConfidence(row, "high");
}

function hasLowConfidenceTypedObjection(row: AnalysisRow) {
    return hasTypedObjectionWithConfidence(row, "low");
}

function hasTypedObjectionWithConfidence(
    row: AnalysisRow,
    confidenceBand: "high" | "low",
) {
    if (!Array.isArray(row.objections)) return false;

    return row.objections.some((objection) => {
        if (!isRecord(objection) || !stringValue(objection.type)) return false;
        const highConfidence = hasHighAnalysisConfidence(
            numberOrNull(objection.confidence),
        );
        return confidenceBand === "high" ? highConfidence : !highConfidence;
    });
}

function hasHighAnalysisConfidence(value: number | null) {
    return value !== null && value >= MIN_ANALYSIS_CONFIDENCE;
}

function hasUnresolvedObjection(row: AnalysisRow) {
    return (
        Array.isArray(row.objections) &&
        row.objections.some(
            (objection) =>
                isRecord(objection) &&
                Boolean(stringValue(objection.type)) &&
                !objectionIsResolved(objection),
        )
    );
}

function objectionIsResolved(objection: JsonRecord) {
    return objection.resolved === true;
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectionTypeLabel(value: string) {
    const labels: Record<string, string> = {
        price: "Preço",
        time_availability: "Disponibilidade de horário",
        distance: "Distância",
        trust: "Confiança",
        medical_uncertainty: "Incerteza médica",
        online_consultation: "Consulta on-line",
        partner_or_family: "Parceiro(a) ou família",
        other: "Outros",
    };

    return labels[value] ?? humanizeAnalysisKey(value);
}

function dropoffMomentLabel(value: string) {
    const labels: Record<string, string> = {
        after_schedule_options: "Após receber opções de agendamento",
        after_delay: "Após demora no atendimento",
        after_unit_presented: "Após apresentação da unidade",
        after_medical_question: "Após pergunta médica",
        after_price: "Após apresentação do preço",
        after_payment_info: "Após informações de pagamento",
        after_consultation_online: "Após informações de consulta on-line",
        unknown: "Momento não identificado",
    };

    return labels[value] ?? humanizeAnalysisKey(value);
}

function humanizeAnalysisKey(value: string) {
    const normalized = value.replace(/_/g, " ").trim();
    return normalized
        ? normalized.charAt(0).toLocaleUpperCase("pt-BR") + normalized.slice(1)
        : value;
}

function compareMetrics(
    unit: ReturnType<typeof calculateAnalysisMetrics>,
    overall: ReturnType<typeof calculateAnalysisMetrics>,
) {
    return {
        scheduled_rate_percentage_points:
            round(unit.scheduled_rate - overall.scheduled_rate),
        goal_achievement_rate_percentage_points:
            round(
                unit.goal_achievement_rate -
                    overall.goal_achievement_rate,
            ),
        resolution_rate_percentage_points:
            round(unit.resolution_rate - overall.resolution_rate),
        dropoff_rate_percentage_points:
            round(unit.dropoff_rate - overall.dropoff_rate),
        satisfaction_score_difference:
            nullableDifference(
                unit.average_satisfaction_score,
                overall.average_satisfaction_score,
            ),
        attendant_quality_score_difference:
            nullableDifference(
                unit.average_attendant_quality_score,
                overall.average_attendant_quality_score,
            ),
        first_response_seconds_difference:
            nullableDifference(
                unit.average_first_human_response_seconds,
                overall.average_first_human_response_seconds,
            ),
    };
}

function selectRepresentativeConversations(
    rows: AnalysisRow[],
    limit: number,
) {
    return [...rows]
        .sort((first, second) => {
            const firstScore =
                (first.dropoff_happened ? 50 : 0) +
                (first.notable ? 20 : 0) +
                (100 - (first.attendant_quality_score ?? 70)) +
                (100 - (first.satisfaction_score ?? 70));
            const secondScore =
                (second.dropoff_happened ? 50 : 0) +
                (second.notable ? 20 : 0) +
                (100 - (second.attendant_quality_score ?? 70)) +
                (100 - (second.satisfaction_score ?? 70));

            return secondScore - firstScore;
        })
        .map((row) => row.conversation_id)
        .filter(Boolean)
        .slice(0, limit);
}

async function loadUnitAppointments(
    unitId: string,
    dateFrom: string,
    dateTo: string,
) {
    const { data: unit, error: unitError } = await supabase
        .from("units")
        .select("name")
        .eq("id", unitId)
        .maybeSingle();

    if (unitError) {
        throw new Error(
            `Falha ao localizar unidade para agenda: ${unitError.message}`,
        );
    }

    if (!unit?.name) return [];

    const { data, error } = await supabase
        .from("schedules")
        .select("id, status, scheduled_for")
        .ilike("unit_name", unit.name)
        .gte("scheduled_for", dateFrom)
        .lte("scheduled_for", dateTo)
        .limit(5_000);

    if (error) {
        throw new Error(
            `Falha ao carregar agendamentos da unidade: ${error.message}`,
        );
    }

    return data ?? [];
}

function summarizeAppointments(
    rows: Array<{ id: string; status: string | null; scheduled_for?: string }>,
) {
    const totals = emptyScheduleOverviewTotals();
    const byGroup = new Map<ScheduleStatusGroup, number>();

    for (const row of rows) {
        const group = normalizeScheduleStatus(row.status);
        incrementScheduleOverviewTotals(totals, group);
        byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
    }

    return {
        ...totals,
        attendance_rate_observed: rateOrNull(
            totals.showed_up,
            totals.showed_up + totals.no_show,
        ),
        cancellation_rate: rateOrNull(totals.cancelled, totals.total),
        by_status: [...byGroup.entries()]
            .map(([status, count]) => ({
                status,
                label: getScheduleStatusLabel(status),
                count,
            }))
            .sort((first, second) => second.count - first.count),
    };
}

async function resolveSingleUnit(name: string) {
    const safe = sanitizePostgrestText(name);
    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .ilike("name", `%${safe}%`)
        .eq("active", true)
        .order("name", { ascending: true })
        .limit(10);

    if (error) {
        throw new Error(`Falha ao localizar unidade: ${error.message}`);
    }

    const rows = data ?? [];
    const exact = rows.find(
        (row) =>
            row.name.toLocaleLowerCase("pt-BR") ===
            name.toLocaleLowerCase("pt-BR"),
    );

    return exact ?? rows[0] ?? null;
}

async function searchClientIds(query: string, limit: number) {
    const filters = buildClientSearchFilters(query);
    if (filters.length === 0) return [];

    const { data, error } = await supabase
        .from("clients")
        .select("id")
        .or(filters.join(","))
        .limit(limit);

    if (error) {
        throw new Error(`Falha ao localizar clientes: ${error.message}`);
    }

    return (data ?? []).map((row) => row.id);
}

async function loadClientIdsForUnit(unitId: string, limit: number) {
    const ids: string[] = [];
    const pageSize = 500;

    for (let offset = 0; offset < limit; offset += pageSize) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .eq("unit_id", unitId)
            .range(offset, Math.min(offset + pageSize - 1, limit - 1));

        if (error) {
            throw new Error(
                `Falha ao carregar clientes da unidade: ${error.message}`,
            );
        }

        const page = data ?? [];
        ids.push(...page.map((row) => row.id));

        if (page.length < pageSize) break;
    }

    return ids;
}

type ClientLookup = {
    id: string;
    name: string | null;
    unit_name: string | null;
};

async function loadClientsByIds(ids: string[]) {
    const map = new Map<string, ClientLookup>();

    for (const chunkIds of chunks(ids, 150)) {
        if (chunkIds.length === 0) continue;

        const { data, error } = await supabase
            .from("clients")
            .select(`
                id,
                name,
                units (
                    id,
                    name
                )
            `)
            .in("id", chunkIds);

        if (error) {
            throw new Error(`Falha ao carregar clientes: ${error.message}`);
        }

        for (const row of data ?? []) {
            const unit = relationOne(row.units);
            map.set(row.id, {
                id: row.id,
                name: row.name ?? null,
                unit_name: unit?.name ?? null,
            });
        }
    }

    return map;
}

type AnalysisLookup = {
    id: string;
    short_label: string | null;
    conversation_goal: string | null;
    goal_status: string | null;
    customer_final_state: string | null;
    resolution_result: string | null;
    dropoff_happened: boolean;
    dropoff_moment: string | null;
    dropoff_likely_reason: string | null;
    satisfaction_score: number | null;
    attendant_quality_score: number | null;
    notable: boolean;
    notable_reason: string | null;
};

async function loadAnalysesByIds(ids: string[]) {
    const map = new Map<string, AnalysisLookup>();

    for (const chunkIds of chunks(ids, 150)) {
        if (chunkIds.length === 0) continue;

        const { data, error } = await supabase
            .from("conversation_analysis")
            .select(`
                id,
                short_label,
                conversation_goal,
                goal_status,
                customer_final_state,
                resolution_result,
                dropoff_happened,
                dropoff_moment,
                dropoff_likely_reason,
                satisfaction_score,
                attendant_quality_score,
                notable,
                notable_reason
            `)
            .in("id", chunkIds);

        if (error) {
            throw new Error(`Falha ao carregar análises: ${error.message}`);
        }

        for (const row of data ?? []) {
            map.set(row.id, {
                id: row.id,
                short_label: row.short_label ?? null,
                conversation_goal: row.conversation_goal ?? null,
                goal_status: row.goal_status ?? null,
                customer_final_state: row.customer_final_state ?? null,
                resolution_result: row.resolution_result ?? null,
                dropoff_happened: Boolean(row.dropoff_happened),
                dropoff_moment: row.dropoff_moment ?? null,
                dropoff_likely_reason:
                    row.dropoff_likely_reason ?? null,
                satisfaction_score: numberOrNull(row.satisfaction_score),
                attendant_quality_score: numberOrNull(
                    row.attendant_quality_score,
                ),
                notable: Boolean(row.notable),
                notable_reason: row.notable_reason ?? null,
            });
        }
    }

    return map;
}

function buildClientSearchFilters(query: string) {
    const safeText = sanitizePostgrestText(query);
    const digits = query.replace(/\D/g, "");
    const filters: string[] = [];

    if (safeText.length >= 2) {
        filters.push(`name.ilike.%${safeText}%`);
        filters.push(`email.ilike.%${safeText}%`);
    }

    if (digits.length >= 3) {
        filters.push(`phone.ilike.%${digits}%`);
        filters.push(`cpf.ilike.%${digits}%`);
    }

    return filters;
}

function topValues(
    values: Array<string | null | undefined>,
    limit = 6,
) {
    const counts = new Map<string, number>();

    for (const rawValue of values) {
        const value = rawValue?.trim();
        if (!value) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((first, second) => second.count - first.count)
        .slice(0, limit);
}

function topObjections(
    rows: AnalysisRow[],
    confidenceBand: "all" | "high" = "all",
) {
    const values: string[] = [];

    for (const row of rows) {
        if (!Array.isArray(row.objections)) continue;

        for (const objection of row.objections) {
            if (!isRecord(objection)) continue;
            if (
                confidenceBand === "high" &&
                !hasHighAnalysisConfidence(
                    numberOrNull(objection.confidence),
                )
            ) {
                continue;
            }
            const type =
                typeof objection.type === "string"
                    ? objection.type
                    : null;
            if (type) values.push(type);
        }
    }

    return topValues(values, 8);
}

function average(values: Array<number | null>) {
    const valid = values.filter(
        (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
    );

    if (valid.length === 0) return null;
    return round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function percentage(value: number, total: number) {
    return total > 0 ? round((value / total) * 100) : 0;
}

function nullableDifference(
    first: number | null,
    second: number | null,
) {
    if (first === null || second === null) return null;
    return round(first - second);
}

function round(value: number) {
    return Math.round(value * 100) / 100;
}

function numberOrNull(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function sanitizePostgrestText(value: string) {
    return value
        .replace(/[,%()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanMessageText(value: string) {
    return value
        .replace(/<\/?b>/gi, "")
        .replace(/<\/?strong>/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanMessageDisplayText(value: string) {
    return value
        .replace(/<\/?b>/gi, "")
        .replace(/<\/?strong>/gi, "")
        .replace(/\r\n?/g, "\n")
        .trim();
}

function normalizeSenderType(
    value: unknown,
): "client" | "attendant" | "bot" | "system" {
    if (value === "client" || value === "attendant" || value === "bot") {
        return value;
    }

    return "system";
}

function senderLabel(senderType: string) {
    if (senderType === "client") return "Cliente";
    if (senderType === "attendant") return "Atendente";
    if (senderType === "bot") return "Bot";
    if (senderType === "system") return "Sistema";
    return senderType;
}

function todayInBrazil() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function dateDaysAgo(days: number) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);

    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function brazilDayBoundary(date: string) {
    return `${date}T00:00:00.000-03:00`;
}

function addDays(date: string, days: number) {
    const parsed = new Date(`${date}T12:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
}

function dateKeysBetween(dateFrom: string, dateTo: string) {
    const dates: string[] = [];
    let current = dateFrom;

    while (current <= dateTo) {
        dates.push(current);
        current = addDays(current, 1);
    }

    return dates;
}

function stringArg(args: JsonRecord, key: string) {
    const value = args[key];
    return typeof value === "string" && value.trim()
        ? value.trim()
        : null;
}

function validDateArg(args: JsonRecord, key: string) {
    const value = stringArg(args, key);
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const parsed = new Date(`${value}T12:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : value;
}

function stringArrayArg(args: JsonRecord, key: string) {
    const value = args[key];
    if (!Array.isArray(value)) return [];

    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
}

function booleanArg(
    args: JsonRecord,
    key: string,
    fallback: boolean,
) {
    return typeof args[key] === "boolean"
        ? (args[key] as boolean)
        : fallback;
}

function integerArg(
    args: JsonRecord,
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    const value = Number(args[key]);
    if (!Number.isInteger(value)) return fallback;
    return Math.max(minimum, Math.min(maximum, value));
}

function relationOne<T>(
    value: T | T[] | null | undefined,
): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function chunks<T>(items: T[], size: number) {
    const result: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size));
    }

    return result;
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
