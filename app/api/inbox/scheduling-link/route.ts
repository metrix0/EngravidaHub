import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { loadSchedulingContext } from "@/lib/inbox/schedulingData";
import { supabase } from "@/lib/supabase/client";

const schema = z.object({
    threadId: z.string().uuid(),
    clientId: z.string().uuid(),
    expectedClientId: z.string().uuid().nullable(),
});

export async function POST(request: Request) {
    try {
        const { user, attendant } = await getCurrentAttendantFromRequest();
        if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        if (!attendant?.is_online) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

        const parsed = schema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
        const { threadId, clientId, expectedClientId } = parsed.data;
        const context = await loadSchedulingContext(supabase, threadId, attendant.id);
        if (!context?.thread.instagram_user_id) {
            return NextResponse.json({ error: "Conversa social não encontrada." }, { status: 404 });
        }

        // Link only to the client selected in a successful appointment from this thread.
        const { data: appointment, error: appointmentError } = await supabase
            .from("appointments").select("id")
            .eq("thread_id", threadId).eq("client_id", clientId)
            .eq("created_by_attendant_id", attendant.id)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (appointmentError) throw appointmentError;
        if (!appointment) return NextResponse.json({ error: "Agendamento correspondente não encontrado." }, { status: 409 });

        const profileId = context.thread.instagram_user_id;
        const { data: profile, error: readError } = await supabase
            .from("instagram_users").select("client_id").eq("id", profileId).maybeSingle();
        if (readError) throw readError;
        if (!profile) return NextResponse.json({ error: "Perfil social não encontrado." }, { status: 404 });
        if (profile.client_id === clientId) return NextResponse.json({ ok: true });
        if (profile.client_id !== expectedClientId) {
            return NextResponse.json({ error: "O perfil foi vinculado a outro cadastro. Atualize a conversa." }, { status: 409 });
        }

        let update = supabase.from("instagram_users")
            .update({ client_id: clientId, updated_at: new Date().toISOString() })
            .eq("id", profileId);
        update = expectedClientId
            ? update.eq("client_id", expectedClientId)
            : update.is("client_id", null);
        const { data: linked, error } = await update.select("id").maybeSingle();
        if (error) throw error;
        if (!linked) return NextResponse.json({ error: "O perfil mudou durante a vinculação. Tente novamente." }, { status: 409 });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("[inbox/scheduling-link] failed", error);
        return NextResponse.json({ error: "Não foi possível vincular o perfil social." }, { status: 500 });
    }
}
