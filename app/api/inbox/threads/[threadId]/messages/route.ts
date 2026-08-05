// app/api/inbox/threads/[threadId]/messages/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import {
    BlipApiError,
    BlipConfigurationError,
    sendBlipMediaMessage,
    sendBlipTextMessage,
    type BlipHttpDebug,
    type SentBlipMessage,
} from "@/lib/blip/sendBlipTextMessage";
import { supabase } from "@/lib/supabase/client";
import {
    sendZernioInboxMessage,
    ZernioApiError,
    ZernioConfigurationError,
    zernioExternalMessageId,
} from "@/lib/zernio/client";
import type { InboxItemType } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ATTACHMENT_BUCKET = "inbox-attachments";
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const ATTACHMENT_URL_TTL_SECONDS = 24 * 60 * 60;
const TEST_MODE = false;
const BYPASS_LOCAL_WINDOW_IN_TEST_MODE = false;

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/3gpp",
    "audio/aac",
    "audio/amr",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
]);

type SendAction = "send_text" | "prepare_attachment" | "send_attachment";

type AttachmentInput = {
    path: string;
    name: string;
    mimeType: string;
    size: number;
};

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
    transport: "blip" | "zernio" | null;
    local_window: {
        last_client_message_at: string | null;
        age_ms: number | null;
        open: boolean;
        bypassed: boolean;
    } | null;
    blip: BlipHttpDebug | null;
    steps: DebugStep[];
};

