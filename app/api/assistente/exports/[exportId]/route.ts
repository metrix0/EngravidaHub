// app/api/assistente/exports/[exportId]/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ exportId: string }> },
) {
    const access = await getServerTabAccess("assistente");
    if (access.ok === false) {
        return NextResponse.json(
            { ok: false, error: access.error },
            { status: access.status },
        );
    }

    const { exportId } = await params;
    if (!isUuid(exportId)) {
        return NextResponse.json(
            { ok: false, error: "Arquivo inválido." },
            { status: 400 },
        );
    }

    const { data, error } = await supabase
        .from("assistant_exports")
        .select("file_name, mime_type, content, expires_at")
        .eq("id", exportId)
        .eq("auth_user_id", access.user.id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (error) {
        return NextResponse.json(
            { ok: false, error: error.message },
            { status: 500 },
        );
    }
    if (!data) {
        return NextResponse.json(
            { ok: false, error: "Arquivo não encontrado ou expirado." },
            { status: 404 },
        );
    }

    const fileName = data.file_name.replace(/[^a-zA-Z0-9._-]/g, "-");
    return new Response(data.content, {
        headers: {
            "Cache-Control": "private, no-store",
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Content-Type": data.mime_type,
            "X-Content-Type-Options": "nosniff",
        },
    });
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}
