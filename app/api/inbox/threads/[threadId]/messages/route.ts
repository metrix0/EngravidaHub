// app/api/inbox/threads/[threadId]/messages/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import {
    BlipApiError,
    BlipConfigurationError,
    sendBlipTextMessage,
    type BlipHttpDebug,
    type SentBlipTextMessage,
} from "@/lib/blip/sendBlipTextMessage";
import { supabase } from "@/lib/supabase/client";
import type { InboxItemType } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const TEST_MODE = false;
const BYPASS_LOCAL_WINDOW_IN_TEST_MODE = false;

type DebugStep = {
    at: string;
    step: string;
    data?: unknown;
};

type SendDebug = {
    request_id: string;
    test_mode: boolean;
    app_endpoint: string;
    item_id: string;
    item_type: InboxItemType;
    recipient_input: string;
    recipient_identity: string | null;
    local_window: {
        last_client_message_at: string | null;
        age_ms: number | null;
        open: boolean;
        bypassed: boolean;
    } | null;
    blip: BlipHttpDebug | null;
    steps: DebugStep[];
};

export async function POST(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> },
) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const { threadId: itemId } = await params;
    const appEndpoint = new URL(request.url).pathname;

    let rawBody: unknown;

    try {
        rawBody = await request.json();
    } catch (error) {
        console.error(`[inbox-send:${requestId}] Invalid JSON request body`, error);

        return NextResponse.json(
            {
                ok: false,
                error: "O corpo da requisição não é um JSON válido.",
                debug: {
                    request_id: requestId,
                    app_endpoint: appEndpoint,
                },
            },
            { status: 400 },
        );
    }

    const body = (rawBody ?? {}) as Record<string, unknown>;
    const text = String(body.text ?? "").trim();
    const itemType = normalizeItemType(body.item_type);

    const debug: SendDebug = {
        request_id: requestId,
        test_mode: TEST_MODE,
        app_endpoint: appEndpoint,
        item_id: itemId,
        item_type: itemType,
        recipient_input: "",
        recipient_identity: null,
        local_window: null,
        blip: null,
        steps: [],
    };

    const log = (step: string, data?: unknown) => {
        const entry: DebugStep = {
            at: new Date().toISOString(),
            step,
            ...(data === undefined ? {} : { data }),
        };

        debug.steps.push(entry);
        console.info(`[inbox-send:${requestId}] ${step}`, data ?? "");
    };

    log("Request received", {
        method: request.method,
        app_endpoint: appEndpoint,
        item_id: itemId,
        item_type: itemType,
        text_length: text.length,
        text,
    });

    if (!text) {
        log("Rejected: empty message text");
        return errorResponse(400, "Message text is required", debug, startedAt);
    }

    log("Resolving current attendant");
    const { attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.active || !attendant.is_online) {
        log("Rejected: attendant is missing, inactive, or offline", {
            attendant_found: Boolean(attendant),
            active: attendant?.active ?? null,
            online: attendant?.is_online ?? null,
        });

        return errorResponse(
            403,
            "O atendente precisa estar ativo e online.",
            debug,
            startedAt,
        );
    }

    log("Attendant authorized", {
        attendant_id: attendant.id,
        attendant_name: attendant.name,
    });

    log("Resolving selected thread/conversation");
    const threadResult = await resolveThread({
        itemId,
        itemType,
        attendantId: attendant.id,
    });

    if (!threadResult.ok) {
        log("Failed to resolve selected thread", {
            status: threadResult.status,
            error: threadResult.error,
        });

        return errorResponse(
            threadResult.status,
            threadResult.error,
            debug,
            startedAt,
        );
    }

    const thread = threadResult.thread;
    log("Thread resolved", {
        thread_id: thread.id,
        client_id: thread.client_id,
        status: thread.status,
        assigned_attendant_id: thread.assigned_attendant_id,
        last_client_message_at: thread.last_client_message_at,
    });

    const { data: customer, error: customerError } = await supabase
        .from("clients")
        .select("phone")
        .eq("id", thread.client_id)
        .maybeSingle();

    if (customerError) {
        log("Failed to resolve customer phone", customerError);
        return errorResponse(500, customerError.message, debug, startedAt);
    }

    const recipientNumber = customer?.phone?.trim() ?? "";
    if (!recipientNumber) {
        log("Rejected: customer has no phone number");
        return errorResponse(422, "O cliente não possui telefone cadastrado.", debug, startedAt);
    }

    debug.recipient_input = recipientNumber;
    log("Customer phone resolved", { raw_number: recipientNumber });

    const lastClientMessageAt = thread.last_client_message_at
        ? new Date(thread.last_client_message_at).getTime()
        : 0;
    const windowAgeMs = lastClientMessageAt ? Date.now() - lastClientMessageAt : null;
    const localWindowOpen =
        lastClientMessageAt > 0 &&
        windowAgeMs !== null &&
        windowAgeMs <= WHATSAPP_WINDOW_MS;
    const bypassed =
        TEST_MODE && BYPASS_LOCAL_WINDOW_IN_TEST_MODE && !localWindowOpen;

    debug.local_window = {
        last_client_message_at: thread.last_client_message_at ?? null,
        age_ms: windowAgeMs,
        open: localWindowOpen,
        bypassed,
    };

    log("Local 24-hour window check", debug.local_window);

    if (!localWindowOpen && !bypassed) {
        return errorResponse(
            409,
            "The 24-hour response window has expired",
            debug,
            startedAt,
        );
    }

    let reopened = false;

    if (thread.status === "closed") {
        log("Selected thread is closed; attempting temporary reopen");

        const { data: reopenedThread, error: reopenError } = await supabase
            .from("thread")
            .update({
                status: "open",
                assigned_attendant_id: attendant.id,
            })
            .eq("id", thread.id)
            .eq("status", "closed")
            .eq("assigned_attendant_id", attendant.id)
            .select("id")
            .maybeSingle();

        if (reopenError) {
            log("Failed to reopen thread", reopenError);
            return errorResponse(500, reopenError.message, debug, startedAt);
        }

        if (!reopenedThread) {
            log("Thread could not be reopened because it changed or is unavailable");
            return errorResponse(
                409,
                "Conversation is no longer available for this attendant",
                debug,
                startedAt,
            );
        }

        reopened = true;
        log("Thread reopened", { thread_id: thread.id });
    }

    let blipMessage: SentBlipTextMessage;

    try {
        log("Calling Blip HTTP Messages API");
        blipMessage = await sendBlipTextMessage({
            recipientNumber,
            text,
            requestId,
        });
        debug.blip = blipMessage.debug;
        debug.recipient_identity = blipMessage.to;

        log("Blip accepted the envelope", {
            blip_message_id: blipMessage.id,
            sender: blipMessage.from,
            recipient: blipMessage.to,
            http_status: blipMessage.debug.response.status,
            http_body: blipMessage.debug.response.body,
            duration_ms: blipMessage.debug.duration_ms,
            delivery_state: blipMessage.delivery.state,
            delivery_event: blipMessage.delivery.final_event,
            delivery_reason: blipMessage.delivery.reason,
            notification_events: blipMessage.delivery.events,
            notification_attempts: blipMessage.delivery.attempts,
            notification_command_status: blipMessage.delivery.command_status,
            notification_command_reason: blipMessage.delivery.command_reason,
        });
    } catch (error) {
        if (error instanceof BlipApiError || error instanceof BlipConfigurationError) {
            debug.blip = error.debug;
            debug.recipient_identity = error.debug?.body.to ?? null;
        }

        if (reopened) {
            log("Blip send failed; rolling the temporary reopen back");
            await rollbackReopenedThread(thread.id, attendant.id, requestId);
        }

        console.error(`[inbox-send:${requestId}] Blip send failed`, error);

        const status = error instanceof BlipConfigurationError ? 500 : 502;
        const message =
            error instanceof BlipApiError ||
            error instanceof BlipConfigurationError
                ? error.message
                : error instanceof Error
                    ? error.message
                    : "Não foi possível enviar a mensagem pela Blip.";

        log("Sending failed", {
            error_name: error instanceof Error ? error.name : typeof error,
            error_message: message,
        });

        return errorResponse(status, message, debug, startedAt);
    }

    log("Persisting the accepted outbound message in local history");
    const persistenceResult = await persistSentMessage({
        thread,
        attendantName: attendant.name,
        text,
        blipMessage,
    });

    if (!persistenceResult.ok) {
        console.error(
            `[inbox-send:${requestId}] Message was accepted by Blip but local persistence failed`,
            persistenceResult.error,
        );

        log("WARNING: Blip accepted the message, but local persistence failed", {
            error: serializeError(persistenceResult.error),
        });

        return NextResponse.json(
            {
                ok: true,
                message: null,
                thread_id: thread.id,
                reopened,
                persisted: false,
                blip_message_id: blipMessage.id,
                recipient: blipMessage.to,
                test_mode: TEST_MODE,
                delivery: blipMessage.delivery,
                warning:
                    "A mensagem foi aceita pela Blip, mas o histórico local ainda não foi atualizado.",
                debug: finishDebug(debug, startedAt),
            },
            { status: 202 },
        );
    }

    log("Local message persisted", {
        local_message_id: persistenceResult.message?.id ?? null,
    });
    log("Send pipeline completed successfully");

    return NextResponse.json({
        ok: true,
        message: persistenceResult.message,
        thread_id: thread.id,
        reopened,
        persisted: true,
        blip_message_id: blipMessage.id,
        recipient: blipMessage.to,
        test_mode: TEST_MODE,
        delivery: blipMessage.delivery,
        debug: finishDebug(debug, startedAt),
    });
}

