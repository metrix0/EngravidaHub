// lib/ai/assistantOperationalTools.ts
import { supabase } from "@/lib";
import { getInternalChatUsers } from "@/lib/internal-chat/internalChatServer";
import {
    normalizeScheduleStatus,
    scheduleShowedUp,
} from "@/lib/schedules/status";

type JsonRecord = Record<string, unknown>;

type ToolExecution = {
    output: unknown;
    cards: [];
};

type ActiveMessageSendRow = {
    id: string;
    template_id: string;
    template_name: string;
    status: string;
    sent_count: number;
    created_at: string;
    filters: unknown;
};

type ActiveMessageMetricRow = {
    send_id: string;
    schedule_count: number | string | null;
    response_count: number | string | null;
};

type FunnelStageRow = {
    id: string;
    funnel_id: string;
    name: string;
    position: number;
};

type FunnelRow = {
    id: string;
    name: string;
};

type FunnelClientRow = {
    id: string;
    funnel_stage_id: string | null;
};

type FunnelEventRow = {
    client_id: string;
    scheduled_for: string;
    status: string | null;
    event_kind: string | null;
};

type UnitRow = {
    id: string;
    name: string;
};

const PAGE_SIZE = 1_000;
const MAX_ROWS = 25_000;
const ACTIVE_MESSAGE_METRIC_CHUNK = 500;
const TIME_ZONE = "America/Sao_Paulo";

const OPERATIONAL_TOOL_NAMES = new Set([
    "get_funnel_overview",
    "get_active_message_overview",
    "get_tracking_events_overview",
    "get_internal_team_overview",
]);

export function isAssistantOperationalTool(name: string) {
    return OPERATIONAL_TOOL_NAMES.has(name);
}

export async function executeAssistantOperationalTool(
    name: string,
    rawArguments: unknown,
): Promise<ToolExecution> {
    const args = isRecord(rawArguments) ? rawArguments : {};

    switch (name) {
        case "get_funnel_overview":
            return getFunnelOverview(args);
        case "get_active_message_overview":
            return getActiveMessageOverview(args);
        case "get_tracking_events_overview":
            return getTrackingEventsOverview(args);
        case "get_internal_team_overview":
            return getInternalTeamOverview(args);
        default:
            return {
                output: { ok: false, error: `Unknown operational tool: ${name}` },
                cards: [],
            };
    }
}

