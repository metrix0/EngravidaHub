// app/api/clientes/[clientId]/calls/route.ts
import { NextRequest, NextResponse } from "next/server";

import { supabase } from "@/lib";
import { isClientCallClosureTag } from "@/lib/clients/callTracking";

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
        .from("client_calls")
        .select("id, client_id, called_at, closure_tag, created_at")
        .eq("client_id", clientId)
        .order("called_at", { ascending: false })
        .limit(50);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ calls: data ?? [] });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    const { clientId } = await params;

    if (!clientId) {
        return NextResponse.json(
            { error: "clientId is required" },
            { status: 400 },
        );
    }

    let body: { closure_tag?: unknown };

    try {
        body = (await request.json()) as { closure_tag?: unknown };
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 },
        );
    }

    if (!isClientCallClosureTag(body.closure_tag)) {
        return NextResponse.json(
            { error: "Invalid call closure tag" },
            { status: 400 },
        );
    }

    const calledAt = new Date().toISOString();
    const { data: call, error } = await supabase
        .from("client_calls")
        .insert({
            client_id: clientId,
            called_at: calledAt,
            closure_tag: body.closure_tag,
        })
        .select("id, client_id, called_at, closure_tag, created_at")
        .single();

    if (error) {
        if (error.code === "23503") {
            return NextResponse.json(
                { error: "Client not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        call,
        last_called_at: call.called_at,
        last_call_closure_tag: call.closure_tag,
    });
}