async function persistSentMessage({
    thread,
    attendantName,
    text,
    blipMessage,
}: {
    thread: {
        id: string;
        client_id: string;
    };
    attendantName: string;
    text: string;
    blipMessage: SentBlipTextMessage;
}) {
    const { data: lastMessage, error: lastMessageError } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", thread.id)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lastMessageError) {
        return {
            ok: false as const,
            error: lastMessageError,
        };
    }

    const sequenceIndex =
        typeof lastMessage?.sequence_index === "number"
            ? lastMessage.sequence_index + 1
            : 0;

    const { data: message, error: messageError } = await supabase
        .from("messages")
        .upsert(
            {
                client_id: thread.client_id,
                conversation_id: null,
                thread_id: thread.id,
                sender_type: "attendant",
                sender_name: attendantName,
                text,
                sent_at: new Date().toISOString(),
                sequence_index: sequenceIndex,
                external_id: blipMessage.id,
                external_contact_id: blipMessage.to,
            },
            {
                onConflict: "external_id",
                ignoreDuplicates: false,
            },
        )
        .select("*")
        .single();

    if (messageError) {
        return {
            ok: false as const,
            error: messageError,
        };
    }

    return {
        ok: true as const,
        message,
    };
}

async function rollbackReopenedThread(
    threadId: string,
    attendantId: string,
    requestId: string,
) {
    const { error } = await supabase
        .from("thread")
        .update({ status: "closed" })
        .eq("id", threadId)
        .eq("status", "open")
        .eq("assigned_attendant_id", attendantId);

    if (error) {
        console.error(
            `[inbox-send:${requestId}] Failed to roll back reopened thread after Blip failure`,
            error,
        );
    }
}

