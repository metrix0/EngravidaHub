// lib/active-messages/sendActiveMessageBatch.ts
import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";
import {
    getActiveMessageTemplateParameters,
    renderActiveMessageText,
} from "@/lib/active-messages/templates";
import { sendBlipActiveTemplateMessage } from "@/lib/blip/sendBlipActiveTemplateMessage";
import { sendBlipTextMessage } from "@/lib/blip/sendBlipTextMessage";
import { supabase } from "@/lib/supabase/client";
import type {
    ActiveMessageRecipientResult,
    ActiveMessageSendResponse,
} from "@/types/activeMessages";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_CLIENT_MESSAGES = 50_000;
const SEND_CONCURRENCY = 5;

export const MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND = 500;

type ActiveMessageActor = {
    id: string | null;
    name: string;
};

type ClientRow = {
    id: string;
    name: string | null;
    phone: string | null;
};

type ThreadRow = {
    id: string;
    client_id: string;
    last_client_message_at: string | null;
};

type RecentClientMessageRow = {
    client_id: string | null;
    sent_at: string | null;
};

export class ActiveMessageBatchError extends Error {
    readonly batchId: string | null;

    constructor(message: string, batchId: string | null = null) {
        super(message);
        this.name = "ActiveMessageBatchError";
        this.batchId = batchId;
    }
}

