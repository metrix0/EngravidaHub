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

type LatestConversationRow = {
    client_id: string;
    attendant_id: string | null;
    attendant_chat_name: string | null;
    started_at: string | null;
    attendants:
        | { name: string | null }
        | Array<{ name: string | null }>
        | null;
};

const LATEST_CONVERSATIONS_PAGE_SIZE = 1_000;
const MAX_LATEST_CONVERSATIONS = 100_000;

export async function GET() {
    try {
        const [
            { data: clientsRaw, error: clientsError },
            { data: latestConversations, error: conversationsError },
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
            loadLatestConversations(),
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

        if (conversationsError) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Failed to load latest attendants",
                    details: conversationsError,
                },
                { status: 500 },
            );
        }

        const attendantByClientId = new Map<string, string>();

        for (const conversation of (latestConversations ?? []) as unknown as LatestConversationRow[]) {
            if (attendantByClientId.has(conversation.client_id)) continue;

            const relation = Array.isArray(conversation.attendants)
                ? conversation.attendants[0]
                : conversation.attendants;
            const name =
                conversation.attendant_chat_name?.trim() ||
                relation?.name?.trim() ||
                null;

            if (name) attendantByClientId.set(conversation.client_id, name);
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

async function loadLatestConversations() {
    const rows: LatestConversationRow[] = [];

    for (
        let offset = 0;
        offset < MAX_LATEST_CONVERSATIONS;
        offset += LATEST_CONVERSATIONS_PAGE_SIZE
    ) {
        const { data, error } = await supabase
            .from("conversations")
            .select(
                `
                client_id,
                attendant_id,
                attendant_chat_name,
                started_at,
                attendants!conversations_attendant_id_fkey (name)
            `,
            )
            .order("started_at", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false })
            .range(offset, offset + LATEST_CONVERSATIONS_PAGE_SIZE - 1);

        if (error) return { data: null, error };

        rows.push(...((data ?? []) as unknown as LatestConversationRow[]));
        if ((data ?? []).length < LATEST_CONVERSATIONS_PAGE_SIZE) break;
    }

    return { data: rows, error: null };
}
