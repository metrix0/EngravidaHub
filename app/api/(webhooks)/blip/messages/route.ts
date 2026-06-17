// app/api/(webhooks)/blip/messages/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { supabase } from "@/lib";
import { parseBlipMessage } from "@/lib/importers/blip/parseBlipMessage";
import { createClientFromParsedMessage } from "@/lib/clients/createClient";
import { createAttendantFromParsedMessage } from "@/lib/attendants/createAttendant";
import { queueThreadForMessage } from "@/lib/inbox/queueThreadForMessage";

type ThreadRow = {
    id: string;
    client_id: string;
    latest_conversation_id: string | null;
};

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const parsedMessage = parseBlipMessage(body);

        if (!parsedMessage) {
            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
            });
        }

        if (!parsedMessage.external_contact_id) {
            return NextResponse.json({
                ok: true,
                received: true,
                skipped: true,
                reason: "missing_external_contact_id",
            });
        }

        const client = await createClientFromParsedMessage(parsedMessage);

        await createAttendantFromParsedMessage(parsedMessage);

        const thread = await queueThreadForMessage({
            clientId: client.id,
            source: "blip",
            channel: "WhatsApp",
        });

        const sequenceIndex = await getNextSequenceIndex(thread.id);

        const { error: messageError } = await supabase.from("messages").insert({
            id: randomUUID(),

            client_id: client.id,
            conversation_id: thread.latest_conversation_id,

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
                return NextResponse.json({
                    ok: true,
                    received: true,
                    duplicate: true,
                });
            }

            throw messageError;
        }

        return NextResponse.json({
            ok: true,
            received: true,
            saved: true,
            thread_id: thread.id,
        });
    } catch (error) {
        console.error("[/api/blip/messages] Failed to receive payload", error);

        return NextResponse.json(
            {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to receive Blip message",
            },
            { status: 500 }
        );
    }
}



async function getNextSequenceIndex(threadId: string) {
    const { data, error } = await supabase
        .from("messages")
        .select("sequence_index")
        .eq("thread_id", threadId)
        .order("sequence_index", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return (data?.sequence_index ?? 0) + 1;
}