let attachmentBucketReady: Promise<void> | null = null;

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
    const action = normalizeAction(body.action);
    const text = String(body.text ?? "").trim();
    const itemType = normalizeItemType(body.item_type);
    const attachment = parseAttachment(body.attachment);

    const debug: SendDebug = {
        request_id: requestId,
        test_mode: TEST_MODE,
        app_endpoint: appEndpoint,
        item_id: itemId,
        item_type: itemType,
        recipient_input: "",
        recipient_identity: null,
        transport: null,
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
        action,
        text_length: text.length,
        text,
        attachment_name: attachment?.name ?? null,
    });

    if (action === "send_text" && !text) {
        log("Rejected: empty message text");
        return errorResponse(400, "Message text is required", debug, startedAt);
    }

    if (action === "prepare_attachment") {
        const validationError = validateAttachmentMetadata(parsePendingAttachment(body));
        if (validationError) {
            log("Rejected: invalid attachment metadata", validationError);
            return errorResponse(400, validationError, debug, startedAt);
        }
    }

    if (action === "send_attachment") {
        const validationError = validateAttachmentMetadata(attachment);
        if (validationError || !attachment) {
            log("Rejected: invalid attachment metadata", validationError);
            return errorResponse(
                400,
                validationError ?? "Os dados do anexo são inválidos.",
                debug,
                startedAt,
            );
        }
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
    const isZernioThread =
        thread.channel === "Instagram" ||
        thread.channel === "Facebook" ||
        thread.source === "zernio";
    const socialChannelLabel =
        thread.channel === "Facebook"
            ? "Facebook Messenger"
            : "Instagram";
    debug.transport = isZernioThread ? "zernio" : "blip";

    log("Thread resolved", {
        thread_id: thread.id,
        client_id: thread.client_id,
        instagram_user_id: thread.instagram_user_id,
        status: thread.status,
        assigned_attendant_id: thread.assigned_attendant_id,
        last_client_message_at: thread.last_client_message_at,
        channel: thread.channel,
        source: thread.source,
        transport: debug.transport,
    });

    let customer: {
        phone: string | null;
        external_contact_id: string | null;
    } | null = null;

    if (!isZernioThread) {
        if (!thread.client_id) {
            log("Rejected: WhatsApp thread has no CRM client");
            return errorResponse(
                422,
                "A conversa do WhatsApp não possui um cliente vinculado.",
                debug,
                startedAt,
            );
        }

        const { data, error } = await supabase
            .from("clients")
            .select("phone, external_contact_id")
            .eq("id", thread.client_id)
            .maybeSingle();

        if (error) {
            log("Failed to resolve customer identity", error);
            return errorResponse(500, error.message, debug, startedAt);
        }

        customer = data;
    }

    const recipientNumber = customer?.phone?.trim() ?? "";
    const zernioConversationId = thread.external_thread_id?.trim() ?? "";
    const zernioAccountId = thread.external_account_id?.trim() ?? "";

    if (isZernioThread && (!zernioConversationId || !zernioAccountId)) {
        log(`Rejected: ${socialChannelLabel} thread has no Zernio identifiers`);
        return errorResponse(
            422,
            `A conversa do ${socialChannelLabel} não possui os identificadores do Zernio.`,
            debug,
            startedAt,
        );
    }

    if (!isZernioThread && !recipientNumber) {
        log("Rejected: customer has no phone number");
        return errorResponse(422, "O cliente não possui telefone cadastrado.", debug, startedAt);
    }

    debug.recipient_input = isZernioThread
        ? zernioConversationId
        : recipientNumber;
    log("Customer identity resolved", {
        channel: thread.channel,
        phone: isZernioThread ? null : recipientNumber,
        zernio_conversation_id: isZernioThread
            ? zernioConversationId
            : null,
        zernio_account_id: isZernioThread ? zernioAccountId : null,
    });

    const lastClientMessageAt = thread.last_client_message_at
        ? new Date(thread.last_client_message_at).getTime()
        : 0;
    const windowAgeMs = lastClientMessageAt ? Date.now() - lastClientMessageAt : null;
    const localWindowOpen =
        lastClientMessageAt > 0 &&
        windowAgeMs !== null &&
        windowAgeMs <= RESPONSE_WINDOW_MS;
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

    if (action === "prepare_attachment") {
        const pendingAttachment = parsePendingAttachment(body)!;

        try {
            log("Preparing signed attachment upload");
            await ensureAttachmentBucket();

            const safeName = sanitizeFileName(pendingAttachment.name);
            const path = `${thread.id}/${Date.now()}-${randomUUID()}-${safeName}`;
            const { data, error } = await supabase.storage
                .from(ATTACHMENT_BUCKET)
                .createSignedUploadUrl(path);

            if (error || !data?.token) {
                throw error ?? new Error("Não foi possível preparar o upload do anexo.");
            }

            log("Signed attachment upload prepared", { path });
            return NextResponse.json({
                ok: true,
                action,
                bucket: ATTACHMENT_BUCKET,
                path,
                token: data.token,
                thread_id: thread.id,
            });
        } catch (error) {
            console.error(
                `[inbox-send:${requestId}] Attachment prepare failed`,
                error,
            );
            return errorResponse(
                500,
                error instanceof Error
                    ? error.message
                    : "Não foi possível preparar o anexo.",
                debug,
                startedAt,
            );
        }
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

    let blipMessage: SentBlipMessage | null = null;
    let providerMessageId = "";
    let providerExternalId = "";
    let providerRecipient = isZernioThread
        ? zernioConversationId
        : recipientNumber;
    let providerSentAt = new Date().toISOString();
    let persistedText = text;

    try {
        log(
            `Calling ${isZernioThread ? "Zernio" : "Blip"} messages API`,
            { action },
        );

        if (action === "send_attachment" && attachment) {
            if (!attachment.path.startsWith(`${thread.id}/`)) {
                throw new Error("O anexo não pertence a esta conversa.");
            }

            const { data: signedData, error: signedError } = await supabase.storage
                .from(ATTACHMENT_BUCKET)
                .createSignedUrl(attachment.path, ATTACHMENT_URL_TTL_SECONDS);

            if (signedError || !signedData?.signedUrl) {
                throw signedError ?? new Error("Não foi possível acessar o anexo.");
            }

            if (isZernioThread) {
                const zernioMessage = await sendZernioInboxMessage({
                    conversationId: zernioConversationId,
                    accountId: zernioAccountId,
                    attachmentUrl: signedData.signedUrl,
                    attachmentType: getZernioAttachmentType(
                        attachment.mimeType,
                    ),
                });

                providerMessageId = zernioMessage.id;
                providerExternalId = socialZernioExternalMessageId(
                    zernioMessage.id,
                    thread.channel,
                );
                providerRecipient = zernioMessage.conversationId;
                providerSentAt = zernioMessage.sentAt;
            } else {
                blipMessage = await sendBlipMediaMessage({
                    recipientNumber,
                    title: isCaptionlessMedia(attachment.mimeType)
                        ? undefined
                        : attachment.name,
                    uri: signedData.signedUrl,
                    mimeType: attachment.mimeType,
                    size: attachment.size,
                    requestId,
                });
            }
            persistedText = attachmentHistoryText(attachment);
        } else if (isZernioThread) {
            const zernioMessage = await sendZernioInboxMessage({
                conversationId: zernioConversationId,
                accountId: zernioAccountId,
                message: text,
            });

            providerMessageId = zernioMessage.id;
            providerExternalId = socialZernioExternalMessageId(
                zernioMessage.id,
                thread.channel,
            );
            providerRecipient = zernioMessage.conversationId;
            providerSentAt = zernioMessage.sentAt;
        } else {
            blipMessage = await sendBlipTextMessage({
                recipientNumber,
                text,
                requestId,
            });
        }

        if (blipMessage) {
            providerMessageId = blipMessage.id;
            providerExternalId = blipMessage.id;
            providerRecipient = blipMessage.to;
            debug.blip = blipMessage.debug;

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
                notification_command_status:
                    blipMessage.delivery.command_status,
                notification_command_reason:
                    blipMessage.delivery.command_reason,
            });
        } else {
            log(`Zernio accepted the ${socialChannelLabel} message`, {
                zernio_message_id: providerMessageId,
                conversation_id: providerRecipient,
                sent_at: providerSentAt,
            });
        }

        debug.recipient_identity = providerRecipient;
    } catch (error) {
        if (error instanceof BlipApiError || error instanceof BlipConfigurationError) {
            debug.blip = error.debug;
            debug.recipient_identity = error.debug?.body.to ?? null;
        }

        if (reopened) {
            log("Send failed; rolling the temporary reopen back");
            await rollbackReopenedThread(thread.id, attendant.id, requestId);
        }

        if (action === "send_attachment" && attachment) {
            await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.path]);
        }

        console.error(
            `[inbox-send:${requestId}] ${
                isZernioThread ? "Zernio" : "Blip"
            } send failed`,
            error,
        );

        const status =
            error instanceof BlipConfigurationError ||
            error instanceof ZernioConfigurationError
                ? 500
                : 502;
        const message =
            error instanceof BlipApiError ||
            error instanceof BlipConfigurationError ||
            error instanceof ZernioApiError ||
            error instanceof ZernioConfigurationError
                ? error.message
                : error instanceof Error
                    ? error.message
                    : `Não foi possível enviar a mensagem pelo ${
                          isZernioThread ? "Zernio" : "Blip"
                      }.`;

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
        text: persistedText,
        sentAt: providerSentAt,
        externalId: providerExternalId,
        externalContactId: isZernioThread
            ? null
            : providerRecipient,
        externalThreadId: isZernioThread ? zernioConversationId : null,
    });

    if (!persistenceResult.ok) {
        console.error(
            `[inbox-send:${requestId}] Message was accepted by ${
                isZernioThread ? "Zernio" : "Blip"
            } but local persistence failed`,
            persistenceResult.error,
        );

        log(
            `WARNING: ${
                isZernioThread ? "Zernio" : "Blip"
            } accepted the message, but local persistence failed`,
            {
                error: serializeError(persistenceResult.error),
            },
        );

        return NextResponse.json(
            {
                ok: true,
                message: null,
                thread_id: thread.id,
                reopened,
                persisted: false,
                provider: debug.transport,
                provider_message_id: providerMessageId,
                ...(blipMessage
                    ? { blip_message_id: blipMessage.id }
                    : { zernio_message_id: providerMessageId }),
                recipient: providerRecipient,
                test_mode: TEST_MODE,
                delivery: blipMessage?.delivery ?? null,
                warning:
                    `A mensagem foi aceita pelo ${
                        isZernioThread ? "Zernio" : "Blip"
                    }, mas o histórico local ainda não foi atualizado.`,
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
        provider: debug.transport,
        provider_message_id: providerMessageId,
        ...(blipMessage
            ? { blip_message_id: blipMessage.id }
            : { zernio_message_id: providerMessageId }),
        recipient: providerRecipient,
        test_mode: TEST_MODE,
        delivery: blipMessage?.delivery ?? null,
        debug: finishDebug(debug, startedAt),
    });
}

