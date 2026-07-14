// app/api/mensagem-ativa/route.ts

import { NextResponse } from "next/server";

import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import { ACTIVE_MESSAGE_TEMPLATES } from "@/lib/active-messages/templates";
import { supabase } from "@/lib/supabase/client";
import type {
    ActiveMessageClient,
    ActiveMessageFunnelStage,
    ActiveMessageSendHistory,
    ActiveMessagesPageResponse,
} from "@/types/activeMessages";

export const dynamic = "force-dynamic";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;


type ClientApiRow = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    last_interaction_at: string;
    utm_source: string | null;
    last_closing_tag: string | null;
    last_active_message_sent_at: string | null;
};

type ThreadApiRow = {
    client_id: string | null;
    latest_conversation_id: string | null;
    last_client_message_at: string | null;
    last_message_at: string | null;
    updated_at: string | null;
};

type ConversationTunnelRow = {
    id: string;
    tunnel: string | null;
};

type HistoryMetricsRow = {
    send_id: string;
    schedule_count: number | string | null;
    response_count: number | string | null;
};

export async function GET() {
    const access = await requireActiveMessageAccess();

    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    try {
        const [
            clientsResult,
            stagesResult,
            funnelsResult,
            threadsResult,
            historyResult,
        ] = await Promise.all([
            supabase
                .from("clients")
                .select(`
                    id,
                    name,
                    phone,
                    email,
                    funnel_stage_id,
                    last_interaction_at,
                    utm_source,
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
                .select(`
                    client_id,
                    latest_conversation_id,
                    last_client_message_at,
                    last_message_at,
                    updated_at
                `),
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
                    completed_at
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

        if (firstError) {
            throw firstError;
        }

        const historyRows = historyResult.data ?? [];
        const metricsBySendId = await loadHistoryMetrics(
            historyRows.map((item) => item.id),
        );

        const lastClientMessageByClientId = new Map<string, string | null>();
        const latestConversationIdByClientId = new Map<string, string>();
        const latestThreadActivityByClientId = new Map<string, number>();

        for (const thread of (threadsResult.data ?? []) as ThreadApiRow[]) {
            if (!thread.client_id) continue;

            const currentClientMessage = lastClientMessageByClientId.get(
                thread.client_id,
            );
            const nextClientMessage = thread.last_client_message_at ?? null;

            if (
                !currentClientMessage ||
                (nextClientMessage &&
                    new Date(nextClientMessage) > new Date(currentClientMessage))
            ) {
                lastClientMessageByClientId.set(
                    thread.client_id,
                    nextClientMessage,
                );
            }

            if (!thread.latest_conversation_id) continue;

            const activityAt =
                thread.last_message_at ??
                thread.updated_at ??
                thread.last_client_message_at;
            const parsedActivityTimestamp = activityAt
                ? new Date(activityAt).getTime()
                : 0;
            const activityTimestamp = Number.isFinite(parsedActivityTimestamp)
                ? parsedActivityTimestamp
                : 0;
            const currentActivityTimestamp =
                latestThreadActivityByClientId.get(thread.client_id) ??
                Number.NEGATIVE_INFINITY;

            if (activityTimestamp >= currentActivityTimestamp) {
                latestThreadActivityByClientId.set(
                    thread.client_id,
                    activityTimestamp,
                );
                latestConversationIdByClientId.set(
                    thread.client_id,
                    thread.latest_conversation_id,
                );
            }
        }

        const tunnelByConversationId = await loadTunnelByConversationId(
            [...new Set(latestConversationIdByClientId.values())],
        );

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

        const clients: ActiveMessageClient[] = (clientsResult.data ?? []).map(
            (client: ClientApiRow) => {
                const latestConversationId =
                    latestConversationIdByClientId.get(client.id) ?? null;

                return {
                    id: client.id,
                    name: client.name ?? null,
                    phone: client.phone ?? null,
                    email: client.email ?? null,
                    funnel_stage_id: client.funnel_stage_id ?? null,
                    last_interaction_at: client.last_interaction_at,
                    utm_source: client.utm_source ?? null,
                    last_closing_tag: client.last_closing_tag ?? null,
                    tunnel: latestConversationId
                        ? tunnelByConversationId.get(latestConversationId) ?? null
                        : null,
                    last_client_message_at:
                        lastClientMessageByClientId.get(client.id) ?? null,
                    whatsapp_window_open: isWhatsAppWindowOpenAt(
                        lastClientMessageByClientId.get(client.id) ?? null,
                        windowReferenceTime,
                    ),
                    last_active_message_sent_at:
                        client.last_active_message_sent_at ?? null,
                };
            },
        );

        const history: ActiveMessageSendHistory[] = historyRows.map((item) => {
            const metrics = metricsBySendId.get(item.id);

            return {
                ...item,
                schedule_count: metrics?.schedule_count ?? 0,
                response_count: metrics?.response_count ?? 0,
            } as ActiveMessageSendHistory;
        });

        const response: ActiveMessagesPageResponse = {
            templates: ACTIVE_MESSAGE_TEMPLATES,
            clients,
            stages,
            history,
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error("[mensagem-ativa] GET failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar a Mensagem Ativa",
            },
            { status: 500 },
        );
    }
}

async function loadTunnelByConversationId(conversationIds: string[]) {
    const tunnelByConversationId = new Map<string, string | null>();

    for (const batch of chunk(conversationIds, 100)) {
        const { data, error } = await supabase
            .from("conversations")
            .select("id, tunnel")
            .in("id", batch);

        if (error) {
            throw new Error(
                `Não foi possível carregar os túneis dos clientes: ${error.message}`,
            );
        }

        for (const conversation of (data ?? []) as ConversationTunnelRow[]) {
            tunnelByConversationId.set(
                conversation.id,
                conversation.tunnel?.trim() || null,
            );
        }
    }

    return tunnelByConversationId;
}

async function loadHistoryMetrics(sendIds: string[]) {
    const metricsBySendId = new Map<
        string,
        {
            schedule_count: number;
            response_count: number;
        }
    >();

    if (sendIds.length === 0) {
        return metricsBySendId;
    }

    const { data, error } = await supabase.rpc(
        "get_active_message_send_metrics",
        {
            p_send_ids: sendIds,
        },
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

function toCount(value: number | string | null) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

function isWhatsAppWindowOpenAt(
    lastClientMessageAt: string | null,
    referenceTime: number,
) {
    if (!lastClientMessageAt) return false;

    const timestamp = new Date(lastClientMessageAt).getTime();
    if (!Number.isFinite(timestamp)) return false;

    const age = referenceTime - timestamp;
    return age >= 0 && age <= WHATSAPP_WINDOW_MS;
}
