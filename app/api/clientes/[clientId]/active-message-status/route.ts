// app/api/clientes/[clientId]/active-message-status/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";

type RouteContext = {
    params: Promise<{
        clientId: string;
    }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
    const { clientId } = await params;

    if (!clientId) {
        return NextResponse.json(
            { error: "clientId is required" },
            { status: 400 },
        );
    }

    const { data, error } = await supabase
        .from("clients")
        .select("last_active_message_sent_at")
        .eq("id", clientId)
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({
        last_active_message_sent_at:
            data.last_active_message_sent_at ?? null,
    });
}
