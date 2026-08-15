// app/api/(cron)/(automations)/resgate/route.ts
import { NextResponse } from "next/server";

import {
    ActiveMessageBatchError,
    MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND,
    sendActiveMessageBatch,
} from "@/lib/active-messages/sendActiveMessageBatch";
import {
    getActiveMessageTemplate,
    type ActiveMessageTemplate,
} from "@/lib/active-messages/templates";
import { supabase } from "@/lib/supabase/client";
import type { ActiveMessageSendResponse } from "@/types/activeMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_RECIPIENT_COUNT = 60;
const DAYS_SINCE_LAST_CLIENT_MESSAGE = 9;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const DATABASE_PAGE_SIZE = 1_000;

const RESGATE_BUCKETS = [
    {
        key: "lgbt",
        label: "LGBT",
        templateId: "recaptacao_clientes_problemas_e_lgbt",
    },
    {
        key: "congelamento",
        label: "Congelamento",
        templateId: "recaptacao_clientes_congelamento_util",
    },
    {
        key: "laqueadura",
        label: "Laqueadura",
        templateId: "recaptacao_clientes_laqueadura",
    },
    {
        key: "organico",
        label: "Orgânico",
        templateId: "recaptacao_clientes_organico_util",
    },
] as const;

type ResgateBucketKey = (typeof RESGATE_BUCKETS)[number]["key"];

type ClientRow = {
    id: string;
    phone: string | null;
    funnel_stage_id: string | null;
    last_tunnel: string | null;
    last_closing_tag: string | null;
};

type ThreadRow = {
    client_id: string | null;
    last_client_message_at: string | null;
};

type FunnelStageRow = {
    id: string;
    funnel_id: string;
};

type FunnelRow = {
    id: string;
    name: string | null;
};

type EligibleClient = ClientRow & {
    last_client_message_at: string;
    bucket: ResgateBucketKey;
};

