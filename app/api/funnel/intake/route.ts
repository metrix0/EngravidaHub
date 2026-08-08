// app/api/funnel/intake/route.ts
import { NextResponse } from "next/server";

import { supabase } from "@/lib";

const NO_SCHEDULE_TAG = "Não agendou 1ª Avaliação";
const NO_RETURN_TAG = "Sem retorno da paciente";
const INTAKE_TAGS = [NO_SCHEDULE_TAG, NO_RETURN_TAG] as const;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const CLIENT_SELECT = `
    id,
    name,
    phone,
    email,
    funnel_stage_id,
    unit_id,
    last_interaction_at,
    last_called_at,
    last_call_closure_tag,
    last_closing_tag,
    last_closing_tag_at,
    utm_source,
    utm_medium,
    utm_campaign,
    updated_at
`;

type IntakeClientRow = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    unit_id: string | null;
    last_interaction_at: string;
    last_called_at: string | null;
    last_call_closure_tag: string | null;
    last_closing_tag: string | null;
    last_closing_tag_at: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    updated_at: string;
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const unitIds = parseCsv(searchParams.get("unit_ids"));
    const origins = parseCsv(searchParams.get("origins"));
    const search = sanitizeSearch(searchParams.get("search"));
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);
    const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
    );

    let query = supabase
        .from("clients")
        .select(CLIENT_SELECT, { count: "exact" })
        .is("funnel_stage_id", null)
        .in("last_closing_tag", [...INTAKE_TAGS]);

    if (unitIds.length > 0) query = query.in("unit_id", unitIds);
    if (origins.length > 0) query = query.in("utm_source", origins);
    if (search) {
        const pattern = `*${search}*`;
        query = query.or(
            `name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
        );
    }
    const { data, error, count } = await query
        .order("last_closing_tag_at", {
            ascending: false,
            nullsFirst: false,
        })
        .order("last_closing_tag", { ascending: true })
        .order("last_interaction_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);

    if (error) {
        return NextResponse.json(
            {
                error: "Failed to load non-scheduled clients",
                details: error,
            },
            { status: 500 },
        );
    }

    const clients = (data ?? []) as IntakeClientRow[];

    return NextResponse.json({
        clients: clients.map((client) => ({
            ...client,
            schedule_summary: null,
            appointment: null,
        })),
        total: count ?? 0,
    });
}

export async function DELETE(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("client_id")?.trim();

    if (!clientId) {
        return NextResponse.json(
            { error: "client_id is required" },
            { status: 400 },
        );
    }

    const { data, error } = await supabase
        .from("clients")
        .update({
            last_closing_tag: null,
            last_closing_tag_at: null,
        })
        .eq("id", clientId)
        .is("funnel_stage_id", null)
        .in("last_closing_tag", [...INTAKE_TAGS])
        .select("id")
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
        return NextResponse.json(
            { error: "Client is no longer in the non-scheduled queue" },
            { status: 409 },
        );
    }

    return NextResponse.json({ ok: true, client_id: data.id });
}

function sanitizeSearch(value: string | null) {
    const cleaned = value?.replace(/[,*()]/g, " ").trim() ?? "";
    return cleaned || null;
}

function parseCsv(value: string | null) {
    if (!value) return [];
    return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
