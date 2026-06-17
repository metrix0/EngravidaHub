// apps/crm/src/app/api/inbox/threads/[threadId]/notes/route.ts
import { NextResponse } from "next/server";

import type { ClientNote } from "@/types/inbox";
import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;
    const body = await request.json();

    const text = String(body.text ?? "").trim();

    if (!text) {
        return NextResponse.json(
            { ok: false, error: "Note text is required" },
            { status: 400 }
        );
    }

    const { supabase, attendant } = await getCurrentAttendantFromRequest();

    if (!attendant || !attendant.is_online) {
        return NextResponse.json(
            { ok: false, error: "Not allowed" },
            { status: 403 }
        );
    }

    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("id, client_id")
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendant.id)
        .maybeSingle();

    if (threadError) {
        return NextResponse.json(
            { ok: false, error: threadError.message },
            { status: 500 }
        );
    }

    if (!thread) {
        return NextResponse.json(
            { ok: false, error: "Thread not found" },
            { status: 404 }
        );
    }

    const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id, notes")
        .eq("id", thread.client_id)
        .maybeSingle();

    if (clientError) {
        return NextResponse.json(
            { ok: false, error: clientError.message },
            { status: 500 }
        );
    }

    if (!client) {
        return NextResponse.json(
            { ok: false, error: "Client not found" },
            { status: 404 }
        );
    }

    const currentNotes = Array.isArray(client.notes)
        ? (client.notes as ClientNote[])
        : [];

    const note: ClientNote = {
        id: crypto.randomUUID(),
        author_name: attendant.name,
        text,
        created_at: new Date().toISOString(),
    };

    const nextNotes = [note, ...currentNotes];

    const { error: updateError } = await supabase
        .from("clients")
        .update({ notes: nextNotes })
        .eq("id", client.id);

    if (updateError) {
        return NextResponse.json(
            { ok: false, error: updateError.message },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        note,
    });
}