async function getFunnelOverview(args: JsonRecord): Promise<ToolExecution> {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const unitName = stringArg(args, "unit_name");
    const unit = unitName ? await resolveSingleUnit(unitName) : null;

    if (unitName && !unit) {
        return {
            output: {
                ok: true,
                period: { date_from: dateFrom, date_to: dateTo },
                unit: null,
                funnels: [],
                note: `Unidade “${unitName}” não encontrada.`,
            },
            cards: [],
        };
    }

    const [funnelsResult, stagesResult, currentClients, unitClientIds, events] =
        await Promise.all([
            supabase
                .from("funnels")
                .select("id, name")
                .eq("active", true)
                .order("created_at", { ascending: true }),
            supabase
                .from("funnel_stages")
                .select("id, funnel_id, name, position")
                .order("position", { ascending: true }),
            loadFunnelClients(unit?.id ?? null),
            unit ? loadClientIdsForUnit(unit.id) : Promise.resolve(null),
            loadFunnelEvents(dateFrom, dateTo),
        ]);

    if (funnelsResult.error) {
        throw new Error(`Falha ao carregar funis: ${funnelsResult.error.message}`);
    }
    if (stagesResult.error) {
        throw new Error(`Falha ao carregar etapas: ${stagesResult.error.message}`);
    }

    const funnels = (funnelsResult.data ?? []) as FunnelRow[];
    const stages = (stagesResult.data ?? []) as FunnelStageRow[];
    const stageCounts = new Map<string, number>();

    for (const client of currentClients.rows) {
        if (!client.funnel_stage_id) continue;
        stageCounts.set(
            client.funnel_stage_id,
            (stageCounts.get(client.funnel_stage_id) ?? 0) + 1,
        );
    }

    const activeFunnelIds = new Set(funnels.map((funnel) => funnel.id));
    const stageRows = stages.filter((stage) => activeFunnelIds.has(stage.funnel_id));
    const funnelOutput = funnels.map((funnel) => {
        const funnelStages = stageRows
            .filter((stage) => stage.funnel_id === funnel.id)
            .sort((first, second) => first.position - second.position)
            .map((stage) => ({
                stage_name: stage.name,
                position: stage.position,
                clients: stageCounts.get(stage.id) ?? 0,
            }));

        return {
            funnel_name: funnel.name,
            clients: funnelStages.reduce((total, stage) => total + stage.clients, 0),
            stages: funnelStages,
        };
    });

    const allowedClientIds = unitClientIds ? new Set(unitClientIds.rows) : null;
    const scopedEvents = allowedClientIds
        ? events.rows.filter((event) => allowedClientIds.has(event.client_id))
        : events.rows;
    const evaluations = scopedEvents.filter((event) => event.event_kind === "evaluation");
    const procedures = scopedEvents.filter((event) => event.event_kind === "procedure");

    return {
        output: {
            ok: true,
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            unit: unit ? { name: unit.name } : null,
            current_positions: {
                clients_in_active_funnels: funnelOutput.reduce(
                    (total, funnel) => total + funnel.clients,
                    0,
                ),
                funnels: funnelOutput,
                definition:
                    "Contagem atual de clientes em cada etapa; não é limitada pelo período selecionado.",
            },
            journey_kpis: {
                evaluations_scheduled: uniqueClientCount(evaluations),
                evaluation_show_rate: buildShowRate(evaluations),
                procedures_scheduled: uniqueClientCount(procedures),
                procedure_show_rate: buildShowRate(procedures),
                definition:
                    "KPIs calculados por scheduled_for dentro do período selecionado, seguindo o mesmo status do CliniSys usado no Funil.",
            },
            coverage: {
                current_client_rows_read: currentClients.rows.length,
                journey_event_rows_read: scopedEvents.length,
                current_clients_truncated: currentClients.capped,
                journey_events_truncated: events.capped,
            },
        },
        cards: [],
    };
}

async function getActiveMessageOverview(args: JsonRecord): Promise<ToolExecution> {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const requestedAutomation = stringArg(args, "automation");
    const sends = await loadActiveMessageSends(dateFrom, dateTo);
    const metrics = await loadActiveMessageMetrics(sends.rows.map((row) => row.id));

    const filtered = sends.rows.filter((row) => {
        if (!requestedAutomation || requestedAutomation === "all") return true;
        const automation = readFilterString(row.filters, "automation");
        if (requestedAutomation === "manual") return !automation;
        return automation === requestedAutomation;
    });

    const totals = summarizeActiveMessages(filtered, metrics);
    const byTemplate = groupActiveMessages(
        filtered,
        (row) => row.template_name?.trim() || row.template_id || "Sem template",
        metrics,
        "template_name",
    );
    const byAutomation = groupActiveMessages(
        filtered,
        (row) => readFilterString(row.filters, "automation") ?? "manual",
        metrics,
        "automation",
    );
    const resgateRows = filtered.filter(
        (row) => readFilterString(row.filters, "automation") === "resgate",
    );
    const resgate = summarizeActiveMessages(resgateRows, metrics);
    const resgateByGroup = groupActiveMessages(
        resgateRows,
        (row) => readFilterString(row.filters, "tunnel_group") ?? "sem_grupo",
        metrics,
        "tunnel_group",
    );
    const recent = [...filtered]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 12)
        .map((row) => {
            const metric = metrics.get(row.id) ?? { responses: 0, schedules: 0 };
            return {
                created_at: row.created_at,
                template_name: row.template_name,
                status: row.status,
                automation: readFilterString(row.filters, "automation") ?? "manual",
                tunnel_group: readFilterString(row.filters, "tunnel_group"),
                sent: Number(row.sent_count ?? 0),
                responses: metric.responses,
                schedules: metric.schedules,
            };
        });

    return {
        output: {
            ok: true,
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            filter: {
                automation:
                    !requestedAutomation || requestedAutomation === "all"
                        ? null
                        : requestedAutomation,
            },
            totals,
            by_template: byTemplate,
            by_automation: byAutomation,
            resgate: {
                ...resgate,
                by_tunnel_group: resgateByGroup,
                definition:
                    "Resgate inclui somente lotes cujo filters.automation é resgate; a automação já deduplica clientes tentados/enviados por data-alvo.",
            },
            recent_batches: recent,
            metric_definitions: {
                batches: "Quantidade de lotes registrados em active_message_sends.",
                sent: "Soma de sent_count, isto é, mensagens efetivamente marcadas como enviadas pelos lotes.",
                responses:
                    "Respostas atribuídas aos lotes pela métrica canônica get_active_message_send_metrics.",
                schedules:
                    "Agendamentos atribuídos aos lotes pela métrica canônica get_active_message_send_metrics.",
            },
            coverage: {
                rows_read: sends.rows.length,
                truncated: sends.capped,
            },
        },
        cards: [],
    };
}

