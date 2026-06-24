// app/api/(webhooks)/blip/messages/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { createAttendantFromParsedMessage } from "@/lib/attendants/createAttendant";
import { createClientFromParsedMessage } from "@/lib/clients/createClient";
import { queueThreadForMessage } from "@/lib/inbox/queueThreadForMessage";
import { parseBlipMessage } from "@/lib/importers/blip/parseBlipMessage";
import { supabase } from "@/lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const webhookRequestId = randomUUID();
    const startedAt = Date.now();

    console.info(`[blip-webhook:${webhookRequestId}] Incoming request`, {
        method: request.method,
        url: request.url,
        content_type: request.headers.get("content-type"),
    });

    try {
        const body = await request.json();

        console.info(`[blip-webhook:${webhookRequestId}] Raw Blip envelope`, body);

        const parsedMessage = parseBlipMessage(body);

        console.info(`[blip-webhook:${webhookRequestId}] Parsed envelope`, {
            parsed: parsedMessage,
            duration_ms: Date.now() - startedAt,
        });

        if (!parsedMessage) {
            console.warn(
                `[blip-webhook:${webhookRequestId}] Envelope skipped: unsupported or empty content`,
            );

            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
                reason: "unsupported_or_empty_content",
                request_id: webhookRequestId,
            });
        }

        if (!parsedMessage.external_contact_id) {
            console.warn(
                `[blip-webhook:${webhookRequestId}] Envelope skipped: missing external contact ID`,
                parsedMessage,
            );

            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
                reason: "missing_external_contact_id",
                request_id: webhookRequestId,
            });
        }

        // Outbound messages sent by this Inbox may be echoed to the webhook by Blip.
        // Check before touching clients or threads so the echo does not create duplicates.
        if (
            parsedMessage.external_id &&
            (await messageAlreadyExists(parsedMessage.external_id, webhookRequestId))
        ) {
            console.info(
                `[blip-webhook:${webhookRequestId}] Duplicate/outbound echo ignored`,
                { external_id: parsedMessage.external_id },
            );

            return NextResponse.json({
                ok: true,
                received: true,
                duplicate: true,
                external_id: parsedMessage.external_id,
                request_id: webhookRequestId,
            });
        }

        console.info(`[blip-webhook:${webhookRequestId}] Creating/updating client`, {
            external_contact_id: parsedMessage.external_contact_id,
        });
        const client = await createClientFromParsedMessage(parsedMessage);

        console.info(`[blip-webhook:${webhookRequestId}] Client resolved`, {
            client_id: client.id,
        });

        await createAttendantFromParsedMessage(parsedMessage);

        console.info(`[blip-webhook:${webhookRequestId}] Updating Inbox thread`, {
            client_id: client.id,
            sender_type: parsedMessage.sender_type,
            sent_at: parsedMessage.sent_at,
            updates_24h_window: parsedMessage.sender_type === "client",
        });

        const thread = await queueThreadForMessage({
            clientId: client.id,
            source: "blip",
            channel: "WhatsApp",
            senderType: parsedMessage.sender_type,
            sentAt: parsedMessage.sent_at,
        });

        const sequenceIndex = await getNextSequenceIndex(
            thread.id,
            webhookRequestId,
        );

        console.info(`[blip-webhook:${webhookRequestId}] Saving message`, {
            thread_id: thread.id,
            client_id: client.id,
            sequence_index: sequenceIndex,
            external_id: parsedMessage.external_id,
            sender_type: parsedMessage.sender_type,
            sent_at: parsedMessage.sent_at,
        });

        const { error: messageError } = await supabase.from("messages").insert({
            id: randomUUID(),
            client_id: client.id,
            conversation_id: null,
            thread_id: thread.id,
            sender_type: parsedMessage.sender_type,
            sender_name: parsedMessage.sender_name,
            text: parsedMessage.text,
            sent_at: parsedMessage.sent_at,
            sequence_index: sequenceIndex,
            external_id: parsedMessage.external_id,
            external_contact_id: parsedMessage.external_contact_id,
            external_thread_id: parsedMessage.external_thread_id,
            external_attendant_id:
                parsedMessage.external_attendant_id || parsedMessage.sender_name,
            interactive_option_id: parsedMessage.interactive_option_id,
        });

        if (messageError) {
            if (messageError.code === "23505") {
                console.info(
                    `[blip-webhook:${webhookRequestId}] Duplicate database message ignored`,
                    { external_id: parsedMessage.external_id },
                );

                return NextResponse.json({
                    ok: true,
                    received: true,
                    duplicate: true,
                    request_id: webhookRequestId,
                });
            }

            throw messageError;
        }

        console.info(`[blip-webhook:${webhookRequestId}] Completed successfully`, {
            thread_id: thread.id,
            client_id: client.id,
            last_client_message_at:
                parsedMessage.sender_type === "client"
                    ? parsedMessage.sent_at
                    : "unchanged",
            duration_ms: Date.now() - startedAt,
        });

        return NextResponse.json({
            ok: true,
            received: true,
            saved: true,
            thread_id: thread.id,
            client_id: client.id,
            request_id: webhookRequestId,
            duration_ms: Date.now() - startedAt,
        });
    } catch (error) {
        console.error(
            `[blip-webhook:${webhookRequestId}] Failed to process payload`,
            error,
        );

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to receive Blip message",
                request_id: webhookRequestId,
                duration_ms: Date.now() - startedAt,
            },
            { status: 500 },
        );
    }
}

async function messageAlreadyExists(
    externalId: string,
    webhookRequestId: string,
) {
    const { data, error } = await supabase
        .from("messages")
        .select("id")
        .eq("external_id", externalId)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(
            `[blip-webhook:${webhookRequestId}] Duplicate lookup failed`,
            error,
        );
        throw error;
    }

    return Boolean(data);
}

async function getNextSequenceIndex(
    threadId: string,
    webhookRequestId: string,
) {
    const { data, error } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", threadId)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(
            `[blip-webhook:${webhookRequestId}] Sequence index lookup failed`,
            error,
        );
        throw error;
    }

    return (data?.sequence_index ?? 0) + 1;
}
