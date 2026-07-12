// lib/ai/assistantDataTools.ts
import { supabase } from "@/lib";
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
const ANALYTICS_PAGE_SIZE = 1_000;
const TIME_ZONE = "America/Sao_Paulo";

export async function executeAssistantDataTool(
    name: string,
    rawArguments: unknown,
): Promise<ToolExecution> {
    const args = isRecord(rawArguments) ? rawArguments : {};

    switch (name) {
        case "search_clients":
            return searchClients(args);
        case "get_client_context":
            return getClientContext(args);
        case "search_appointments":
            return searchAppointments(args);
        case "search_conversations":
            return searchConversations(args);
        case "get_conversation_context":
            return getConversationContext(args);
        case "analyze_unit_performance":
            return analyzeUnitPerformance(args);
        case "compare_unit_performance":
            return compareUnitPerformance(args);
        case "get_business_overview":
            return getBusinessOverview(args);
        default:
            return {
                output: { ok: false, error: `Unknown tool: ${name}` },
                cards: [],
            };
    }
}

async function searchClients(args: JsonRecord): Promise<ToolExecution> {
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

    const { data, error } = await supabase
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
        .or(filters.join(","))
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

async function getClientContext(args: JsonRecord): Promise<ToolExecution> {
    const clientId = stringArg(args, "client_id");

    if (!clientId) {
        return {
            output: { ok: false, error: "client_id is required" },
            cards: [],
        };
    }

    const context = await loadClientContext(clientId);

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
            open_thread: context.openThread,
            recent_conversations: context.recentConversations,
        },
        cards: [{ type: "client", data: context.card }],
    };
}