async function getTrackingEventsOverview(args: JsonRecord): Promise<ToolExecution> {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const unitName = stringArg(args, "unit_name");
    const unit = unitName ? await resolveSingleUnit(unitName) : null;

    if (unitName && !unit) {
        return {
            output: {
                ok: true,
                period: { date_from: dateFrom, date_to: dateTo },
                unit: null,
                note: `Unidade “${unitName}” não encontrada.`,
            },
            cards: [],
        };
    }

    const platform = stringArg(args, "platform") ?? "all";
    const eventTypes = stringArrayArg(args, "event_types");
    const statuses = stringArrayArg(args, "statuses");
    const sources = stringArrayArg(args, "sources");
    const tunnels = stringArrayArg(args, "tunnels");
    const origins = stringArrayArg(args, "origins");
    const platforms =
        platform === "meta_ads"
            ? ["Meta Ads"]
            : platform === "google_ads"
              ? ["Google Ads"]
              : [];
    const previous = previousDateRange(dateFrom, dateTo);
    const filters = {
        p_unit_ids: unit ? [unit.id] : [],
        p_service_ids: [],
        p_platforms: platforms,
        p_event_types: eventTypes,
        p_statuses: statuses,
        p_sources: sources,
        p_tunnels: tunnels,
        p_origins: origins,
    };

    const [currentResult, previousResult] = await Promise.all([
        supabase.rpc("dashboard_events_metrics_v2", {
            p_start_at: brazilDayBoundary(dateFrom),
            p_end_at: brazilDayBoundary(addDays(dateTo, 1)),
            ...filters,
            p_page: 1,
            p_page_size: 12,
        }),
        supabase.rpc("dashboard_events_metrics_v2", {
            p_start_at: brazilDayBoundary(previous.date_from),
            p_end_at: brazilDayBoundary(addDays(previous.date_to, 1)),
            ...filters,
            p_page: 1,
            p_page_size: 1,
        }),
    ]);

    if (currentResult.error || previousResult.error) {
        const error = currentResult.error ?? previousResult.error;
        throw new Error(`Falha ao carregar eventos: ${error?.message ?? "erro desconhecido"}`);
    }

    const current = asObject(currentResult.data);
    const previousData = asObject(previousResult.data);
    const recent = arrayOrEmpty<JsonRecord>(current.recent).map((event) => ({
        date: event.date ?? null,
        client_name: event.client_name ?? null,
        event_type: event.event_type ?? null,
        platform: event.platform ?? null,
        platforms: event.platforms ?? null,
        status: event.status ?? null,
        parameters: event.parameters ?? null,
    }));

    return {
        output: {
            ok: true,
            source: "Eventos enviados pelo Engravida Hub para Meta Ads e Google Ads",
            period: {
                date_from: dateFrom,
                date_to: dateTo,
                timezone: TIME_ZONE,
            },
            previous_period: previous,
            filters: {
                unit_name: unit?.name ?? null,
                platform,
                event_types: eventTypes,
                statuses,
                sources,
                tunnels,
                origins,
            },
            kpis: asObject(current.kpis),
            previous_kpis: asObject(previousData.kpis),
            by_platform: arrayOrEmpty(current.by_platform),
            by_type: arrayOrEmpty(current.by_type),
            by_status: arrayOrEmpty(current.by_status),
            daily: arrayOrEmpty(current.daily),
            recent,
            recent_total: numberOrZero(current.recent_total),
            metric_definitions: {
                sent_events:
                    "Eventos aceitos/enviados pelo pipeline do Hub; não são o mesmo que conversões reportadas pelas plataformas.",
                failed_events:
                    "Eventos cujo envio para a plataforma falhou.",
                fbclid_rate:
                    "Cobertura de fbclid nos eventos Meta quando aplicável.",
                gclid_rate:
                    "Cobertura de identificador de clique do Google quando aplicável.",
            },
            note:
                "Use get_paid_media_overview para investimento, campanhas, CTR, CPC e ROAS. Esta ferramenta cobre entrega/qualidade dos eventos de conversão enviados pelo Hub.",
        },
        cards: [],
    };
}

