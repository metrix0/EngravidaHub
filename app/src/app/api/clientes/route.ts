// apps/crm/src/app/api/clientes/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@engravida/lib";

type Body = {
    client_id: string;
    pipeline_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    moved_by_attendant_id?: string | null;
};

export async function GET() {
    try {
        const { data: clientsRaw, error: clientsError } = await supabase
            .from("clients")
            .select(
                `
        id,
        name,
        phone,
        email,
        pipeline_stage_id,
        first_seen_at,
        last_interaction_at,
        utm_source,
        utm_medium,
        utm_campaign
    `
            )
            .order("last_interaction_at", { ascending: false });

        const clients = (clientsRaw ?? []).map((client) => ({
            ...client,
            attendant_name: null,
        }));

        if (clientsError) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Failed to load clients",
                    details: clientsError,
                },
                { status: 500 }
            );
        }

        const { data: stages, error: stagesError } = await supabase
            .from("pipeline_stages")
            .select(
                `
                id,
                pipeline_id,
                name,
                position,
                color
            `
            )
            .order("position", { ascending: true });

        if (stagesError) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Failed to load pipeline stages",
                    details: stagesError,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            clients: clients ?? [],
            stages: stages ?? [],
        });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: "Unexpected server error in clientes route",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}