async function persistSentMessage({
    thread,
    attendantName,
    text,
    sentAt,
    externalId,
    externalContactId,
    externalThreadId,
}: {
    thread: {
        id: string;
        client_id: string | null;
        instagram_user_id: string | null;
    };
    attendantName: string;
    text: string;
    sentAt: string;
    externalId: string;
    externalContactId: string | null;
    externalThreadId: string | null;
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
                instagram_user_id: thread.instagram_user_id,
                conversation_id: null,
                thread_id: thread.id,
                sender_type: "attendant",
                sender_name: attendantName,
                text,
                sent_at: sentAt,
                sequence_index: sequenceIndex,
                external_id: externalId,
                external_contact_id: externalContactId,
                external_thread_id: externalThreadId,
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
            `[inbox-send:${requestId}] Failed to roll back reopened thread after send failure`,
            error,
        );
    }
}

async function ensureAttachmentBucket() {
    if (!attachmentBucketReady) {
        attachmentBucketReady = (async () => {
            const { data: existing, error: getError } =
                await supabase.storage.getBucket(ATTACHMENT_BUCKET);

            if (existing) return;

            if (getError && !/not found/i.test(getError.message)) {
                throw getError;
            }

            const { error: createError } = await supabase.storage.createBucket(
                ATTACHMENT_BUCKET,
                {
                    public: false,
                    fileSizeLimit: MAX_ATTACHMENT_BYTES,
                    allowedMimeTypes: [...ALLOWED_ATTACHMENT_MIME_TYPES],
                },
            );

            if (createError && !/already exists/i.test(createError.message)) {
                throw createError;
            }
        })().catch((error) => {
            attachmentBucketReady = null;
            throw error;
        });
    }

    return attachmentBucketReady;
}

