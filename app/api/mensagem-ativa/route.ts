// app/api/mensagem-ativa/route.ts

import { NextResponse } from "next/server";

import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import { ACTIVE_MESSAGE_TEMPLATES } from "@/lib/active-messages/templates";
import { getActiveMessageTemplateSenderOptions } from "@/lib/active-messages/templateSenders";
import { supabase } from "@/lib/supabase/client";
import type {
    ActiveMessageClient,
    ActiveMessageFunnelStage,
    ActiveMessageHistoryRecipient,
    ActiveMessageSendHistory,
    ActiveMessagesPageResponse,
} from "@/types/activeMessages";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_CLIENT_MESSAGES = 50_000;
const PAGE_CACHE_MS = 15_000;
const PAGE_STALE_MS = 2 * 60_000;
const NO_CACHE_HEADERS = {
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
};

type ClientApiRow = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    last_interaction_at: string;
    last_origin: string | null;
    last_tunnel: string | null;
    last_closing_tag: string | null;
    last_active_message_sent_at: string | null;
};

type ThreadApiRow = {
    client_id: string | null;
    last_client_message_at: string | null;
};

type MessageApiRow = {
    client_id: string | null;
    sent_at: string | null;
};

type HistoryMetricsRow = {
    send_id: string;
    schedule_count: number | string | null;
    response_count: number | string | null;
};

type RecipientDetailRow = {
    send_id: string;
    client_id: string;
    responded: boolean | null;
    response_target_type: "thread" | "conversation" | null;
    response_target_id: string | null;
};

type StoredRecipientResult = {
    client_id: string;
    client_name: string | null;
    phone: string | null;
    status: "sent" | "failed";
};

let pageCache:
    | {
          data: ActiveMessagesPageResponse;
          expiresAt: number;
          staleUntil: number;
      }
    | null = null;
let pendingPageRequest: Promise<ActiveMessagesPageResponse> | null = null;

export async function GET(request: Request) {
    const access = await requireActiveMessageAccess();

    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status, headers: NO_CACHE_HEADERS },
        );
    }

    try {
        if (new URL(request.url).searchParams.get("refresh") === "1") {
            pageCache = null;
        }
        const response = await loadActiveMessagesPage();

        return NextResponse.json(response, { headers: NO_CACHE_HEADERS });
    } catch (error) {
        console.error("[mensagem-ativa] GET failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar a Mensagem Ativa",
            },
            { status: 500, headers: NO_CACHE_HEADERS },
        );
    }
}

async function loadActiveMessagesPage() {
    const now = Date.now();
    if (pageCache && pageCache.expiresAt > now) return pageCache.data;
    if (pendingPageRequest) return pendingPageRequest;

    const stale = pageCache;
    pendingPageRequest = buildActiveMessagesPage()
        .then((data) => {
            const cachedAt = Date.now();
            pageCache = {
                data,
                expiresAt: cachedAt + PAGE_CACHE_MS,
                staleUntil: cachedAt + PAGE_STALE_MS,
            };
            return data;
        })
        .catch((error) => {
            if (stale && stale.staleUntil > Date.now()) return stale.data;
            throw error;
        })
        .finally(() => {
            pendingPageRequest = null;
        });

    return pendingPageRequest;
}