async function getInternalTeamOverview(args: JsonRecord): Promise<ToolExecution> {
    const query = stringArg(args, "query")?.toLocaleLowerCase("pt-BR") ?? "";
    const status = stringArg(args, "status") ?? "all";
    const users = await getInternalChatUsers();
    const filtered = users.filter((user) => {
        if (status === "online" && !user.online) return false;
        if (status === "offline" && user.online) return false;
        if (!query) return true;

        return [user.name, user.queue_name, user.preset]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("pt-BR")
            .includes(query);
    });

    return {
        output: {
            ok: true,
            totals: {
                active_users: users.filter((user) => user.active).length,
                online: users.filter((user) => user.online).length,
                offline: users.filter((user) => !user.online).length,
            },
            users: filtered.slice(0, 50).map((user) => ({
                name: user.name,
                role: user.preset,
                queue_name: user.queue_name,
                active: user.active,
                online: user.online,
                last_seen_at: user.last_seen_at,
            })),
            total_matching: filtered.length,
            note:
                filtered.length > 50
                    ? "A lista foi limitada aos primeiros 50 usuários correspondentes."
                    : null,
        },
        cards: [],
    };
}

async function loadActiveMessageSends(dateFrom: string, dateTo: string) {
    const rows: ActiveMessageSendRow[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("active_message_sends")
            .select("id, template_id, template_name, status, sent_count, created_at, filters")
            .gte("created_at", brazilDayBoundary(dateFrom))
            .lt("created_at", brazilDayBoundary(addDays(dateTo, 1)))
            .order("created_at", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw new Error(`Falha ao carregar Mensagem Ativa: ${error.message}`);
        }

        const page = (data ?? []) as ActiveMessageSendRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return { rows, capped: false };
    }

    return { rows, capped: true };
}

async function loadActiveMessageMetrics(sendIds: string[]) {
    const metrics = new Map<string, { responses: number; schedules: number }>();

    for (let offset = 0; offset < sendIds.length; offset += ACTIVE_MESSAGE_METRIC_CHUNK) {
        const chunk = sendIds.slice(offset, offset + ACTIVE_MESSAGE_METRIC_CHUNK);
        const { data, error } = await supabase.rpc("get_active_message_send_metrics", {
            p_send_ids: chunk,
        });

        if (error) {
            throw new Error(`Falha ao carregar métricas de Mensagem Ativa: ${error.message}`);
        }

        for (const row of (data ?? []) as ActiveMessageMetricRow[]) {
            metrics.set(row.send_id, {
                responses: toCount(row.response_count),
                schedules: toCount(row.schedule_count),
            });
        }
    }

    return metrics;
}

function summarizeActiveMessages(
    rows: ActiveMessageSendRow[],
    metrics: Map<string, { responses: number; schedules: number }>,
) {
    let sent = 0;
    let responses = 0;
    let schedules = 0;

    for (const row of rows) {
        const metric = metrics.get(row.id);
        sent += Number(row.sent_count ?? 0);
        responses += metric?.responses ?? 0;
        schedules += metric?.schedules ?? 0;
    }

    return {
        batches: rows.length,
        sent,
        responses,
        schedules,
        response_rate: percentage(responses, sent),
        schedule_rate: percentage(schedules, sent),
    };
}

function groupActiveMessages(
    rows: ActiveMessageSendRow[],
    keyFor: (row: ActiveMessageSendRow) => string,
    metrics: Map<string, { responses: number; schedules: number }>,
    keyName: string,
) {
    const groups = new Map<string, ActiveMessageSendRow[]>();

    for (const row of rows) {
        const key = keyFor(row);
        const current = groups.get(key) ?? [];
        current.push(row);
        groups.set(key, current);
    }

    return [...groups.entries()]
        .map(([key, groupRows]) => ({
            [keyName]: key,
            ...summarizeActiveMessages(groupRows, metrics),
        }))
        .sort((first, second) => Number(second.sent) - Number(first.sent));
}