function socialZernioExternalMessageId(
    messageId: string,
    channel: string | null,
) {
    return zernioExternalMessageId(
        channel === "Facebook" ? `facebook:${messageId}` : messageId,
    );
}

function normalizeAction(value: unknown): SendAction {
    if (value === "prepare_attachment" || value === "send_attachment") {
        return value;
    }

    return "send_text";
}

function parsePendingAttachment(body: Record<string, unknown>): AttachmentInput | null {
    const name = String(body.file_name ?? "").trim();
    const mimeType = String(body.mime_type ?? "").trim().toLowerCase();
    const size = Number(body.size ?? 0);

    if (!name && !mimeType && !size) return null;
    return { path: "", name, mimeType, size };
}

function parseAttachment(value: unknown): AttachmentInput | null {
    if (!value || typeof value !== "object") return null;

    const record = value as Record<string, unknown>;
    return {
        path: String(record.path ?? "").trim(),
        name: String(record.name ?? "").trim(),
        mimeType: String(record.mime_type ?? record.mimeType ?? "")
            .trim()
            .toLowerCase(),
        size: Number(record.size ?? 0),
    };
}

function validateAttachmentMetadata(attachment: AttachmentInput | null) {
    if (!attachment) return "Os dados do anexo são obrigatórios.";
    if (!attachment.name) return "O anexo precisa ter um nome.";
    if (!attachment.mimeType || !ALLOWED_ATTACHMENT_MIME_TYPES.has(attachment.mimeType)) {
        return "Este tipo de arquivo não é compatível com este canal.";
    }
    if (!Number.isFinite(attachment.size) || attachment.size <= 0) {
        return "O anexo está vazio.";
    }
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
        return "O anexo deve ter no máximo 16 MB.";
    }
    return null;
}

function sanitizeFileName(value: string) {
    const normalized = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return normalized.slice(0, 120) || "anexo";
}

function attachmentHistoryText(attachment: AttachmentInput) {
    const label = attachment.mimeType.startsWith("image/")
        ? "📷 Imagem"
        : attachment.mimeType.startsWith("video/")
            ? "🎥 Vídeo"
            : attachment.mimeType.startsWith("audio/")
                ? "🎵 Áudio"
                : `📎 ${attachment.name}`;

    const metadata = new URLSearchParams({
        path: attachment.path,
        name: attachment.name,
        mime_type: attachment.mimeType,
        size: String(attachment.size),
    });

    return `${label}${encodeInvisibleAttachmentMetadata(metadata.toString())}`;
}

function encodeInvisibleAttachmentMetadata(value: string) {
    const payload = `engravida-attachment:${value}`;
    const tagCharacters = [...payload]
        .map((character) =>
            String.fromCodePoint(0xe0000 + character.charCodeAt(0)),
        )
        .join("");

    return `${tagCharacters}${String.fromCodePoint(0xe007f)}`;
}

function isCaptionlessMedia(mimeType: string) {
    return (
        mimeType.startsWith("image/") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/")
    );
}

function getZernioAttachmentType(
    mimeType: string,
): "image" | "video" | "audio" | "file" {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "file";
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
                instagram_user_id,
                status,
                source,
                channel,
                assigned_attendant_id,
                last_client_message_at,
                external_thread_id,
                external_account_id
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
        .select("id, client_id, instagram_user_id, thread_id")
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
            instagram_user_id,
            status,
            source,
            channel,
            assigned_attendant_id,
            last_client_message_at,
            external_thread_id,
            external_account_id
        `)
        .limit(1);

    query = conversation.thread_id
        ? query.eq("id", conversation.thread_id)
        : conversation.client_id
          ? query.eq("client_id", conversation.client_id)
          : query.eq(
                "instagram_user_id",
                conversation.instagram_user_id,
            );

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