async function resolveThread({
    itemId,
    itemType,
    attendantId,
}: {
    itemId: string;
    itemType: InboxItemType;
    attendantId: string;
}) {
    if (itemType === "thread") {
        const { data: thread, error } = await supabase
            .from("thread")
            .select(`
                id,
                client_id,
                status,
                assigned_attendant_id,
                last_client_message_at
            `)
            .eq("id", itemId)
            .eq("assigned_attendant_id", attendantId)
            .maybeSingle();

        if (error) {
            return {
                ok: false as const,
                status: 500,
                error: error.message,
            };
        }

        if (!thread || thread.status !== "open") {
            return {
                ok: false as const,
                status: 404,
                error: "Thread not found",
            };
        }

        return {
            ok: true as const,
            thread,
        };
    }

    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("id, client_id, thread_id")
        .eq("id", itemId)
        .eq("attendant_id", attendantId)
        .maybeSingle();

    if (conversationError) {
        return {
            ok: false as const,
            status: 500,
            error: conversationError.message,
        };
    }

    if (!conversation) {
        return {
            ok: false as const,
            status: 404,
            error: "Conversation not found",
        };
    }

    let query = supabase
        .from("thread")
        .select(`
            id,
            client_id,
            status,
            assigned_attendant_id,
            last_client_message_at
        `)
        .limit(1);

    query = conversation.thread_id
        ? query.eq("id", conversation.thread_id)
        : query.eq("client_id", conversation.client_id);

    const { data: thread, error: threadError } = await query.maybeSingle();

    if (threadError) {
        return {
            ok: false as const,
            status: 500,
            error: threadError.message,
        };
    }

    if (!thread || thread.assigned_attendant_id !== attendantId) {
        return {
            ok: false as const,
            status: 409,
            error: "Conversation is not assigned to this attendant",
        };
    }

    return {
        ok: true as const,
        thread,
    };
}

function normalizeItemType(value: unknown): InboxItemType {
    return value === "conversation" ? "conversation" : "thread";
}

function errorResponse(
    status: number,
    error: string,
    debug: SendDebug,
    startedAt: number,
) {
    return NextResponse.json(
        {
            ok: false,
            error,
            debug: finishDebug(debug, startedAt),
        },
        { status },
    );
}

function finishDebug(debug: SendDebug, startedAt: number) {
    return {
        ...debug,
        finished_at: new Date().toISOString(),
        total_duration_ms: Date.now() - startedAt,
    };
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack ?? null,
        };
    }

    return error;
}