async function buildActiveMessagesPage(): Promise<ActiveMessagesPageResponse> {
        const [
            clientsResult,
            stagesResult,
            funnelsResult,
            threadsResult,
            historyResult,
        ] =
            await Promise.all([
                supabase
                    .from("clients")
                    .select(`
                        id,
                        name,
                        phone,
                        email,
                        funnel_stage_id,
                        last_interaction_at,
                        last_origin,
                        last_tunnel,
                        last_closing_tag,
                        last_active_message_sent_at
                    `)
                    .order("last_interaction_at", { ascending: false }),
                supabase
                    .from("funnel_stages")
                    .select("id, funnel_id, name, position, color")
                    .order("position", { ascending: true }),
                supabase
                    .from("funnels")
                    .select("id, name")
                    .order("name", { ascending: true }),
                supabase
                    .from("thread")
                    .select("client_id, last_client_message_at")
                    .not("client_id", "is", null)
                    .not("last_client_message_at", "is", null),
                supabase
                    .from("active_message_sends")
                    .select(`
                        id,
                        template_id,
                        template_name,
                        requested_count,
                        sent_count,
                        failed_count,
                        normal_message_count,
                        template_message_count,
                        status,
                        created_by_name,
                        created_at,
                        completed_at,
                        client_ids,
                        results
                    `)
                    .order("created_at", { ascending: false })
                    .limit(50),
            ]);

        const firstError = [
            clientsResult.error,
            stagesResult.error,
            funnelsResult.error,
            threadsResult.error,
            historyResult.error,
        ].find(Boolean);

        if (firstError) throw firstError;

        const clientRows = (clientsResult.data ?? []) as ClientApiRow[];
        const clientById = new Map(clientRows.map((client) => [client.id, client]));
        const historyRows = historyResult.data ?? [];
        const sendIds = historyRows.map((item) => item.id);
        const [metricsBySendId, recipientDetailsByKey, recentMessagesResult] =
            await Promise.all([
                loadHistoryMetrics(sendIds),
                loadRecipientDetails(sendIds),
                supabase
                    .from("messages")
                    .select("client_id, sent_at")
                    .eq("sender_type", "client")
                    .gte(
                        "sent_at",
                        new Date(
                            Date.now() - WHATSAPP_WINDOW_MS,
                        ).toISOString(),
                    )
                    .order("sent_at", { ascending: false })
                    .limit(MAX_RECENT_CLIENT_MESSAGES),
            ]);

        if (recentMessagesResult.error) throw recentMessagesResult.error;

        const lastClientMessageByClientId = new Map<string, string | null>();

        for (const thread of (threadsResult.data ?? []) as ThreadApiRow[]) {
            if (!thread.client_id) continue;

            const next = thread.last_client_message_at ?? null;
            const current = lastClientMessageByClientId.get(thread.client_id);

            if (!current || (next && new Date(next) > new Date(current))) {
                lastClientMessageByClientId.set(thread.client_id, next);
            }
        }

        // Some legacy/imported messages predate the thread timestamp
        // maintenance. This bounded 24-hour fallback keeps the send window and
        // ordering exact without scanning historical messages.
        for (const message of (recentMessagesResult.data ?? []) as MessageApiRow[]) {
            if (!message.client_id || !message.sent_at) continue;

            const current = lastClientMessageByClientId.get(message.client_id);
            if (
                !current ||
                new Date(message.sent_at).getTime() > new Date(current).getTime()
            ) {
                lastClientMessageByClientId.set(
                    message.client_id,
                    message.sent_at,
                );
            }
        }

        const funnelNameById = new Map(
            (funnelsResult.data ?? []).map((funnel) => [
                funnel.id,
                funnel.name ?? null,
            ]),
        );
        const stages: ActiveMessageFunnelStage[] = (
            stagesResult.data ?? []
        ).map((stage) => ({
            ...stage,
            funnel_name: funnelNameById.get(stage.funnel_id) ?? null,
        }));
        const windowReferenceTime = Date.now();
        const clients: ActiveMessageClient[] = clientRows.map((client) => ({
            id: client.id,
            name: client.name ?? null,
            phone: client.phone ?? null,
            email: client.email ?? null,
            funnel_stage_id: client.funnel_stage_id ?? null,
            last_interaction_at: client.last_interaction_at,
            last_origin: cleanText(client.last_origin),
            last_tunnel: cleanText(client.last_tunnel),
            last_closing_tag: cleanText(client.last_closing_tag),
            last_client_message_at:
                lastClientMessageByClientId.get(client.id) ?? null,
            whatsapp_window_open: isWhatsAppWindowOpenAt(
                lastClientMessageByClientId.get(client.id) ?? null,
                windowReferenceTime,
            ),
            last_active_message_sent_at:
                client.last_active_message_sent_at ?? null,
        }));

        clients.sort((first, second) =>
            compareNullableTimestamps(
                first.last_client_message_at,
                second.last_client_message_at,
            ) ||
            compareNullableTimestamps(
                first.last_interaction_at,
                second.last_interaction_at,
            ) ||
            first.id.localeCompare(second.id),
        );

        const history: ActiveMessageSendHistory[] = historyRows.map((item) => {
            const metrics = metricsBySendId.get(item.id);

            return {
                id: item.id,
                template_id: item.template_id,
                template_name: item.template_name,
                requested_count: item.requested_count,
                sent_count: item.sent_count,
                failed_count: item.failed_count,
                normal_message_count: item.normal_message_count,
                template_message_count: item.template_message_count,
                status: item.status,
                created_by_name: item.created_by_name,
                created_at: item.created_at,
                completed_at: item.completed_at,
                schedule_count: metrics?.schedule_count ?? 0,
                response_count: metrics?.response_count ?? 0,
                recipients: buildHistoryRecipients({
                    sendId: item.id,
                    results: item.results,
                    clientIds: item.client_ids,
                    clientById,
                    recipientDetailsByKey,
                }),
            } as ActiveMessageSendHistory;
        });

        const response: ActiveMessagesPageResponse = {
            templates: ACTIVE_MESSAGE_TEMPLATES,
            template_senders: getActiveMessageTemplateSenderOptions(),
            clients,
            stages,
            history,
        };

        return response;
}

