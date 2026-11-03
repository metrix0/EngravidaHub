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
};

type Deployment = { uid?: string; id?: string; created?: number; readyState?: string };
type CronJob = {
    name: string;
    schedule: string;
    active: boolean;
    last_run: { status: string; started_at: string | null; finished_at: string | null; message: string } | null;
};

const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_jb6BkDqYaC4smh5AeD5lIybZMP0L";
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "team_IZl9hS7irDpAG000kYEoKNQZ";
const MAX_LOG_BYTES = 1_500_000;
const LOG_STREAM_SAMPLE_MS = 4_000;
const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const MISSED_GRACE_MS = 5 * 60 * 1000;

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

function asVercelLog(value: unknown): VercelLog | null {
    if (!value || typeof value !== "object") return null;
    const row = value as VercelLog;
    return typeof row.requestPath === "string" && typeof row.timestampInMs === "number" ? row : null;
}

function parseLogResponse(text: string): VercelLog[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = text.split("\n").flatMap(line => {
            line = line.replace(/^data:\s*/, "");
            try { return [JSON.parse(line) as unknown]; } catch { return []; }
        });
    }
    const records = Array.isArray(parsed) ? parsed :
        parsed && typeof parsed === "object" && Array.isArray((parsed as { logs?: unknown[] }).logs)
            ? (parsed as { logs: unknown[] }).logs : [];
    return records.map(asVercelLog).filter((value): value is VercelLog => Boolean(value));
}

async function vercelRequest(path: string, signal?: AbortSignal) {
    const token = process.env.VERCEL_API_TOKEN;
    if (!token) throw new Error("VERCEL_API_TOKEN não configurado");
    const url = "https://api.vercel.com" + path + (path.includes("?") ? "&" : "?") +
        "teamId=" + encodeURIComponent(VERCEL_TEAM_ID);
    const response = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        cache: "no-store",
    });
    if (!response.ok) throw new Error("Vercel API: HTTP " + response.status);
    return response;
}

async function vercelLogs() {
    const query = "/v6/deployments?projectId=" + encodeURIComponent(VERCEL_PROJECT_ID) +
        "&target=production&limit=2";
    const deployments = await (await vercelRequest(query)).json() as { deployments?: Deployment[] };
    const latest = (deployments.deployments ?? []).find(item => item.readyState === "READY");
    const deploymentId = latest?.uid ?? latest?.id;
    if (!deploymentId) throw new Error("Nenhum deployment de produção disponível");
    const controller = new AbortController();
    const response = await vercelRequest(
        "/v1/projects/" + encodeURIComponent(VERCEL_PROJECT_ID) +
        "/deployments/" + encodeURIComponent(deploymentId) + "/runtime-logs",
        controller.signal,
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("A API não retornou logs");
    const decoder = new TextDecoder();
    let raw = "";
    let size = 0;
    let complete = false;
    let partial = false;
    // This endpoint streams live logs. A healthy stream can stay open indefinitely.
    // Sample it for a bounded interval instead of treating the expected cutoff as a failure.
    const timer = setTimeout(() => controller.abort(), LOG_STREAM_SAMPLE_MS);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                complete = true;
                break;
            }
            size += value.byteLength;
            if (size > MAX_LOG_BYTES) {
                partial = true;
                controller.abort();
                break;
            }
            raw += decoder.decode(value, { stream: true });
        }
    } catch (error) {
        if (!controller.signal.aborted) throw error;
    } finally {
        clearTimeout(timer);
        controller.abort();
        reader.releaseLock();
    }
    partial ||= !complete;
    raw += decoder.decode();
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const logs = parseLogResponse(raw)
        .filter(log => log.timestampInMs! >= cutoff && log.requestPath!.startsWith("/api/"))
        .sort((a, b) => b.timestampInMs! - a.timestampInMs!);
    return { logs, partial, deploymentCreatedAt: latest?.created ?? 0 };
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
    for (let i = 0; i < 120; i++) {
        const at = end - i * 60_000;
        if (matchesSchedule(schedule, new Date(at))) return at;
    }
    return null;
}

