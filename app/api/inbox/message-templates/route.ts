// app/api/inbox/message-templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

function failure(error: string, status: number) {
    return NextResponse.json({ error }, { status });
}

async function allowRead() {
    const inbox = await getServerTabAccess("inbox");
    if (inbox.ok === true) return null;
    if (inbox.status !== 403) return failure(inbox.error, inbox.status);

    const settings = await getServerTabAccess("configuracoes_inbox");
    if (settings.ok === false) return failure(settings.error, settings.status);
    return null;
}

async function allowWrite() {
    const access = await getServerTabAccess("configuracoes_inbox");
    if (access.ok === false) return failure(access.error, access.status);
    return null;
}

function parseTemplate(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const record = body as Record<string, unknown>;
    const command = typeof record.command === "string" ? record.command.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!command.startsWith("/") || command.length < 2 || command.length > 100 || !text || text.length > 10000) return null;
    return { command, text };
}

function writeError(error: { code?: string; message: string }) {
    return failure(error.code === "23505" ? "Já existe uma mensagem com este comando." : error.message, error.code === "23505" ? 409 : 500);
}

export async function GET() {
    const denied = await allowRead();
    if (denied) return denied;

    const { data, error } = await supabase
        .from("inbox_message_templates")
        .select("id,command,text")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
    if (error) return failure(error.message, 500);
    return NextResponse.json({ templates: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
    const denied = await allowWrite();
    if (denied) return denied;
    const payload = parseTemplate(await request.json().catch(() => null));
    if (!payload) return failure("Preencha um comando iniciado por / e o texto da mensagem.", 400);

    const { data: last, error: orderError } = await supabase
        .from("inbox_message_templates")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (orderError) return failure(orderError.message, 500);

    const { data, error } = await supabase
        .from("inbox_message_templates")
        .insert({ id: crypto.randomUUID(), ...payload, sort_order: (last?.sort_order ?? 0) + 1 })
        .select("id,command,text")
        .single();
    if (error) return writeError(error);
    return NextResponse.json({ template: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
    const denied = await allowWrite();
    if (denied) return denied;
    const body: unknown = await request.json().catch(() => null);
    const payload = parseTemplate(body);
    const id = body && typeof body === "object" && "id" in body && typeof body.id === "string" ? body.id.trim() : "";
    if (!payload || !id) return failure("Dados da mensagem inválidos.", 400);

    const { data, error } = await supabase
        .from("inbox_message_templates")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id,command,text")
        .maybeSingle();
    if (error) return writeError(error);
    if (!data) return failure("Mensagem não encontrada.", 404);
    return NextResponse.json({ template: data });
}

export async function DELETE(request: NextRequest) {
    const denied = await allowWrite();
    if (denied) return denied;
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) return failure("ID da mensagem obrigatório.", 400);

    const { data, error } = await supabase
        .from("inbox_message_templates")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();
    if (error) return failure(error.message, 500);
    if (!data) return failure("Mensagem não encontrada.", 404);
    return NextResponse.json({ ok: true });
}