type GroupResult = {
    bucket: ResgateBucketKey;
    tunnel: string;
    template_id: string;
    eligible_count: number;
    selected_count: number;
    batch_id: string | null;
    status: ActiveMessageSendResponse["status"] | "skipped" | "error";
    sent_count: number;
    failed_count: number;
    error: string | null;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const requestedCountResult = parseRequestedCount(searchParams.get("n"));

    if (requestedCountResult.ok === false) {
        return NextResponse.json(
            { ok: false, error: requestedCountResult.error },
            { status: 400 },
        );
    }

    const requestedCount = requestedCountResult.value;
    const targetDate = getSaoPauloDateDaysAgo(
        DAYS_SINCE_LAST_CLIENT_MESSAGE,
    );
    const { start, end } = getSaoPauloDayBounds(targetDate);

    try {
        const previousRun = await loadPreviousRun(targetDate);

        if (previousRun.processing) {
            return NextResponse.json({
                ok: true,
                skipped: true,
                reason: "already_processing",
                automation: "resgate",
                requested_count: requestedCount,
                target_last_client_message_date: targetDate,
                already_sent_count: previousRun.sentClientIds.size,
                selected_count: 0,
                sent_count: 0,
                failed_count: 0,
                groups: [],
            });
        }

        const eligibleClients = (
            await loadEligibleClients({ start, end })
        ).filter((client) => !previousRun.attemptedClientIds.has(client.id));
        const candidatesByBucket = groupEligibleClients(eligibleClients);
        const selectedByBucket = allocateRecipients({
            candidatesByBucket,
            requestedCount,
        });
        const groupResults: GroupResult[] = [];

        for (const bucketConfig of RESGATE_BUCKETS) {
            const selected = selectedByBucket[bucketConfig.key];
            const eligibleCount =
                candidatesByBucket[bucketConfig.key].length;

            if (selected.length === 0) {
                groupResults.push({
                    bucket: bucketConfig.key,
                    tunnel: bucketConfig.label,
                    template_id: bucketConfig.templateId,
                    eligible_count: eligibleCount,
                    selected_count: 0,
                    batch_id: null,
                    status: "skipped",
                    sent_count: 0,
                    failed_count: 0,
                    error: null,
                });
                continue;
            }

            try {
                const template = requireTemplate(bucketConfig.templateId);
                const result = await sendActiveMessageBatch({
                    template,
                    clientIds: selected.map((client) => client.id),
                    filters: {
                        automation: "resgate",
                        target_last_client_message_date: targetDate,
                        days_since_last_client_message:
                            DAYS_SINCE_LAST_CLIENT_MESSAGE,
                        closing_tags: ["Não agendou", "Sem retorno"],
                        excluded_funnel: "Funil Agendamento",
                        tunnel_group: bucketConfig.key,
                        requested_total: requestedCount,
                    },
                    actor: {
                        id: null,
                        name: "Automação de resgate",
                    },
                });

                groupResults.push({
                    bucket: bucketConfig.key,
                    tunnel: bucketConfig.label,
                    template_id: bucketConfig.templateId,
                    eligible_count: eligibleCount,
                    selected_count: selected.length,
                    batch_id: result.batch_id,
                    status: result.status,
                    sent_count: result.sent_count,
                    failed_count: result.failed_count,
                    error: null,
                });
            } catch (error) {
                groupResults.push({
                    bucket: bucketConfig.key,
                    tunnel: bucketConfig.label,
                    template_id: bucketConfig.templateId,
                    eligible_count: eligibleCount,
                    selected_count: selected.length,
                    batch_id:
                        error instanceof ActiveMessageBatchError
                            ? error.batchId
                            : null,
                    status: "error",
                    sent_count: 0,
                    failed_count: selected.length,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Falha inesperada no envio",
                });
            }
        }

        const selectedCount = groupResults.reduce(
            (total, group) => total + group.selected_count,
            0,
        );
        const sentCount = groupResults.reduce(
            (total, group) => total + group.sent_count,
            0,
        );
        const failedCount = groupResults.reduce(
            (total, group) => total + group.failed_count,
            0,
        );
        const hasFatalError = groupResults.some(
            (group) => group.status === "error",
        );

        return NextResponse.json(
            {
                ok: !hasFatalError && failedCount === 0,
                automation: "resgate",
                requested_count: requestedCount,
                target_last_client_message_date: targetDate,
                already_sent_count: previousRun.sentClientIds.size,
                eligible_count: eligibleClients.length,
                selected_count: selectedCount,
                sent_count: sentCount,
                total_sent_count:
                    previousRun.sentClientIds.size + sentCount,
                failed_count: failedCount,
                groups: groupResults,
            },
            { status: hasFatalError ? 500 : 200 },
        );
    } catch (error) {
        console.error("[automations/resgate] failed", error);

        return NextResponse.json(
            {
                ok: false,
                automation: "resgate",
                requested_count: requestedCount,
                target_last_client_message_date: targetDate,
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível executar o resgate",
            },
            { status: 500 },
        );
    }
}

async function loadPreviousRun(targetDate: string) {
    const batches: Array<{
        status: string;
        results: unknown;
        client_ids: string[] | null;
    }> = [];

    for (let offset = 0; ; offset += DATABASE_PAGE_SIZE) {
        const { data, error } = await supabase
            .from("active_message_sends")
            .select("status, results, client_ids")
            .contains("filters", {
                automation: "resgate",
                target_last_client_message_date: targetDate,
            })
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(offset, offset + DATABASE_PAGE_SIZE - 1);

        if (error) throw error;

        const page = data ?? [];
        batches.push(...page);
        if (page.length < DATABASE_PAGE_SIZE) break;
    }

    const sentClientIds = new Set<string>();
    const attemptedClientIds = new Set<string>();
    let processing = false;

    for (const batch of batches) {
        if (batch.status === "processing") processing = true;

        for (const clientId of batch.client_ids ?? []) {
            if (typeof clientId !== "string" || !clientId.trim()) continue;
            attemptedClientIds.add(clientId);
        }

        if (!Array.isArray(batch.results)) continue;
        for (const result of batch.results) {
            if (!isRecord(result)) continue;
            if (result.status !== "sent") continue;
            if (typeof result.client_id !== "string") continue;
            sentClientIds.add(result.client_id);
        }
    }

    return { processing, sentClientIds, attemptedClientIds };
}

