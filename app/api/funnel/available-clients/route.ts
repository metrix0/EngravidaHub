// app/api/funnel/available-clients/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";

export async function GET() {
    const [
        { data: clients, error: clientsError },
        { data: stages, error: stagesError },
    ] = await Promise.all([
        supabase
            .from("clients")
            .select(
                `
                id,
                name,
                phone,
                email,
                funnel_stage_id,
                first_seen_at,
                last_interaction_at,
                utm_source,
                utm_medium,
                utm_campaign,
                created_at,
                updated_at
                `
            )
            .order("last_interaction_at", { ascending: false }),

        supabase
            .from("funnel_stages")
            .select("id, funnel_id, name, position, color")
            .order("position", { ascending: true }),
    ]);

    if (clientsError || stagesError) {
        return NextResponse.json(
            {
                error: "Failed to load available clients",
                details: {
                    clientsError,
                    stagesError,
                },
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        clients: clients ?? [],
        stages: stages ?? [],
    });
}