function serviceFromLogs(
    id: string, name: string, category: HealthCategory, path: string,
    matches: VercelLog[], schedule?: string,
): HealthService {
    const last = matches[0];
    const success = matches.find(item => !isFailure(item));
    const failure = matches.find(isFailure);
    const failures = matches.filter(isFailure).length;
    const lastSeen = last ? new Date(last.timestampInMs!).toISOString() : null;
    return {
        id, name, category, path, schedule,
        status: !last ? "unknown" : isFailure(last) ? "failed" : "healthy",
        last_seen: lastSeen,
        last_success: success ? new Date(success.timestampInMs!).toISOString() : null,
        last_failure: failure ? new Date(failure.timestampInMs!).toISOString() : null,
        detail: !last ? "Sem execuções recentes" :
            isFailure(last) ? (last.responseStatusCode ? "HTTP " + last.responseStatusCode : "Erro registrado no Vercel") :
                "Última requisição concluída",
        failures,
    };
}

export async function collectHealth(): Promise<HealthSnapshot> {
    const now = Date.now();
    const [vercelResult, postgresResult] = await Promise.allSettled([
        vercelLogs(),
        supabase.rpc("health_pg_cron_snapshot"),
    ]);
    const vercelOK = vercelResult.status === "fulfilled";
    const logs = vercelOK ? vercelResult.value.logs : [];
    const partial = vercelOK ? vercelResult.value.partial : false;
    const deploymentCreatedAt = vercelOK ? vercelResult.value.deploymentCreatedAt : 0;
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
        const clean = routePath(cron.path);
        matchingPaths.set(clean, (matchingPaths.get(clean) ?? 0) + 1);
    }
    for (const cron of schedules) {
        const path = routePath(cron.path);
        const ambiguous = (matchingPaths.get(path) ?? 0) > 1 &&
            !logs.some(log => log.requestPath?.includes("?"));
        const matches = logs.filter(log =>
            routePath(log.requestPath!) === path &&
            (ambiguous || !cron.path.includes("?") || log.requestPath === cron.path),
        );
        const service = serviceFromLogs("vercel:" + cron.path, cron.path, "cron", cron.path, matches, cron.schedule);
        if (vercelOK && !partial && !ambiguous) {
            const expected = latestScheduledRun(cron.schedule, now);
            if (expected && deploymentCreatedAt < expected - 60_000 &&
                !matches.some(log => Math.abs(log.timestampInMs! - expected) <= MISSED_GRACE_MS)) {
                service.status = "failed";
                service.last_failure = new Date(expected + MISSED_GRACE_MS).toISOString();
                service.detail = "Execução agendada não encontrada nos logs";
            }
        }
        if (!vercelOK || ((partial || ambiguous) && !matches.length)) {
            service.status = "unknown";
            service.detail = !vercelOK ? "Vercel indisponível" : partial
                ? "Consulta de logs parcial" : "Execuções com rota compartilhada";
        }
        services.push(service);
    }

    for (const webhook of WEBHOOKS) {
        const matching = logs.filter(log => routePath(log.requestPath!) === webhook.path);
        const service = serviceFromLogs("webhook:" + webhook.path, webhook.name, "webhook", webhook.path, matching);
        if (!vercelOK || partial && !matching.length) {
            service.status = "unknown";
            service.detail = vercelOK ? "Consulta parcial" : "Vercel indisponível";
        }
        services.push(service);
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

    const known = new Set(services.filter(item => item.category !== "database").map(item => routePath(item.path)));
    const apiPaths = [...new Set(logs.filter(log => isFailure(log) && !known.has(routePath(log.requestPath!)))
        .map(log => routePath(log.requestPath!)))].slice(0, 30);
    for (const path of apiPaths) {
        services.push(serviceFromLogs(
            "api:" + path, labelForPath(path), categoryForPath(path), path,
            logs.filter(log => routePath(log.requestPath!) === path),
        ));
    }

    const attempts: HealthAttempt[] = logs.slice(0, 150).map((log, index) => {
        const path = routePath(log.requestPath!);
        const status = isFailure(log) ? "failed" : "success";
        return {
            id: log.rowId || String(log.timestampInMs) + ":" + index,
            service: labelForPath(path),
            category: categoryForPath(path),
            path: log.requestPath!,
            at: new Date(log.timestampInMs!).toISOString(),
            status_code: typeof log.responseStatusCode === "number" ? log.responseStatusCode : null,
            status,
            detail: status === "failed" ?
                (log.responseStatusCode ? "HTTP " + log.responseStatusCode : "Erro registrado") : "Concluído",
        };
    });

    return {
        checked_at: new Date(now).toISOString(),
        sources: {
            vercel: {
                ok: vercelOK,
                detail: !vercelOK ? (vercelResult.reason instanceof Error ?
                    vercelResult.reason.message : "Falha ao consultar Vercel") :
                    partial ? "Conectado; verificação de ausências indisponível na amostra" : "Conectado",
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
