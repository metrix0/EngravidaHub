// lib/saude/monitor.ts
import "server-only";

import vercelConfig from "@/vercel.json";
import { supabase } from "@/lib/supabase/client";

export type HealthStatus = "healthy" | "warning" | "failed" | "unknown";
export type HealthCategory = "cron" | "webhook" | "api" | "database";

export type HealthAttempt = {
    id: string;
    service: string;
    category: HealthCategory;
    path: string;
    at: string;
    status_code: number | null;
    status: "success" | "failed";
    detail: string;
};

export type HealthService = {
    id: string;
    name: string;
    category: HealthCategory;
    path: string;
    schedule?: string;
    status: HealthStatus;
    last_seen: string | null;
    last_success: string | null;
    last_failure: string | null;
    detail: string;
    failures: number;
};

export type HealthSnapshot = {
    checked_at: string;
    sources: {
        vercel: { ok: boolean; detail: string };
        supabase: { ok: boolean; detail: string };
    };
    services: HealthService[];
    attempts: HealthAttempt[];
};

type VercelLog = {
    requestPath?: string;
    responseStatusCode?: number;
    timestampInMs?: number;
    level?: string;
    message?: string;
    rowId?: string;
    source?: string;
    count?: number;
};

type MetricRow = {
    request_path?: string;
    route?: string;
    http_status?: string | number;
    timestamp?: string;
    vercel_function_invocation_count_sum?: number;
};

type MetricSlice = {
    start: number;
    end: number;
    logs: VercelLog[];
    counts: Map<string, { success: number; failures: number }>;
};

type MetricsResult = {
    slices: MetricSlice[];
    logs: VercelLog[];
    counts: Map<string, { success: number; failures: number }>;
    recent: MetricSlice | null;
    fast: MetricSlice | null;
    weekly: MetricSlice | null;
    fastPaths: Set<string>;
    weeklyPaths: Set<string>;
    coreOK: boolean;
    errors: string[];
};
type CronJob = {
    name: string;
    schedule: string;
    active: boolean;
    last_run: { status: string; started_at: string | null; finished_at: string | null; message: string } | null;
};

const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_jb6BkDqYaC4smh5AeD5lIybZMP0L";
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "team_IZl9hS7irDpAG000kYEoKNQZ";
const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DAILY_WINDOW_MS = 36 * 60 * 60 * 1000;
const WEEKLY_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const MISSED_GRACE_MS = 20 * 60 * 1000;

const WEBHOOKS = [
    { path: "/api/blip/messages", name: "Blip · Mensagens" },
    { path: "/api/blip/contacts", name: "Blip · Contatos" },
    { path: "/api/blip/notifications", name: "Blip · Notificações" },
    { path: "/api/blip/chatbot", name: "Blip · Chatbot" },
    { path: "/api/tintim", name: "Tintim" },
    { path: "/api/zernio", name: "Zernio" },
    { path: "/api/webhooks/clinisys/appointments", name: "CliniSys · Agendamentos" },
    { path: "/api/webhooks/clinisys/schedules", name: "CliniSys · Agendas" },
    { path: "/api/integrations/appointments/webhook", name: "Agendamentos · Integração" },
];

function routePath(value: string) {
    return value.split("?")[0].replace(/\/$/, "") || "/";
}