async function loadEligibleClients({
    start,
    end,
}: {
    start: string;
    end: string;
}) {
    const [clients, threads, stagesResult, funnelsResult] = await Promise.all([
        loadCandidateClients(),
        loadTargetDayThreads({ start, end }),
        supabase.from("funnel_stages").select("id, funnel_id"),
        supabase.from("funnels").select("id, name"),
    ]);

    const firstError = [
        stagesResult.error,
        funnelsResult.error,
    ].find(Boolean);

    if (firstError) throw firstError;

    const threadsByClientId = new Map<string, string>();

    for (const thread of threads) {
        if (!thread.client_id || !thread.last_client_message_at) continue;

        const current = threadsByClientId.get(thread.client_id);
        if (
            !current ||
            new Date(thread.last_client_message_at).getTime() >
                new Date(current).getTime()
        ) {
            threadsByClientId.set(
                thread.client_id,
                thread.last_client_message_at,
            );
        }
    }

    const funnelNameById = new Map(
        ((funnelsResult.data ?? []) as FunnelRow[]).map((funnel) => [
            funnel.id,
            funnel.name,
        ]),
    );
    const funnelNameByStageId = new Map(
        ((stagesResult.data ?? []) as FunnelStageRow[]).map((stage) => [
            stage.id,
            funnelNameById.get(stage.funnel_id) ?? null,
        ]),
    );

    return clients
        .flatMap((client): EligibleClient[] => {
            const lastClientMessageAt = threadsByClientId.get(client.id);
            if (!lastClientMessageAt || !client.phone?.trim()) return [];

            if (!hasEligibleClosingTag(client.last_closing_tag)) return [];

            const funnelName = client.funnel_stage_id
                ? funnelNameByStageId.get(client.funnel_stage_id)
                : null;

            if (normalizeForMatch(funnelName) === "funil agendamento") {
                return [];
            }

            return [
                {
                    ...client,
                    last_client_message_at: lastClientMessageAt,
                    bucket: resolveBucket(client.last_tunnel),
                },
            ];
        })
        .sort(
            (first, second) =>
                new Date(first.last_client_message_at).getTime() -
                    new Date(second.last_client_message_at).getTime() ||
                first.id.localeCompare(second.id),
        );
}

async function loadCandidateClients() {
    const rows: ClientRow[] = [];

    for (let offset = 0; ; offset += DATABASE_PAGE_SIZE) {
        const { data, error } = await supabase
            .from("clients")
            .select(
                "id, phone, funnel_stage_id, last_tunnel, last_closing_tag",
            )
            .not("phone", "is", null)
            .or(
                "last_closing_tag.ilike.%Não agendou%,last_closing_tag.ilike.%Sem retorno%",
            )
            .order("id", { ascending: true })
            .range(offset, offset + DATABASE_PAGE_SIZE - 1);

        if (error) throw error;

        const page = (data ?? []) as ClientRow[];
        rows.push(...page);
        if (page.length < DATABASE_PAGE_SIZE) break;
    }

    return rows;
}

