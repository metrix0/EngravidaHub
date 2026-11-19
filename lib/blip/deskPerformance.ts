// lib/blip/deskPerformance.ts
import { randomUUID } from "node:crypto";
import { z } from "zod";

const DAY = 86_400_000;
const PAGE_SIZE = 100;
const BOT = "atendimento638573549519907613";
const DATE_FIELDS = ["storageDate", "openDate", "closeDate"] as const;
const CLIENT_CLOSURES = new Set(["closedclient", "closedclientinactivity"]);
const AC_QUEUES = [
    ["Assistência BH", "Belo Horizonte"],
    ["Assistência DF", "Distrito Federal"],
    ["Assistência MG", "Juiz de Fora"],
    ["Assistência AM", "Manaus"],
    ["Assistência RJ", "Rio de Janeiro"],
    ["Assistências SP", "São Paulo"],
] as const;

const dateField = z.string().nullish();
const ticketSchema = z.object({
    id: z.string().min(1),
    team: z.string().nullish(),
    agentIdentity: z.string().nullish(),
    status: z.string().min(1),
    storageDate: z.string(),
    openDate: dateField,
    closeDate: dateField,
    firstResponseDate: dateField,
});
const responseSchema = z.object({
    status: z.literal("success"),
    resource: z.object({ items: z.array(ticketSchema) }),
});
export type DeskTicket = z.infer<typeof ticketSchema>;

export type DeskMetrics = {
    opened: number;
    closed: number;
    lost: number;
    abandoned: number;
    collaborators: number;
    firstResponse: number | null;
    wait: number | null;
    queue: number | null;
    service: number | null;
};

export type DeskQueue = DeskMetrics & { name: string };
export type DeskUnit = DeskQueue & { acTickets: number | null };
export type DeskPerformance = {
    all: DeskMetrics;
    ra: DeskMetrics;
    ac: DeskMetrics;
    acTickets: number | null;
    queues: DeskQueue[];
    units: DeskUnit[];
};

type Times = "firstResponse" | "wait" | "queue" | "service";
const TIMES: Times[] = ["firstResponse", "wait", "queue", "service"];
type Bucket = {
    opened: number;
    closed: number;
    lost: number;
    abandoned: number;
    agents: Set<string>;
    times: Record<Times, { sum: number; count: number }>;
};

function bucket(): Bucket {
    return {
        opened: 0, closed: 0, lost: 0, abandoned: 0, agents: new Set(),
        times: { firstResponse: { sum: 0, count: 0 }, wait: { sum: 0, count: 0 },
            queue: { sum: 0, count: 0 }, service: { sum: 0, count: 0 } },
    };
}

function report(bucket: Bucket): DeskMetrics {
    const average = (key: Times) => bucket.times[key].count
        ? Math.round(bucket.times[key].sum / bucket.times[key].count / 1000) : null;
    return {
        opened: bucket.opened, closed: bucket.closed, lost: bucket.lost, abandoned: bucket.abandoned,
        collaborators: bucket.agents.size, firstResponse: average("firstResponse"),
        wait: average("wait"), queue: average("queue"), service: average("service"),
    };
}

function agentId(identity: string | null | undefined) {
    const value = identity?.trim().toLowerCase();
    if (!value) return null;
    const encodedEmail = value.split("@")[0];
    return encodedEmail.includes("%40") ? encodedEmail.replace(/%40/g, "@") : value;
}

function ticketDate(value: string | null | undefined) {
    if (!value || value.startsWith("0001-01-01")) return null;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new Error("Data de ticket inválida");
    return time;
}

function record(
    target: Bucket, opened: boolean, closed: boolean, lost: boolean, abandoned: boolean,
    agent: string | null, durations: Record<Times, number | null>,
) {
    target.opened += Number(opened);
    target.closed += Number(closed);
    target.lost += Number(lost);
    target.abandoned += Number(abandoned);
    if (agent) target.agents.add(agent);
    if (!closed) return;
    for (const key of TIMES) {
        const duration = durations[key];
        if (duration !== null && duration >= 0) {
            target.times[key].sum += duration;
            target.times[key].count++;
        }
    }
}

function duration(from: number | null, to: number | null) {
    return from === null || to === null ? null : to - from;
}