export async function sendActiveMessageBatch({
    template,
    clientIds,
    filters = {},
    dynamicValues = {},
    actor,
}: {
    template: ActiveMessageTemplate;
    clientIds: string[];
    filters?: Record<string, unknown>;
    dynamicValues?: Record<string, string>;
    actor: ActiveMessageActor;
}): Promise<ActiveMessageSendResponse> {
    const normalizedClientIds = normalizeClientIds(clientIds);

    if (normalizedClientIds.length === 0) {
        throw new ActiveMessageBatchError(
            "Selecione pelo menos um cliente",
        );
    }

    if (normalizedClientIds.length > MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND) {
        throw new ActiveMessageBatchError(
            `Cada envio aceita até ${MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND} clientes. Divida a seleção em mais de um envio.`,
        );
    }

    const startedAt = new Date().toISOString();
    const { data: batch, error: batchError } = await supabase
        .from("active_message_sends")
        .insert({
            template_id: template.id,
            template_name: template.name,
            requested_count: normalizedClientIds.length,
            status: "processing",
            filters,
            client_ids: normalizedClientIds,
            created_by: actor.id,
            created_by_name: actor.name,
            created_at: startedAt,
        })
        .select("id")
        .single();

    if (batchError || !batch) {
        console.error(
            "[mensagem-ativa] failed to create batch",
            batchError,
        );
        throw new ActiveMessageBatchError(
            batchError?.message ??
                "Não foi possível criar o histórico do envio",
        );
    }

    try {
        const [clientsResult, threadsResult, recentMessagesResult] =
            await Promise.all([
                supabase
                    .from("clients")
                    .select("id, name, phone")
                    .in("id", normalizedClientIds),
                supabase
                    .from("thread")
                    .select("id, client_id, last_client_message_at")
                    .in("client_id", normalizedClientIds),
                supabase
                    .from("messages")
                    .select("client_id, sent_at")
                    .in("client_id", normalizedClientIds)
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

        if (clientsResult.error) throw clientsResult.error;
        if (threadsResult.error) throw threadsResult.error;
        if (recentMessagesResult.error) throw recentMessagesResult.error;

        const clients = (clientsResult.data ?? []) as ClientRow[];
        const threads = (threadsResult.data ?? []) as ThreadRow[];
        const threadByClientId = new Map(
            threads.map((thread) => [thread.client_id, thread]),
        );
        const lastClientMessageByClientId = new Map<
            string,
            string | null
        >();

        for (const thread of threads) {
            if (!thread.last_client_message_at) continue;
            lastClientMessageByClientId.set(
                thread.client_id,
                thread.last_client_message_at,
            );
        }

        for (const message of (recentMessagesResult.data ?? []) as RecentClientMessageRow[]) {
            if (!message.client_id || !message.sent_at) continue;

            const current = lastClientMessageByClientId.get(
                message.client_id,
            );
            if (
                !current ||
                new Date(message.sent_at).getTime() >
                    new Date(current).getTime()
            ) {
                lastClientMessageByClientId.set(
                    message.client_id,
                    message.sent_at,
                );
            }
        }

        await fillMissingLastClientMessages({
            clientIds: clients
                .map((client) => client.id)
                .filter(
                    (clientId) =>
                        !lastClientMessageByClientId.has(clientId),
                ),
            target: lastClientMessageByClientId,
        });

        const clientById = new Map(
            clients.map((client) => [client.id, client]),
        );
        const orderedClients = normalizedClientIds
            .map((clientId) => clientById.get(clientId) ?? null)
            .filter((client): client is ClientRow => Boolean(client));
        const missingClientResults: ActiveMessageRecipientResult[] =
            normalizedClientIds
                .filter((clientId) => !clientById.has(clientId))
                .map((clientId) => ({
                    client_id: clientId,
                    client_name: "Cliente não encontrado",
                    phone: null,
                    mode: "template",
                    status: "failed",
                    external_id: null,
                    error: "Cliente não encontrado",
                    last_client_message_at: null,
                }));

        const processedResults = await mapWithConcurrency(
            orderedClients,
            SEND_CONCURRENCY,
            async (client): Promise<ActiveMessageRecipientResult> => {
                const lastClientMessageAt =
                    lastClientMessageByClientId.get(client.id) ?? null;
                const windowOpen = isWhatsAppWindowOpen(
                    lastClientMessageAt,
                );
                const mode = windowOpen ? "normal" : "template";
                const renderedText = renderActiveMessageText({
                    template,
                    clientName: client.name,
                    dynamicValues,
                });

                if (!client.phone?.trim()) {
                    return {
                        client_id: client.id,
                        client_name:
                            client.name ?? "Cliente sem nome",
                        phone: client.phone,
                        mode,
                        status: "failed",
                        external_id: null,
                        error: "Cliente sem telefone",
                        last_client_message_at: lastClientMessageAt,
                    };
                }

                try {
                    const outbound = windowOpen
                        ? await sendBlipTextMessage({
                              recipientNumber: client.phone,
                              text: renderedText,
                              requestId: `${batch.id}:${client.id}`,
                          })
                        : await sendBlipActiveTemplateMessage({
                              recipientNumber: client.phone,
                              template,
                              messageParams:
                                  getActiveMessageTemplateParameters({
                                      template,
                                      clientName: client.name,
                                      dynamicValues,
                                  }),
                          });
                    const thread =
                        threadByClientId.get(client.id) ?? null;

                    if (thread) {
                        const persistenceError =
                            await persistOutboundMessage({
                                clientId: client.id,
                                threadId: thread.id,
                                senderName: actor.name,
                                text: renderedText,
                                externalId: outbound.id,
                                externalContactId: outbound.to,
                            });

                        if (persistenceError) {
                            console.error(
                                `[mensagem-ativa:${batch.id}] Blip accepted message but local persistence failed`,
                                {
                                    client_id: client.id,
                                    error: persistenceError,
                                },
                            );
                        }
                    }

                    return {
                        client_id: client.id,
                        client_name:
                            client.name ?? "Cliente sem nome",
                        phone: client.phone,
                        mode,
                        status: "sent",
                        external_id: outbound.id,
                        error: null,
                        last_client_message_at: lastClientMessageAt,
                    };
                } catch (error) {
                    console.error(
                        `[mensagem-ativa:${batch.id}] recipient failed`,
                        { client_id: client.id, error },
                    );

                    return {
                        client_id: client.id,
                        client_name:
                            client.name ?? "Cliente sem nome",
                        phone: client.phone,
                        mode,
                        status: "failed",
                        external_id: null,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Falha desconhecida ao enviar",
                        last_client_message_at: lastClientMessageAt,
                    };
                }
            },
        );

        const results = [...processedResults, ...missingClientResults];
        const successfulResults = results.filter(
            (result) => result.status === "sent",
        );
        const failedResults = results.filter(
            (result) => result.status === "failed",
        );
        const successfulClientIds = successfulResults.map(
            (result) => result.client_id,
        );
        const normalMessageCount = successfulResults.filter(
            (result) => result.mode === "normal",
        ).length;
        const templateMessageCount = successfulResults.filter(
            (result) => result.mode === "template",
        ).length;
        const completedAt = new Date().toISOString();
        const status = getBatchStatus({
            sentCount: successfulResults.length,
            failedCount: failedResults.length,
        });

        if (successfulClientIds.length > 0) {
            const { error: clientsUpdateError } = await supabase
                .from("clients")
                .update({
                    last_active_message_sent_at: completedAt,
                })
                .in("id", successfulClientIds);

            if (clientsUpdateError) {
                console.error(
                    `[mensagem-ativa:${batch.id}] failed to update client timestamps`,
                    clientsUpdateError,
                );
            }
        }

        const { error: historyUpdateError } = await supabase
            .from("active_message_sends")
            .update({
                sent_count: successfulResults.length,
                failed_count: failedResults.length,
                normal_message_count: normalMessageCount,
                template_message_count: templateMessageCount,
                status,
                results,
                completed_at: completedAt,
            })
            .eq("id", batch.id);

        if (historyUpdateError) throw historyUpdateError;

        return {
            ok: failedResults.length === 0,
            batch_id: batch.id,
            status,
            requested_count: normalizedClientIds.length,
            sent_count: successfulResults.length,
            failed_count: failedResults.length,
            normal_message_count: normalMessageCount,
            template_message_count: templateMessageCount,
            results,
        };
    } catch (error) {
        console.error(
            `[mensagem-ativa:${batch.id}] batch failed`,
            error,
        );

        await supabase
            .from("active_message_sends")
            .update({
                status: "failed",
                failed_count: normalizedClientIds.length,
                results: [
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Falha inesperada no envio",
                    },
                ],
                completed_at: new Date().toISOString(),
            })
            .eq("id", batch.id);

        throw new ActiveMessageBatchError(
            error instanceof Error
                ? error.message
                : "Não foi possível concluir o envio",
            batch.id,
        );
    }
}

function normalizeClientIds(value: string[]) {
    return [
        ...new Set(
            value.map((item) => item.trim()).filter(Boolean),
        ),
    ];
}

function isWhatsAppWindowOpen(lastClientMessageAt: string | null) {
    if (!lastClientMessageAt) return false;

    const timestamp = new Date(lastClientMessageAt).getTime();
    if (!Number.isFinite(timestamp)) return false;

    return Math.max(0, Date.now() - timestamp) <= WHATSAPP_WINDOW_MS;
}

async function fillMissingLastClientMessages({
    clientIds,
    target,
}: {
    clientIds: string[];
    target: Map<string, string | null>;
}) {
    if (clientIds.length === 0) return;

    const { data, error } = await supabase
        .from("messages")
        .select("client_id, sent_at")
        .in("client_id", clientIds)
        .eq("sender_type", "client")
        .order("sent_at", { ascending: false });

    if (error) throw error;

    for (const message of data ?? []) {
        if (!message.client_id || target.has(message.client_id)) continue;
        target.set(message.client_id, message.sent_at ?? null);
    }
}

async function persistOutboundMessage({
    clientId,
    threadId,
    senderName,
    text,
    externalId,
    externalContactId,
}: {
    clientId: string;
    threadId: string;
    senderName: string;
    text: string;
    externalId: string;
    externalContactId: string;
}) {
    const { data: lastMessage, error: lastMessageError } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", threadId)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lastMessageError) return lastMessageError.message;

    const sequenceIndex =
        typeof lastMessage?.sequence_index === "number"
            ? lastMessage.sequence_index + 1
            : 0;
    const sentAt = new Date().toISOString();
    const { error } = await supabase.from("messages").upsert(
        {
            client_id: clientId,
            conversation_id: null,
            thread_id: threadId,
            sender_type: "attendant",
            sender_name: senderName,
            text,
            sent_at: sentAt,
            sequence_index: sequenceIndex,
            external_id: externalId,
            external_contact_id: externalContactId,
        },
        {
            onConflict: "external_id",
            ignoreDuplicates: false,
        },
    );

    if (error) return error.message;

    const { error: threadError } = await supabase
        .from("thread")
        .update({
            last_message_text: text,
            last_message_at: sentAt,
            updated_at: sentAt,
        })
        .eq("id", threadId);

    return threadError?.message ?? null;
}

async function mapWithConcurrency<TInput, TOutput>(
    items: TInput[],
    concurrency: number,
    mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
    const results = new Array<TOutput>(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;

            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, items.length) },
            () => worker(),
        ),
    );

    return results;
}

function getBatchStatus({
    sentCount,
    failedCount,
}: {
    sentCount: number;
    failedCount: number;
}): "completed" | "partial" | "failed" {
    if (sentCount === 0) return "failed";
    if (failedCount > 0) return "partial";
    return "completed";
}
