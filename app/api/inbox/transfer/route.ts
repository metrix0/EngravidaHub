import { NextResponse } from "next/server";
import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { supabase } from "@/lib/supabase/client";

export async function GET() {
    const { attendant } = await getCurrentAttendantFromRequest();
    if (!attendant?.active || !attendant.is_online) {
        return NextResponse.json({ ok: false, error: "Atendente indisponível." }, { status: 403 });
    }

    const [attendants, queues] = await Promise.all([
        supabase.from("attendants").select("id, name, is_online, queue_id").eq("active", true).order("name"),
        supabase.from("queues").select("id, name").eq("active", true).order("name"),
    ]);

    if (attendants.error || queues.error) {
        return NextResponse.json({ ok: false, error: attendants.error?.message ?? queues.error?.message }, { status: 500 });
    }
    return NextResponse.json({
        ok: true,
        attendants: (attendants.data ?? []).filter(person => person.id !== attendant.id),
        queues: queues.data ?? [],
    });
}

export async function POST(request: Request) {
    const { attendant } = await getCurrentAttendantFromRequest();
    if (!attendant?.active || !attendant.is_online) {
        return NextResponse.json({ ok: false, error: "Atendente indisponível." }, { status: 403 });
    }

    let body: { threadId?: unknown; targetType?: unknown; targetId?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ ok: false, error: "Solicitação inválida." }, { status: 400 });
    }
    const { threadId, targetType, targetId } = body;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof threadId !== "string" || !uuid.test(threadId) ||
        typeof targetId !== "string" || !uuid.test(targetId) ||
        (targetType !== "attendant" && targetType !== "queue")) {
        return NextResponse.json({ ok: false, error: "Selecione um destino válido." }, { status: 400 });
    }

    if (targetType === "attendant" && targetId === attendant.id) {
        return NextResponse.json({ ok: false, error: "Selecione outro atendente." }, { status: 400 });
    }

    const destination = targetType === "attendant"
        ? await supabase.from("attendants").select("id").eq("id", targetId).eq("active", true).maybeSingle()
        : await supabase.from("queues").select("id").eq("id", targetId).eq("active", true).maybeSingle();
    if (destination.error) {
        return NextResponse.json({ ok: false, error: destination.error.message }, { status: 500 });
    }
    if (!destination.data) {
        return NextResponse.json({ ok: false, error: "Destino não encontrado ou inativo." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updates = targetType === "attendant"
        ? { assigned_attendant_id: targetId, target_queue_id: null, claimed_at: now }
        : { assigned_attendant_id: null, target_queue_id: targetId, claimed_at: null, queued_at: now };
    const { data, error } = await supabase
        .from("thread")
        .update(updates)
        .eq("id", threadId)
        .eq("status", "open")
        .eq("assigned_attendant_id", attendant.id)
        .select("id")
        .maybeSingle();
    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ ok: false, error: "Atendimento indisponível ou já transferido." }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
}