async function loadFunnelClients(unitId: string | null) {
    const rows: FunnelClientRow[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        let query = supabase
            .from("clients")
            .select("id, funnel_stage_id")
            .not("funnel_stage_id", "is", null)
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (unitId) query = query.eq("unit_id", unitId);
        const { data, error } = await query;
        if (error) throw new Error(`Falha ao carregar clientes do funil: ${error.message}`);

        const page = (data ?? []) as FunnelClientRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return { rows, capped: false };
    }

    return { rows, capped: true };
}

async function loadClientIdsForUnit(unitId: string) {
    const rows: string[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .eq("unit_id", unitId)
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Falha ao carregar clientes da unidade: ${error.message}`);
        const page = data ?? [];
        rows.push(...page.map((row) => row.id));
        if (page.length < PAGE_SIZE) return { rows, capped: false };
    }

    return { rows, capped: true };
}

async function loadFunnelEvents(dateFrom: string, dateTo: string) {
    const rows: FunnelEventRow[] = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("funnel_clinisys_events")
            .select("client_id, scheduled_for, status, event_kind")
            .gte("scheduled_for", dateFrom)
            .lte("scheduled_for", dateTo)
            .order("scheduled_for", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Falha ao carregar marcos do funil: ${error.message}`);
        const page = (data ?? []) as FunnelEventRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return { rows, capped: false };
    }

    return { rows, capped: true };
}

function buildShowRate(events: FunnelEventRow[]) {
    const outcomes = new Map<string, "showed_up" | "no_show">();

    for (const event of events) {
        const status = normalizeScheduleStatus(event.status);
        if (scheduleShowedUp(status)) {
            outcomes.set(event.client_id, "showed_up");
        } else if (status === "no_show" && outcomes.get(event.client_id) !== "showed_up") {
            outcomes.set(event.client_id, "no_show");
        }
    }

    return percentage(
        [...outcomes.values()].filter((value) => value === "showed_up").length,
        outcomes.size,
    );
}

function uniqueClientCount(events: FunnelEventRow[]) {
    return new Set(events.map((event) => event.client_id)).size;
}

async function resolveSingleUnit(query: string) {
    const safe = query.trim();
    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .eq("active", true)
        .ilike("name", `%${safe.replace(/[%_,]/g, " ")}%`)
        .order("name")
        .limit(10);

    if (error) throw new Error(`Falha ao buscar unidade: ${error.message}`);
    const units = (data ?? []) as UnitRow[];
    if (units.length === 0) return null;

    const normalized = normalizeText(safe);
    return (
        units.find((unit) => normalizeText(unit.name) === normalized) ??
        (units.length === 1 ? units[0] : null)
    );
}

function readFilterString(value: unknown, key: string) {
    if (!isRecord(value)) return null;
    const result = value[key];
    return typeof result === "string" && result.trim() ? result.trim() : null;
}

function previousDateRange(dateFrom: string, dateTo: string) {
    const start = new Date(`${dateFrom}T12:00:00Z`);
    const end = new Date(`${dateTo}T12:00:00Z`);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    const previousTo = addDays(dateFrom, -1);
    return {
        date_from: addDays(previousTo, -(days - 1)),
        date_to: previousTo,
    };
}

function validDateArg(args: JsonRecord, key: string) {
    const value = stringArg(args, key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function stringArg(args: JsonRecord, key: string) {
    const value = args[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayArg(args: JsonRecord, key: string) {
    const value = args[key];
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim());
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asObject(value: unknown): JsonRecord {
    return isRecord(value) ? value : {};
}

function arrayOrEmpty<T = unknown>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function numberOrZero(value: unknown) {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
}

function toCount(value: number | string | null) {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
}

function percentage(value: number, total: number) {
    if (total <= 0) return null;
    return Math.round((value / total) * 10_000) / 100;
}

function dateDaysAgo(days: number) {
    return addDays(todayInBrazil(), -Math.max(0, days - 1));
}

function todayInBrazil() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function addDays(value: string, days: number) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function brazilDayBoundary(value: string) {
    return `${value}T00:00:00-03:00`;
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}
