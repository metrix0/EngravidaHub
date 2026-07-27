// app/api/clientes/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";

type Body = {
    client_id: string;
    funnel_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    moved_by_attendant_id?: string | null;
};

type LatestAttendantRow = {
    client_id: string;
    attendant_name: string | null;
};

export async function GET() {
    try {
        const [
            { data: clientsRaw, error: clientsError },
            { data: latestAttendants, error: attendantsError },
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
                    last_origin,
                    last_tunnel,
                    utm_medium,
                    utm_campaign
                `,
                )
                .order("last_interaction_at", { ascending: false }),
            supabase.rpc("clientes_latest_attendants"),
            supabase
                .from("funnel_stages")
                .select(
                    `
                    id,
                    funnel_id,
                    name,
                    position,
                    color
                `,
                )
                .order("position", { ascending: true }),
        ]);

        if (clientsError) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Failed to load clients",
                    details: clientsError,
                },
                { status: 500 },
            );
        }

        if (attendantsError) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Failed to load latest attendants",
                    details: attendantsError,
                },
                { status: 500 },
            );
        }

        const attendantByClientId = new Map<string, string>();

        for (const row of (latestAttendants ?? []) as LatestAttendantRow[]) {
            const name = row.attendant_name?.trim();
            if (name) attendantByClientId.set(row.client_id, name);
        }

        const clients = (clientsRaw ?? []).map((client) => ({
            ...client,
            // Existing clients UI consumes this key as "Origem". Its canonical
            // source is now the latest spreadsheet-matched conversation.
            utm_source: client.last_origin ?? null,
            attendant_name: attendantByClientId.get(client.id) ?? null,
        }));

        if (stagesError) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Failed to load funnel stages",
                    details: stagesError,
                },
                { status: 500 },
            );
        }

        return NextResponse.json({
            clients,
            stages: stages ?? [],
        });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: "Unexpected server error in clientes route",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }
}