async function loadTargetDayThreads({
    start,
    end,
}: {
    start: string;
    end: string;
}) {
    const rows: ThreadRow[] = [];

    for (let offset = 0; ; offset += DATABASE_PAGE_SIZE) {
        const { data, error } = await supabase
            .from("thread")
            .select("client_id, last_client_message_at")
            .gte("last_client_message_at", start)
            .lt("last_client_message_at", end)
            .order("last_client_message_at", { ascending: true })
            .range(offset, offset + DATABASE_PAGE_SIZE - 1);

        if (error) throw error;

        const page = (data ?? []) as ThreadRow[];
        rows.push(...page);
        if (page.length < DATABASE_PAGE_SIZE) break;
    }

    return rows;
}

function groupEligibleClients(clients: EligibleClient[]) {
    const groups: Record<ResgateBucketKey, EligibleClient[]> = {
        lgbt: [],
        congelamento: [],
        laqueadura: [],
        organico: [],
    };

    for (const client of clients) groups[client.bucket].push(client);

    return groups;
}

function allocateRecipients({
    candidatesByBucket,
    requestedCount,
}: {
    candidatesByBucket: Record<ResgateBucketKey, EligibleClient[]>;
    requestedCount: number;
}) {
    const selected: Record<ResgateBucketKey, EligibleClient[]> = {
        lgbt: [],
        congelamento: [],
        laqueadura: [],
        organico: [],
    };
    const baseQuota = Math.floor(requestedCount / RESGATE_BUCKETS.length);
    const quotaRemainder = requestedCount % RESGATE_BUCKETS.length;

    RESGATE_BUCKETS.forEach((bucket, index) => {
        const quota = baseQuota + (index < quotaRemainder ? 1 : 0);
        selected[bucket.key] = candidatesByBucket[bucket.key].slice(0, quota);
    });

    let remaining =
        requestedCount -
        RESGATE_BUCKETS.reduce(
            (total, bucket) => total + selected[bucket.key].length,
            0,
        );

    while (remaining > 0) {
        let redistributed = false;

        for (const bucket of RESGATE_BUCKETS) {
            const bucketCandidates = candidatesByBucket[bucket.key];
            const bucketSelected = selected[bucket.key];

            if (bucketSelected.length >= bucketCandidates.length) continue;

            bucketSelected.push(bucketCandidates[bucketSelected.length]);
            remaining -= 1;
            redistributed = true;

            if (remaining === 0) break;
        }

        if (!redistributed) break;
    }

    return selected;
}

function resolveBucket(value: string | null): ResgateBucketKey {
    const normalized = normalizeForMatch(value);

    if (normalized.includes("lgbt")) return "lgbt";
    if (normalized.includes("congelamento")) return "congelamento";
    if (normalized.includes("laqueadura")) return "laqueadura";
    return "organico";
}

function hasEligibleClosingTag(value: string | null) {
    const normalized = normalizeForMatch(value);
    return (
        normalized.includes("nao agendou") ||
        normalized.includes("sem retorno")
    );
}

function normalizeForMatch(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim()
        .toLocaleLowerCase("pt-BR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireTemplate(templateId: string): ActiveMessageTemplate {
    const template = getActiveMessageTemplate(templateId);
    if (!template) throw new Error(`Template não encontrado: ${templateId}`);
    return template;
}

function parseRequestedCount(value: string | null):
    | { ok: true; value: number }
    | { ok: false; error: string } {
    if (value === null || value.trim() === "") {
        return { ok: true, value: DEFAULT_RECIPIENT_COUNT };
    }

    const parsed = Number(value);
    if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND
    ) {
        return {
            ok: false,
            error: `O parâmetro n deve ser um inteiro entre 1 e ${MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND}.`,
        };
    }

    return { ok: true, value: parsed };
}

function getSaoPauloDateDaysAgo(daysAgo: number, now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: SAO_PAULO_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    const target = new Date(Date.UTC(year, month - 1, day - daysAgo));

    return target.toISOString().slice(0, 10);
}

function getSaoPauloDayBounds(date: string) {
    const startDate = new Date(`${date}T03:00:00.000Z`);
    const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

    return {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
    };
}
