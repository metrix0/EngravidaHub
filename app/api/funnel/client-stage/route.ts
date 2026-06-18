// app/api/funnel/client-stage/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";

type ClientStageRequest = {
    client_id?: string;
    funnel_id?: string;
    from_stage_id?: string | null;
    to_stage_id?: string | null;
    moved_by_attendant_id?: string | null;
};

export async function PATCH(request: Request) {
    const body = (await request.json()) as ClientStageRequest;

    const {
        client_id,
        funnel_id,
        from_stage_id = null,
        to_stage_id = null,
        moved_by_attendant_id = null,
    } = body;

    if (!client_id) {
        return NextResponse.json(
            { error: "client_id is required" },
            { status: 400 }
        );
    }

    if (!funnel_id) {
        return NextResponse.json(
            { error: "funnel_id is required" },
            { status: 400 }
        );
    }

    const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id, funnel_stage_id")
        .eq("id", client_id)
        .single();

    if (clientError || !client) {
        return NextResponse.json(
            {
                error: "Client not found",
                details: clientError,
            },
            { status: 404 }
        );
    }

    const currentStageId = client.funnel_stage_id ?? null;

    if (currentStageId === to_stage_id) {
        return NextResponse.json({
            client,
            removed_from_funnel: to_stage_id === null,
            unchanged: true,
        });
    }

    const { data: updatedClient, error: updateError } = await supabase
        .from("clients")
        .update({
            funnel_stage_id: to_stage_id,
            updated_at: new Date().toISOString(),
        })
        .eq("id", client_id)
        .select(
            `
            id,
            name,
            phone,
            email,
            first_seen_at,
            last_interaction_at,
            funnel_stage_id,
            utm_source,
            utm_medium,
            utm_campaign,
            created_at,
            updated_at
            `
        )
        .single();

    if (updateError || !updatedClient) {
        return NextResponse.json(
            {
                error: "Failed to update client funnel stage",
                details: updateError,
            },
            { status: 500 }
        );
    }

    if (to_stage_id === null) {
        return NextResponse.json({
            client: updatedClient,
            removed_from_funnel: true,
        });
    }

    const { error: historyError } = await supabase
        .from("funnel_history")
        .insert({
            client_id,
            funnel_id,
            from_stage_id: from_stage_id ?? currentStageId,
            to_stage_id,
            moved_by_attendant_id,
        });

    if (historyError) {
        return NextResponse.json(
            {
                error: "Client stage updated, but failed to create funnel history",
                details: historyError,
                client: updatedClient,
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        client: updatedClient,
        removed_from_funnel: false,
    });
}