async function searchAppointments(args: JsonRecord): Promise<ToolExecution> {
    const query = stringArg(args, "query");
    const doctorName = stringArg(args, "doctor_name");
    const unitName = stringArg(args, "unit_name");
    const startDate = stringArg(args, "start_date");
    const endDate = stringArg(args, "end_date");
    const futureOnly = booleanArg(args, "future_only", !startDate);
    const statuses = stringArrayArg(args, "statuses");
    const limit = integerArg(args, "limit", 20, 1, 50);

    const [doctorIds, unitIds] = await Promise.all([
        doctorName ? resolveNamedIds("doctors", doctorName) : Promise.resolve([]),
        unitName ? resolveNamedIds("units", unitName) : Promise.resolve([]),
    ]);

    if (doctorName && doctorIds.length === 0) {
        return {
            output: {
                ok: true,
                appointments: [],
                note: `Nenhum médico encontrado para “${doctorName}”.`,
            },
            cards: [],
        };
    }

    if (unitName && unitIds.length === 0) {
        return {
            output: {
                ok: true,
                appointments: [],
                note: `Nenhuma unidade encontrada para “${unitName}”.`,
            },
            cards: [],
        };
    }

    let databaseQuery = supabase
        .from("appointments")
        .select(`
            id,
            client_id,
            thread_id,
            starts_at,
            ends_at,
            status,
            format,
            procedure_name,
            patient_name,
            patient_phone,
            patient_email,
            spouse_name,
            notes,
            client:clients!appointments_client_id_fkey (
                id,
                name,
                phone,
                email
            ),
            unit:units!appointments_unit_id_fkey (
                id,
                name,
                city,
                state
            ),
            doctor:doctors!appointments_doctor_id_fkey (
                id,
                name,
                specialty,
                crm
            )
        `)
        .order("starts_at", { ascending: true })
        .limit(limit);

    if (futureOnly) {
        databaseQuery = databaseQuery.gte("ends_at", new Date().toISOString());
    }

    if (startDate) {
        databaseQuery = databaseQuery.gte(
            "starts_at",
            brazilDayBoundary(startDate),
        );
    }

    if (endDate) {
        databaseQuery = databaseQuery.lt(
            "starts_at",
            brazilDayBoundary(addDays(endDate, 1)),
        );
    }

    if (statuses.length > 0) databaseQuery = databaseQuery.in("status", statuses);
    if (doctorIds.length > 0) databaseQuery = databaseQuery.in("doctor_id", doctorIds);
    if (unitIds.length > 0) databaseQuery = databaseQuery.in("unit_id", unitIds);

    if (query) {
        const safeText = sanitizePostgrestText(query);
        const digits = query.replace(/\D/g, "");
        const filters: string[] = [];

        if (safeText) {
            filters.push(`patient_name.ilike.%${safeText}%`);
            filters.push(`spouse_name.ilike.%${safeText}%`);
            filters.push(`patient_email.ilike.%${safeText}%`);
        }

        if (digits.length >= 3) {
            filters.push(`patient_phone.ilike.%${digits}%`);
            filters.push(`spouse_phone.ilike.%${digits}%`);
        }

        if (filters.length > 0) databaseQuery = databaseQuery.or(filters.join(","));
    }

    const { data, error } = await databaseQuery;
    if (error) throw new Error(`Falha ao buscar agendamentos: ${error.message}`);

    const appointments = (data ?? []).map((row) => {
        const client = relationOne(row.client);
        const unit = relationOne(row.unit);
        const doctor = relationOne(row.doctor);

        return {
            id: row.id,
            client_id: row.client_id ?? client?.id ?? null,
            patient_name: row.patient_name,
            patient_phone: row.patient_phone ?? null,
            patient_email: row.patient_email ?? null,
            spouse_name: row.spouse_name ?? null,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
            status: row.status,
            format: row.format,
            procedure_name: row.procedure_name,
            doctor: doctor
                ? {
                      id: doctor.id,
                      name: doctor.name,
                      specialty: doctor.specialty ?? null,
                      crm: doctor.crm ?? null,
                  }
                : null,
            unit: unit
                ? {
                      id: unit.id,
                      name: unit.name,
                      city: unit.city ?? null,
                      state: unit.state ?? null,
                  }
                : null,
            notes: row.notes ?? null,
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
        const card = await loadClientCard(uniqueClientIds[0]);
        if (card) cards.push({ type: "client", data: card });
    }

    const publicAppointments = appointments.map((appointment) => ({
        patient_name: appointment.patient_name,
        patient_phone: appointment.patient_phone,
        patient_email: appointment.patient_email,
        spouse_name: appointment.spouse_name,
        starts_at: appointment.starts_at,
        ends_at: appointment.ends_at,
        status: appointment.status,
        format: appointment.format,
        procedure_name: appointment.procedure_name,
        doctor: appointment.doctor
            ? {
                  name: appointment.doctor.name,
                  specialty: appointment.doctor.specialty,
                  crm: appointment.doctor.crm,
              }
            : null,
        unit: appointment.unit
            ? {
                  name: appointment.unit.name,
                  city: appointment.unit.city,
                  state: appointment.unit.state,
              }
            : null,
        notes: appointment.notes,
    }));

    return {
        output: {
            ok: true,
            appointments: publicAppointments,
            total_returned: publicAppointments.length,
            current_time: new Date().toISOString(),
        },
        cards,
    };
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
): Promise<ToolExecution> {
    const conversationId = stringArg(args, "conversation_id");

    if (!conversationId) {
        return {
            output: { ok: false, error: "conversation_id is required" },
            cards: [],
        };
    }

    const context = await loadConversationContext(conversationId);

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

async function analyzeUnitPerformance(
    args: JsonRecord,
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

    const [unitRows, allRows, appointments] = await Promise.all([
        loadAnalysisRows({ dateFrom, dateTo, unitId: unit.id }),
        loadAnalysisRows({ dateFrom, dateTo }),
        loadUnitAppointments(unit.id, dateFrom, dateTo),
    ]);

    const unitMetrics = calculateAnalysisMetrics(unitRows);
    const overallMetrics = calculateAnalysisMetrics(allRows);
    const representativeIds = selectRepresentativeConversations(unitRows, 1);
    const cards: AssistantCard[] = [];

    for (const conversationId of representativeIds.slice(0, 1)) {
        const context = await loadConversationContext(conversationId);

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
            differences: compareMetrics(unitMetrics, overallMetrics),
            appointments: summarizeAppointments(appointments),
            data_notes: [
                "A unidade das conversas é derivada de clients.unit_id, pois conversations.unit_id não está preenchido de forma confiável.",
                `Foram consideradas ${unitRows.length} análises da unidade e ${allRows.length} análises no benchmark geral.`,
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
            .gte("started_at", fromIso)
            .lt("started_at", toIso),
        supabase
            .from("conversation_analysis")
            .select("id", { count: "exact", head: true })
            .gte("started_at", fromIso)
            .lt("started_at", toIso),
        supabase
            .from("appointments")
            .select("id", { count: "exact", head: true })
            .gte("starts_at", fromIso)
            .lt("starts_at", toIso),
        supabase
            .from("appointments")
            .select("id", { count: "exact", head: true })
            .gte("created_at", fromIso)
            .lt("created_at", toIso),
        supabase
            .from("thread")
            .select("id", { count: "exact", head: true })
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
                // appointments whose scheduled date falls inside the period.
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
            unit_performance: unitPerformance,
        },
        cards: [],
    };
}

type ClientContext = {
    client: unknown;
    upcomingAppointments: unknown[];
    openThread: unknown;
    recentConversations: unknown[];
    card: AssistantClientCardData;
};

async function loadClientContext(
    clientId: string,
): Promise<ClientContext | null> {
    const { data: clientRow, error: clientError } = await supabase
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
        .eq("id", clientId)
        .maybeSingle();

    if (clientError) {
        throw new Error(`Falha ao carregar cliente: ${clientError.message}`);
    }

    if (!clientRow) return null;

    const [appointmentsResult, threadResult, conversationResult] =
        await Promise.all([
            supabase
                .from("appointments")
                .select(`
                    id,
                    starts_at,
                    ends_at,
                    status,
                    procedure_name,
                    unit:units!appointments_unit_id_fkey (
                        id,
                        name
                    ),
                    doctor:doctors!appointments_doctor_id_fkey (
                        id,
                        name,
                        specialty
                    )
                `)
                .eq("client_id", clientId)
                .in("status", ["scheduled", "confirmed"])
                .gte("ends_at", new Date().toISOString())
                .order("starts_at", { ascending: true })
                .limit(20),
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
        appointmentsResult.error,
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
    const upcomingAppointments = (appointmentsResult.data ?? []).map((row) => {
        const appointmentUnit = relationOne(row.unit);
        const doctor = relationOne(row.doctor);

        return {
            id: row.id,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
            status: row.status,
            procedure_name: row.procedure_name,
            unit_name: appointmentUnit?.name ?? null,
            doctor_name: doctor?.name ?? null,
            doctor_specialty: doctor?.specialty ?? null,
        };
    });
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
                  doctor_name: nextAppointment.doctor_name,
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
): Promise<AssistantClientCardData | null> {
    const context = await loadClientContext(clientId);
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
): Promise<ConversationContext | null> {
    const { data: conversation, error: conversationError } = await supabase
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
            conversation_analysis_id
        `)
        .eq("id", conversationId)
        .maybeSingle();

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
        loadClientCard(conversation.client_id),
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
    customer_sentiment: string | null;
    satisfaction_score: number | null;
    attendant_quality_score: number | null;
    first_human_response_time_seconds: number | null;
    average_human_response_time_seconds: number | null;
    resolution_result: string | null;
    resolution_score: number | null;
    short_label: string | null;
    notable: boolean | null;
    notable_reason: string | null;
    unit_id: string | null;
    unit_name: string | null;
};

async function loadAnalysisRows({
    dateFrom,
    dateTo,
    unitId,
}: {
    dateFrom: string;
    dateTo: string;
    unitId?: string;
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
                customer_sentiment,
                satisfaction_score,
                attendant_quality_score,
                first_human_response_time_seconds,
                average_human_response_time_seconds,
                resolution_result,
                resolution_score,
                short_label,
                notable,
                notable_reason,
                clients!inner (
                    unit_id,
                    units (
                        id,
                        name
                    )
                )
            `)
            .gte("started_at", fromIso)
            .lt("started_at", toIso)
            .order("started_at", { ascending: false })
            .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);

        if (unitId) query = query.eq("clients.unit_id", unitId);

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
                customer_sentiment: row.customer_sentiment ?? null,
                satisfaction_score: numberOrNull(row.satisfaction_score),
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
    const scheduled = rows.filter((row) =>
        ["scheduled", "rescheduled"].includes(
            row.customer_final_state ?? "",
        ),
    ).length;
    const achieved = rows.filter((row) => row.goal_status === "achieved").length;
    const dropoffs = rows.filter((row) => row.dropoff_happened === true).length;
    const resolved = rows.filter(
        (row) => row.resolution_result === "resolved",
    ).length;

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
        average_satisfaction_score: average(
            rows.map((row) => row.satisfaction_score),
        ),
        average_attendant_quality_score: average(
            rows.map((row) => row.attendant_quality_score),
        ),
        average_first_human_response_seconds: average(
            rows.map((row) => row.first_human_response_time_seconds),
        ),
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
        sentiment_distribution: topValues(
            rows.map((row) => row.customer_sentiment),
        ),
    };
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
    const { data, error } = await supabase
        .from("appointments")
        .select("id, status, starts_at")
        .eq("unit_id", unitId)
        .gte("starts_at", brazilDayBoundary(dateFrom))
        .lt("starts_at", brazilDayBoundary(addDays(dateTo, 1)))
        .limit(5_000);

    if (error) {
        throw new Error(
            `Falha ao carregar agendamentos da unidade: ${error.message}`,
        );
    }

    return data ?? [];
}

function summarizeAppointments(
    rows: Array<{ id: string; status: string; starts_at: string }>,
) {
    return {
        total: rows.length,
        by_status: topValues(rows.map((row) => row.status)),
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

async function resolveNamedIds(
    table: "doctors" | "units",
    name: string,
) {
    const safe = sanitizePostgrestText(name);
    const { data, error } = await supabase
        .from(table)
        .select("id, name")
        .ilike("name", `%${safe}%`)
        .eq("active", true)
        .limit(25);

    if (error) {
        throw new Error(`Falha ao localizar ${table}: ${error.message}`);
    }

    return (data ?? []).map((row) => row.id);
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

function topObjections(rows: AnalysisRow[]) {
    const values: string[] = [];

    for (const row of rows) {
        if (!Array.isArray(row.objections)) continue;

        for (const objection of row.objections) {
            if (!isRecord(objection)) continue;
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

function stringArg(args: JsonRecord, key: string) {
    const value = args[key];
    return typeof value === "string" && value.trim()
        ? value.trim()
        : null;
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