function labelForPath(path: string) {
    const normalized = routePath(path);
    return WEBHOOKS.find(item => item.path === normalized)?.name ??
        normalized.replace(/^\/api\//, "").replace(/[-/]/g, " · ");
}

function categoryForPath(path: string): HealthCategory {
    const clean = routePath(path);
    if (WEBHOOKS.some(item => item.path === clean)) return "webhook";
    if (clean.startsWith("/api/cron/") || clean.includes("cadence") ||
        clean.includes("finalize-inactive") || clean.startsWith("/api/clinisys/")) return "cron";
    return "api";
}

function isFailure(log: VercelLog) {
    return (typeof log.responseStatusCode === "number" && log.responseStatusCode >= 400) ||
        log.level === "error" || log.level === "fatal";
}

function metricCount(row: MetricRow): number {
    const value = Number(row.vercel_function_invocation_count_sum ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function statusCode(row: MetricRow): number | null {
    const value = Number(row.http_status);
    return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function countAsFailure(code: number | null) {
    return code !== null && code >= 400;
}

function relevantPaths() {
    return [...new Set([
        ...vercelConfig.crons.map(job => routePath(job.path)),
        ...WEBHOOKS.map(item => item.path),
    ])];
}

function hasFrequentSchedule(schedule: string, now: number) {
    let executions = 0;
    const end = Math.floor(now / 60_000) * 60_000;
    for (let index = 0; index < 120; index++) {
        if (matchesSchedule(schedule, new Date(end - index * 60_000))) executions++;
        if (executions >= 2) return true;
    }
    return false;
}

async function queryMetric(
    start: number, end: number,
    granularity: { minutes?: number; hours?: number; days?: number },
    paths?: string[],
): Promise<MetricSlice> {
    const token = process.env.VERCEL_API_TOKEN;
    if (!token) throw new Error("VERCEL_API_TOKEN não configurado");

    const filter = "environment eq 'production'" +
        (paths?.length ? " and request_path in (" + paths
            .map(path => "'" + path.replace(/'/g, "''") + "'").join(",") + ")" : "");

    const response = await fetch(
        "https://api.vercel.com/v2/observability/query?teamId=" + encodeURIComponent(VERCEL_TEAM_ID),
        {
            method: "POST",
            headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                metric: "vercel.function_invocation.count",
                scope: {
                    type: "project",
                    ownerId: VERCEL_TEAM_ID,
                    projectIds: [VERCEL_PROJECT_ID],
                },
                aggregation: "sum",
                groupBy: ["route", "http_status"],
                filter,
                startTime: new Date(start).toISOString(),
                endTime: new Date(end).toISOString(),
                granularity,
                limit: 500,
            }),
            signal: AbortSignal.timeout(30_000),
            cache: "no-store",
        },
    );
    if (!response.ok) throw new Error("Vercel API: HTTP " + response.status);
    const result = await response.json() as {
        summary?: MetricRow[];
        data?: MetricRow[];
    };
    if (!Array.isArray(result.summary) || !Array.isArray(result.data)) {
        throw new Error("Vercel API: resposta de métricas inválida");
    }

    const counts = new Map<string, { success: number; failures: number }>();
    for (const row of result.summary) {
        const requestedPath = row.route ?? row.request_path;
        if (!requestedPath?.startsWith("/api/")) continue;
        const amount = metricCount(row);
        if (!amount) continue;
        const path = routePath(requestedPath);
        const item = counts.get(path) ?? { success: 0, failures: 0 };
        if (countAsFailure(statusCode(row))) item.failures += amount;
        else item.success += amount;
        counts.set(path, item);
    }
    const logs: VercelLog[] = result.data.flatMap(row => {
        const requestedPath = row.route ?? row.request_path;
        if (!requestedPath?.startsWith("/api/")) return [];
        const amount = metricCount(row);
        const at = Date.parse(row.timestamp ?? "");
        if (!amount || !Number.isFinite(at)) return [];
        return [{
            requestPath: routePath(requestedPath),
            responseStatusCode: statusCode(row) ?? undefined,
            timestampInMs: at,
            count: amount,
        }];
    });
    return { start, end, logs, counts };
}

async function vercelLogs(): Promise<MetricsResult> {
    const now = Date.now();
    const recentStart = now - RECENT_WINDOW_MS;
    const dailyStart = now - DAILY_WINDOW_MS;
    const weeklyStart = now - WEEKLY_WINDOW_MS;
    const paths = relevantPaths();
    const fastPaths = new Set(vercelConfig.crons
        .filter(job => hasFrequentSchedule(job.schedule, now))
        .map(job => routePath(job.path)));
    const weeklyPaths = new Set(vercelConfig.crons
        .filter(job => {
            const lastDue = latestScheduledRun(job.schedule, now);
            return lastDue !== null && lastDue < dailyStart;
        })
        .map(job => routePath(job.path)));

    const queries = await Promise.allSettled([
        queryMetric(recentStart, now, { minutes: 5 }),
        queryMetric(dailyStart, recentStart, { hours: 1 }, paths),
        fastPaths.size ? queryMetric(recentStart, now, { minutes: 5 }, [...fastPaths]) : Promise.resolve(null),
        weeklyPaths.size ? queryMetric(weeklyStart, dailyStart, { days: 1 }, [...weeklyPaths]) : Promise.resolve(null),
    ]);
    const unpack = (index: number): MetricSlice | null => {
        const result = queries[index];
        return result?.status === "fulfilled" ? result.value : null;
    };
    const recent = unpack(0);
    const history = unpack(1);
    const fast = unpack(2);
    const weekly = unpack(3);
    const errors = queries.flatMap((query, index) =>
        query.status === "rejected" ?
            [(index === 0 ? "recentes" : index === 1 ? "históricas" : index === 2 ? "frequentes" : "semanais") +
                ": " + (query.reason instanceof Error ? query.reason.message : "Falha na consulta")] : [],
    );
    const slices = [
        ...(fast ? [fast] : []),
        ...(recent ? [recent] : []),
        ...(history ? [history] : []),
        ...(weekly ? [weekly] : []),
    ];
    const counts = new Map<string, { success: number; failures: number }>();
    const logs: VercelLog[] = [];
    for (const slice of slices) {
        for (const [path, item] of slice.counts) {
            if (slice === recent && fast?.counts.has(path)) continue;
            const total = counts.get(path) ?? { success: 0, failures: 0 };
            total.success += item.success;
            total.failures += item.failures;
            counts.set(path, total);
        }
        logs.push(...slice.logs.filter(log =>
            slice !== recent || !fast?.counts.has(routePath(log.requestPath!)),
        ));
    }
    logs.sort((a, b) => b.timestampInMs! - a.timestampInMs!);
    return {
        slices, logs, counts, recent, fast, weekly, fastPaths, weeklyPaths,
        coreOK: Boolean(recent && history),
        errors,
    };
}

function matchesField(field: string, number: number): boolean {
    return field.split(",").some(part => {
        const [span, stepValue] = part.split("/");
        const step = stepValue === undefined ? 1 : Number(stepValue);
        if (!Number.isInteger(step) || step < 1) return false;
        if (span === "*") return number % step === 0;
        const [start, end] = span.split("-").map(Number);
        if (!Number.isInteger(start)) return false;
        if (end === undefined) return number === start;
        return Number.isInteger(end) && number >= start && number <= end &&
            (number - start) % step === 0;
    });
}

function matchesSchedule(schedule: string, date: Date) {
    const fields = schedule.trim().split(/\s+/);
    if (fields.length !== 5) return false;
    const [minute, hour, day, month, weekDay] = fields;
    return matchesField(minute, date.getUTCMinutes()) &&
        matchesField(hour, date.getUTCHours()) &&
        matchesField(day, date.getUTCDate()) &&
        matchesField(month, date.getUTCMonth() + 1) &&
        matchesField(weekDay, date.getUTCDay());
}

function latestScheduledRun(schedule: string, now: number): number | null {
    const end = Math.floor((now - MISSED_GRACE_MS) / 60_000) * 60_000;
    for (let i = 0; i < WEEKLY_WINDOW_MS / 60_000; i++) {
        const at = end - i * 60_000;
        if (matchesSchedule(schedule, new Date(at))) return at;
    }
    return null;
}

function serviceFromLogs(
    id: string, name: string, category: HealthCategory, path: string,
    matches: VercelLog[], metrics: MetricsResult, schedule?: string,
): HealthService {
    const route = routePath(path);
    const last = matches[0];
    const success = matches.find(item => !isFailure(item));
    const failure = matches.find(isFailure);
    const totals = metrics.counts.get(route) ?? { success: 0, failures: 0 };
    // Prefer the newest queried interval. An old failure followed by a successful
    // request is not an active outage.
    const latestWindow = metrics.slices.find(slice =>
        (slice !== metrics.recent || !metrics.fast?.counts.has(route)) &&
        slice.counts.has(route),
    );
    const latestCounts = latestWindow?.counts.get(route);
    const status: HealthStatus = latestCounts?.success ? "healthy" :
        latestCounts?.failures ? "failed" : "unknown";
    const lastSeen = last ? new Date(last.timestampInMs!).toISOString() : null;
    return {
        id, name, category, path, schedule, status,
        last_seen: lastSeen,
        last_success: success ? new Date(success.timestampInMs!).toISOString() : null,
        last_failure: failure ? new Date(failure.timestampInMs!).toISOString() : null,
        detail: !latestWindow ? "Sem atividade no período monitorado" :
            totals.failures ? totals.success + " respostas bem-sucedidas · " +
                totals.failures + " falhas registradas" :
                totals.success + " respostas bem-sucedidas no período",
        failures: totals.failures,
    };
}

function serviceWithoutMetrics(
    id: string, name: string, category: HealthCategory, path: string, schedule?: string,
): HealthService {
    return {
        id, name, category, path, schedule, status: "unknown",
        last_seen: null, last_success: null, last_failure: null,
        detail: "Métricas do Vercel indisponíveis", failures: 0,
    };
}

export async function collectHealth(): Promise<HealthSnapshot> {
    const now = Date.now();
    const [vercelResult, postgresResult] = await Promise.allSettled([
        vercelLogs(),
        supabase.rpc("health_pg_cron_snapshot"),
    ]);
    const metrics = vercelResult.status === "fulfilled" ? vercelResult.value : null;
    const vercelOK = Boolean(metrics?.coreOK);
    const logs = metrics?.logs ?? [];
    const pgError = postgresResult.status === "rejected"
        ? postgresResult.reason instanceof Error ? postgresResult.reason.message : "Erro ao consultar Supabase"
        : postgresResult.value.error?.message;
    const pgOK = postgresResult.status === "fulfilled" && !pgError;
    const jobs = pgOK && Array.isArray(postgresResult.value.data)
        ? postgresResult.value.data as CronJob[] : [];
    const services: HealthService[] = [];

    const schedules = vercelConfig.crons;
    const matchingPaths = new Map<string, number>();
    for (const cron of schedules) {
        const path = routePath(cron.path);
        matchingPaths.set(path, (matchingPaths.get(path) ?? 0) + 1);
    }
    for (const cron of schedules) {
        const path = routePath(cron.path);
        const ambiguous = (matchingPaths.get(path) ?? 0) > 1;
        const matches = logs.filter(log => routePath(log.requestPath!) === path);
        const service = metrics ?
            serviceFromLogs("vercel:" + cron.path, cron.path, "cron", cron.path, matches, metrics, cron.schedule) :
            serviceWithoutMetrics("vercel:" + cron.path, cron.path, "cron", cron.path, cron.schedule);
        const expected = latestScheduledRun(cron.schedule, now);
        const covered = expected !== null && metrics?.coreOK &&
            (expected >= now - DAILY_WINDOW_MS ||
                Boolean(metrics.weekly && metrics.weeklyPaths.has(path)));

        if (!ambiguous && covered && service.status === "unknown") {
            // A complete historical query with no activity in this route confirms
            // that the expected execution was not observed.
            service.status = "failed";
            service.last_failure = new Date(expected! + MISSED_GRACE_MS).toISOString();
            service.detail = "Execução agendada sem requisição registrada no Vercel";
        }
        if (!ambiguous && expected !== null && metrics?.fast &&
            metrics.fastPaths.has(path) && expected >= metrics.fast.start) {
            const observed = metrics.fast.logs.some(log =>
                log.requestPath === path && !isFailure(log) &&
                log.timestampInMs! >= expected - 5 * 60_000 &&
                log.timestampInMs! <= expected + 5 * 60_000,
            );
            if (!observed) {
                service.status = "failed";
                service.last_failure = new Date(expected + MISSED_GRACE_MS).toISOString();
                service.detail = "Execução agendada não confirmada nas métricas do Vercel";
            }
        }
        if (ambiguous && service.status !== "unknown") {
            service.detail += " · Rota compartilhada; variante não identificada";
        }
        services.push(service);
    }

    for (const webhook of WEBHOOKS) {
        const matches = logs.filter(log => routePath(log.requestPath!) === webhook.path);
        services.push(metrics ?
            serviceFromLogs("webhook:" + webhook.path, webhook.name, "webhook", webhook.path, matches, metrics) :
            serviceWithoutMetrics("webhook:" + webhook.path, webhook.name, "webhook", webhook.path));
    }

    for (const job of jobs) {
        const last = job.last_run;
        const status = !job.active ? "warning" : !last ? "unknown" :
            last.status === "succeeded" || last.status === "running" ? "healthy" :
            last.status === "failed" ? "failed" : "warning";
        services.push({
            id: "postgres:" + job.name,
            name: job.name, category: "database", path: "pg_cron",
            schedule: job.schedule, status,
            last_seen: last?.started_at ?? null,
            last_success: last?.status === "succeeded" ? last.finished_at ?? last.started_at : null,
            last_failure: last?.status === "failed" ? last.finished_at ?? last.started_at : null,
            detail: !job.active ? "Job desativado" : !last ? "Sem execução registrada" :
                last.status === "failed" ? last.message || "Falha no pg_cron" : last.status,
            failures: last?.status === "failed" ? 1 : 0,
        });
    }

    const known = new Set(services.filter(item => item.category !== "database")
        .map(item => routePath(item.path)));
    // Detect failures in other API routes without copying their execution history.
    for (const [path, counts] of metrics?.recent?.counts ?? []) {
        if (counts.failures < 1 || known.has(path)) continue;
        const matches = logs.filter(log => routePath(log.requestPath!) === path);
        services.push(serviceFromLogs(
            "api:" + path, labelForPath(path), categoryForPath(path), path,
            matches, metrics!,
        ));
    }

    // Observability returns five-minute aggregates, not individual requests.
    const attempts: HealthAttempt[] = logs.filter(log =>
        log.timestampInMs! >= now - RECENT_WINDOW_MS).slice(0, 150).map((log, index) => {
        const path = routePath(log.requestPath!);
        const status = isFailure(log) ? "failed" : "success";
        return {
            id: String(log.timestampInMs) + ":" + path + ":" + String(log.responseStatusCode) + ":" + index,
            service: labelForPath(path),
            category: categoryForPath(path),
            path,
            at: new Date(log.timestampInMs!).toISOString(),
            status_code: typeof log.responseStatusCode === "number" ? log.responseStatusCode : null,
            status,
            detail: String(log.count ?? 1) + " requisições (intervalo de 5 min)",
        };
    });

    return {
        checked_at: new Date(now).toISOString(),
        sources: {
            vercel: {
                ok: vercelOK,
                detail: !metrics ?
                    (vercelResult.status === "rejected" && vercelResult.reason instanceof Error ?
                        vercelResult.reason.message : "Falha ao consultar Vercel") :
                    metrics.errors.length ? metrics.errors.join("; ") : "Conectado",
            },
            supabase: { ok: pgOK, detail: pgOK ? "Conectado" : pgError || "Falha ao consultar Supabase" },
        },
        services, attempts,
    };
}

let cached: { expires: number; snapshot: HealthSnapshot } | null = null;
let pending: Promise<HealthSnapshot> | null = null;

export function getHealthSnapshot(): Promise<HealthSnapshot> {
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.snapshot);
    if (pending) return pending;
    pending = collectHealth().then(snapshot => {
        cached = { expires: Date.now() + 90_000, snapshot };
        return snapshot;
    }).finally(() => { pending = null; });
    return pending;
}