export function buildDeskPerformance(
    tickets: Iterable<DeskTicket>, start: number, end: number, roster: ReadonlySet<string>,
): DeskPerformance {
    const all = bucket(), ac = bucket(), ra = bucket();
    const queues = new Map<string, Bucket>();
    const acByQueue = new Map<string, number>();
    const acQueues = new Set<string>(AC_QUEUES.map(([name]) => name));
    const inPeriod = (value: number | null) => value !== null && value >= start && value < end;
    for (const ticket of tickets) {
        const queueName = ticket.team?.trim() || "Fila não informada";
        const storedAt = ticketDate(ticket.storageDate);
        const assignedAt = ticketDate(ticket.openDate);
        const closedAt = ticketDate(ticket.closeDate);
        const firstAt = ticketDate(ticket.firstResponseDate);
        const opened = inPeriod(storedAt);
        const closed = inPeriod(closedAt);
        const agent = agentId(ticket.agentIdentity);
        const agentInPeriod = inPeriod(assignedAt) ? agent : null;
        if (!opened && !closed && !agentInPeriod) continue;
        const clientClosed = opened && CLIENT_CLOSURES.has(ticket.status.toLowerCase());
        const lost = clientClosed && !agent, abandoned = clientClosed && Boolean(agent);
        const times = {
            firstResponse: duration(assignedAt, firstAt),
            wait: duration(storedAt, firstAt ?? closedAt),
            queue: duration(storedAt, assignedAt),
            service: duration(firstAt, closedAt),
        };
        const queue = queues.get(queueName) ?? bucket();
        record(queue, opened, closed, lost, abandoned, agentInPeriod, times);
        queues.set(queueName, queue);
        record(all, opened, closed, lost, abandoned, agentInPeriod, times);
        if (queueName === "RA") record(ra, opened, closed, lost, abandoned, agentInPeriod, times);
        if (acQueues.has(queueName)) {
            record(ac, opened, closed, lost, abandoned, agentInPeriod, times);
            if (closed && agent && roster.has(agent)) acByQueue.set(queueName, (acByQueue.get(queueName) ?? 0) + 1);
        }
    }
    return {
        all: report(all), ra: report(ra), ac: report(ac),
        acTickets: roster.size ? [...acByQueue.values()].reduce((sum, count) => sum + count, 0) : null,
        queues: [...queues.entries()].map(([name, totals]) => ({ name, ...report(totals) }))
            .sort((first, second) => second.closed - first.closed || first.name.localeCompare(second.name, "pt-BR")),
        units: AC_QUEUES.map(([queue, name]) => ({
            name, ...report(queues.get(queue) ?? bucket()),
            acTickets: roster.size ? acByQueue.get(queue) ?? 0 : null,
        })),
    };
}

export class BlipDeskConfigurationError extends Error {}

function deskCredentials() {
    const contract = process.env.BLIP_CONTRACT_ID?.trim() || "engravida";
    const dedicatedKey = process.env.BLIP_PERFORMANCE_AUTH_KEY?.trim();
    const key = (dedicatedKey || process.env.BLIP_AUTH_KEY?.trim() || "").replace(/^Key\s+/i, "");
    const identity = Buffer.from(key, "base64").toString("utf8").split(":")[0]?.split("@")[0];
    if (!/^[a-z0-9-]+$/i.test(contract) || !key || (!dedicatedKey && identity !== BOT)) {
        throw new BlipDeskConfigurationError("Configure BLIP_PERFORMANCE_AUTH_KEY para o bot Clínica Engravida.");
    }
    if (identity && /^[a-z0-9-]+$/i.test(identity) && identity !== BOT) {
        throw new BlipDeskConfigurationError("A chave do histórico precisa pertencer ao bot Clínica Engravida.");
    }
    return { endpoint: `https://${contract}.http.msging.net/commands`, key };
}

async function readTicketWindow(
    credentials: ReturnType<typeof deskCredentials>, start: number, end: number, signal: AbortSignal,
) {
    const from = new Date(start).toISOString(), to = new Date(end).toISOString();
    const filter = DATE_FIELDS.map(field =>
        `(${field} ge datetimeoffset'${from}' and ${field} lt datetimeoffset'${to}')`,
    ).join(" or ");
    const tickets = new Map<string, DeskTicket>();
    for (let skip = 0; ; skip += PAGE_SIZE) {
        const response = await fetch(credentials.endpoint, {
            method: "POST", cache: "no-store", signal,
            headers: { "Content-Type": "application/json", Authorization: `Key ${credentials.key}` },
            body: JSON.stringify({
                id: randomUUID(), to: "postmaster@desk.msging.net", method: "get",
                uri: `/tickets/history/metadata?$skip=${skip}&$take=${PAGE_SIZE}&$filter=${encodeURIComponent(filter)}`,
            }),
        });
        if (!response.ok) throw new Error(`Histórico Blip retornou HTTP ${response.status}`);
        const parsed = responseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Resposta incompatível do histórico Blip");
        const page = parsed.data.resource.items;
        for (const ticket of page) {
            if (!DATE_FIELDS.some(field => {
                const time = ticketDate(ticket[field]);
                return time !== null && time >= start && time < end;
            })) throw new Error("O histórico Blip não aplicou o intervalo solicitado");
            if (tickets.has(ticket.id)) throw new Error("O histórico Blip retornou tickets repetidos na paginação");
            tickets.set(ticket.id, ticket);
        }
        if (page.length < PAGE_SIZE) return tickets;
    }
}

export async function loadDeskPerformance(startDate: string, endDate: string) {
    const credentials = deskCredentials();
    const start = Date.parse(startDate + "T00:00:00-03:00");
    const end = Date.parse(endDate + "T00:00:00-03:00") + DAY;
    const roster = new Set((process.env.BLIP_PERFORMANCE_AC_ATTENDANTS ?? "").split(",")
        .map(agentId).filter((id): id is string => id !== null));
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(50_000)]);
    const tickets = new Map<string, DeskTicket>();
    let nextStart = start;
    try {
        await Promise.all(Array.from({ length: 4 }, async () => {
            while (nextStart < end) {
                const windowStart = nextStart, windowEnd = Math.min(end, windowStart + 3 * DAY);
                nextStart = windowEnd;
                const page = await readTicketWindow(credentials, windowStart, windowEnd, signal);
                for (const [id, ticket] of page) tickets.set(id, ticket);
            }
        }));
    } catch (error) {
        abort.abort();
        throw error;
    }
    return buildDeskPerformance(tickets.values(), start, end, roster);
}
