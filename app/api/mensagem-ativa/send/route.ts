// app/api/mensagem-ativa/send/route.ts

import { NextResponse } from "next/server";

import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import {
    getActiveMessageDynamicFields,
    getActiveMessageTemplate,
    getActiveMessageTemplateParameters,
    renderActiveMessageText,
} from "@/lib/active-messages/templates";
import { sendBlipTemplateMessage } from "@/lib/blip/sendBlipTemplateMessage";
import { sendBlipTextMessage } from "@/lib/blip/sendBlipTextMessage";
import { supabase } from "@/lib/supabase/client";
import type {
    ActiveMessageRecipientResult,
    ActiveMessageSendResponse,
} from "@/types/activeMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_CLIENTS_PER_SEND = 500;
const SEND_CONCURRENCY = 5;

type SendBody = {
    template_id?: unknown;
    client_ids?: unknown;
    filters?: unknown;
    dynamic_values?: unknown;
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

export async function POST(request: Request) {
    const access = await requireActiveMessageAccess();

    if (!access.ok) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    let body: SendBody;

    try {
        body = (await request.json()) as SendBody;
    } catch {
        return NextResponse.json(
            { error: "O corpo da requisição não é um JSON válido" },
            { status: 400 },
        );
    }

    const templateId =
        typeof body.template_id === "string" ? body.template_id.trim() : "";
    const clientIds = normalizeClientIds(body.client_ids);
    const template = getActiveMessageTemplate(templateId);

    if (!template) {
        return NextResponse.json(
            { error: "Selecione um template válido" },
            { status: 400 },
        );
    }

    const dynamicValuesResult = resolveDynamicValues({
        template,
        value: body.dynamic_values,
    });

    if (!dynamicValuesResult.ok) {
        return NextResponse.json(
            { error: dynamicValuesResult.error },
            { status: 400 },
        );
    }

    const dynamicValues = dynamicValuesResult.values;

    if (clientIds.length === 0) {
        return NextResponse.json(
            { error: "Selecione pelo menos um cliente" },
            { status: 400 },
        );
    }

    if (clientIds.length > MAX_CLIENTS_PER_SEND) {
        return NextResponse.json(
            {
                error: `Cada envio aceita até ${MAX_CLIENTS_PER_SEND} clientes. Divida a seleção em mais de um envio.`,
            },
            { status: 400 },
        );
    }

    const filters = isRecord(body.filters) ? body.filters : {};
    const startedAt = new Date().toISOString();

    const { data: batch, error: batchError } = await supabase
        .from("active_message_sends")
        .insert({
            template_id: template.id,
            template_name: template.name,
            requested_count: clientIds.length,
            status: "processing",
            filters,
            client_ids: clientIds,
            created_by: access.actor.id,
            created_by_name: access.actor.name,
            created_at: startedAt,
        })
        .select("id")
        .single();

    if (batchError || !batch) {
        console.error("[mensagem-ativa] failed to create batch", batchError);
        return NextResponse.json(
            {
                error:
                    batchError?.message ??
                    "Não foi possível criar o histórico do envio",
            },
            { status: 500 },
        );
    }

    try {
        const [clientsResult, threadsResult] = await Promise.all([
            supabase
                .from("clients")
                .select("id, name, phone")
                .in("id", clientIds),
            supabase
                .from("thread")
                .select("id, client_id, last_client_message_at")
                .in("client_id", clientIds),
        ]);

        if (clientsResult.error) throw clientsResult.error;
        if (threadsResult.error) throw threadsResult.error;

        const clients = (clientsResult.data ?? []) as ClientRow[];
        const threads = (threadsResult.data ?? []) as ThreadRow[];
        const threadByClientId = new Map(
            threads.map((thread) => [thread.client_id, thread]),
        );
        const lastClientMessageByClientId = new Map<string, string | null>();

        for (const thread of threads) {
            if (thread.last_client_message_at) {
                lastClientMessageByClientId.set(
                    thread.client_id,
                    thread.last_client_message_at,
                );
            }
        }

        await fillMissingLastClientMessages({
            clientIds: clients
                .map((client) => client.id)
                .filter((clientId) => !lastClientMessageByClientId.has(clientId)),
            target: lastClientMessageByClientId,
        });

        const clientById = new Map(clients.map((client) => [client.id, client]));
        const orderedClients = clientIds
            .map((clientId) => clientById.get(clientId) ?? null)
            .filter((client): client is ClientRow => Boolean(client));

        const missingClientResults: ActiveMessageRecipientResult[] = clientIds
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
                const windowOpen = isWhatsAppWindowOpen(lastClientMessageAt);
                const mode = windowOpen ? "normal" : "template";
                const renderedText = renderActiveMessageText({
                    template,
                    clientName: client.name,
                    dynamicValues,
                });

                if (!client.phone?.trim()) {
                    return {
                        client_id: client.id,
                        client_name: client.name ?? "Cliente sem nome",
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
                        : await sendBlipTemplateMessage({
                              recipientNumber: client.phone,
                              template,
                              messageParams: getActiveMessageTemplateParameters({
                                  template,
                                  clientName: client.name,
                                  dynamicValues,
                              }),
                          });

                    const thread = threadByClientId.get(client.id) ?? null;

                    if (thread) {
                        const persistenceError = await persistOutboundMessage({
                            clientId: client.id,
                            threadId: thread.id,
                            senderName: access.actor.name,
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
                        client_name: client.name ?? "Cliente sem nome",
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
                        {
                            client_id: client.id,
                            error,
                        },
                    );

                    return {
                        client_id: client.id,
                        client_name: client.name ?? "Cliente sem nome",
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
                .update({ last_active_message_sent_at: completedAt })
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

        if (historyUpdateError) {
            throw historyUpdateError;
        }

        const response: ActiveMessageSendResponse = {
            ok: failedResults.length === 0,
            batch_id: batch.id,
            status,
            requested_count: clientIds.length,
            sent_count: successfulResults.length,
            failed_count: failedResults.length,
            normal_message_count: normalMessageCount,
            template_message_count: templateMessageCount,
            results,
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error(`[mensagem-ativa:${batch.id}] batch failed`, error);

        await supabase
            .from("active_message_sends")
            .update({
                status: "failed",
                failed_count: clientIds.length,
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

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível concluir o envio",
                batch_id: batch.id,
            },
            { status: 500 },
        );
    }
}

function resolveDynamicValues({
    template,
    value,
}: {
    template: NonNullable<ReturnType<typeof getActiveMessageTemplate>>;
    value: unknown;
}):
    | { ok: true; values: Record<string, string> }
    | { ok: false; error: string } {
    const input = isRecord(value) ? value : {};
    const values: Record<string, string> = {};

    for (const field of getActiveMessageDynamicFields(template)) {
        const rawValue = input[field.field_id];
        const resolvedValue =
            (typeof rawValue === "string" ? rawValue.trim() : "") ||
            field.default_value?.trim() ||
            "";

        if (field.required && !resolvedValue) {
            return {
                ok: false,
                error: `Preencha o campo “${field.label}”.`,
            };
        }

        if (resolvedValue.length > 500) {
            return {
                ok: false,
                error: `O campo “${field.label}” deve ter no máximo 500 caracteres.`,
            };
        }

        values[field.field_id] = resolvedValue;
    }

    return { ok: true, values };
}

function normalizeClientIds(value: unknown) {
    if (!Array.isArray(value)) return [];

    return [
        ...new Set(
            value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWhatsAppWindowOpen(lastClientMessageAt: string | null) {
    if (!lastClientMessageAt) return false;

    const timestamp = new Date(lastClientMessageAt).getTime();
    if (!Number.isFinite(timestamp)) return false;

    const age = Date.now() - timestamp;
    return age >= 0 && age <= WHATSAPP_WINDOW_MS;
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

    await supabase
        .from("thread")
        .update({
            last_message_text: text,
            last_message_at: sentAt,
            updated_at: sentAt,
        })
        .eq("id", threadId);

    return null;
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