async function loadHistoryMetrics(sendIds: string[]) {
    const metricsBySendId = new Map<
        string,
        { schedule_count: number; response_count: number }
    >();

    if (sendIds.length === 0) return metricsBySendId;

    const { data, error } = await supabase.rpc(
        "get_active_message_send_metrics",
        { p_send_ids: sendIds },
    );

    if (error) {
        throw new Error(
            `Não foi possível carregar as métricas dos envios: ${error.message}`,
        );
    }

    for (const row of (data ?? []) as HistoryMetricsRow[]) {
        metricsBySendId.set(row.send_id, {
            schedule_count: toCount(row.schedule_count),
            response_count: toCount(row.response_count),
        });
    }

    return metricsBySendId;
}

async function loadRecipientDetails(sendIds: string[]) {
    const detailsByKey = new Map<string, RecipientDetailRow>();

    if (sendIds.length === 0) return detailsByKey;

    const { data, error } = await supabase.rpc(
        "get_active_message_send_recipient_details",
        { p_send_ids: sendIds },
    );

    if (error) {
        throw new Error(
            `Não foi possível carregar as respostas por cliente: ${error.message}`,
        );
    }

    for (const row of (data ?? []) as RecipientDetailRow[]) {
        detailsByKey.set(recipientKey(row.send_id, row.client_id), row);
    }

    return detailsByKey;
}

function buildHistoryRecipients({
    sendId,
    results,
    clientIds,
    clientById,
    recipientDetailsByKey,
}: {
    sendId: string;
    results: unknown;
    clientIds: unknown;
    clientById: Map<string, ClientApiRow>;
    recipientDetailsByKey: Map<string, RecipientDetailRow>;
}): ActiveMessageHistoryRecipient[] {
    const storedResults = parseStoredRecipientResults(results);
    const orderedResults =
        storedResults.length > 0
            ? storedResults
            : parseClientIds(clientIds).map((clientId) => ({
                  client_id: clientId,
                  client_name: clientById.get(clientId)?.name ?? null,
                  phone: clientById.get(clientId)?.phone ?? null,
                  status: "sent" as const,
              }));
    const seen = new Set<string>();
    const recipients: ActiveMessageHistoryRecipient[] = [];

    for (const result of orderedResults) {
        if (seen.has(result.client_id)) continue;
        seen.add(result.client_id);

        const client = clientById.get(result.client_id);
        const detail = recipientDetailsByKey.get(
            recipientKey(sendId, result.client_id),
        );

        recipients.push({
            client_id: result.client_id,
            client_name:
                cleanText(result.client_name) ??
                cleanText(client?.name) ??
                "Cliente sem nome",
            phone: cleanText(result.phone) ?? cleanText(client?.phone),
            status: result.status,
            responded: result.status === "sent" && detail?.responded === true,
            response_target_type:
                detail?.responded === true
                    ? detail.response_target_type
                    : null,
            response_target_id:
                detail?.responded === true ? detail.response_target_id : null,
        });
    }

    return recipients;
}

function parseStoredRecipientResults(value: unknown): StoredRecipientResult[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];

        const row = item as Record<string, unknown>;
        const clientId = cleanText(row.client_id);
        const status = row.status === "sent" || row.status === "failed"
            ? row.status
            : null;

        if (!clientId || !status) return [];

        return [
            {
                client_id: clientId,
                client_name: cleanText(row.client_name),
                phone: cleanText(row.phone),
                status,
            },
        ];
    });
}

function parseClientIds(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value
        .map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item));
}

function recipientKey(sendId: string, clientId: string) {
    return `${sendId}:${clientId}`;
}

function cleanText(value: unknown) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized || null;
}

function toCount(value: number | string | null) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isWhatsAppWindowOpenAt(
    lastClientMessageAt: string | null,
    referenceTime: number,
) {
    if (!lastClientMessageAt) return false;

    const timestamp = new Date(lastClientMessageAt).getTime();
    if (!Number.isFinite(timestamp)) return false;

    const age = Math.max(0, referenceTime - timestamp);
    return age <= WHATSAPP_WINDOW_MS;
}

function compareNullableTimestamps(
    first: string | null,
    second: string | null,
) {
    if (!first && !second) return 0;
    if (!first) return 1;
    if (!second) return -1;

    return new Date(second).getTime() - new Date(first).getTime();
}
