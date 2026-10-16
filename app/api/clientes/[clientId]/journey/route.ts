// app/api/clientes/[clientId]/journey/route.ts
import { NextRequest, NextResponse } from "next/server";

import { getCurrentAttendantFromRequest } from "@/lib/attendants/getCurrentAttendantFromRequest";
import { buildIndividualJourney, type JourneyRow } from "@/lib/clients/individualJourney";
import { supabase } from "@/lib/supabase/client";

type RouteContext = { params: Promise<{ clientId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
const MAX_PER_SOURCE = 10_000;

// Bounded, indexed, per-customer reads; this endpoint is separate from profile loading.
async function loadRows(
    table: string, columns: string, field: string, ids: string[],
    orderBy = "id",
): Promise<{ rows: JourneyRow[]; partial: boolean }> {
    if (ids.length === 0) return { rows: [], partial: false };
    const rows: JourneyRow[] = [];
    let partial = false;
    for (let position = 0; position < ids.length; position += 50) {
        const batch = ids.slice(position, position + 50);
        for (let offset = 0; offset < MAX_PER_SOURCE; offset += PAGE_SIZE) {
            const { data, error } = await supabase.from(table)
                .select(columns)
                .in(field, batch)
                .order(orderBy, { ascending: true })
                .range(offset, offset + PAGE_SIZE - 1);
            if (error) throw error;
            const page = (data ?? []) as JourneyRow[];
            rows.push(...page);
            if (page.length < PAGE_SIZE) break;
            if (offset + PAGE_SIZE >= MAX_PER_SOURCE) partial = true;
        }
    }
    return { rows, partial };
}

function combine(...sources: Array<{ rows: JourneyRow[]; partial: boolean }>) {
    const unique = new Map<string, JourneyRow>();
    for (const source of sources) {
        for (const row of source.rows) {
            const id = String(row.id ?? row.source_invoice_id ?? "");
            if (id) unique.set(id, row);
        }
    }
    return { rows: [...unique.values()], partial: sources.some(source => source.partial) };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
    try {
        const { user } = await getCurrentAttendantFromRequest();
        if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
        const { clientId: rawId } = await params;
        const isSocial = rawId.startsWith("social:");
        const requestedId = isSocial ? rawId.slice(7) : rawId;
        if (!UUID.test(requestedId)) {
            return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
        }

        let clientId: string | null = isSocial ? null : requestedId;
        let socialIds: string[] = [];
        let socialRows: JourneyRow[] = [];
        if (isSocial) {
            const social = await loadRows("instagram_users", "id,client_id,username,first_seen_at", "id", [requestedId]);
            if (!social.rows.length) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
            socialRows = social.rows;
            socialIds = [requestedId];
            clientId = typeof social.rows[0].client_id === "string" ? social.rows[0].client_id : null;
        }
        const [clientRows, linkedSocial] = await Promise.all([
            loadRows("clients", "id,first_seen_at,created_at,last_origin,utm_source,utm_campaign,tracking_updated_at,last_active_message_sent_at", "id", clientId ? [clientId] : []),
            loadRows("instagram_users", "id,client_id,username,first_seen_at", "client_id", clientId ? [clientId] : []),
        ]);
        if (!isSocial && !clientRows.rows.length) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
        socialRows = combine({ rows: socialRows, partial: false }, linkedSocial).rows;
        socialIds = [...new Set([...socialIds, ...socialRows.map(row => String(row.id))])];

        const [directConversations, socialConversations, directThreads, socialThreads,
            analysesDirect, analysesSocial, tintim, calls, funnelHistory, appointments,
            clinisys, schedules, invoices] = await Promise.all([
            loadRows("conversations", "id,client_id,instagram_user_id,thread_id,started_at,ended_at,channel,source,origin,attendant_chat_name", "client_id", clientId ? [clientId] : []),
            loadRows("conversations", "id,client_id,instagram_user_id,thread_id,started_at,ended_at,channel,source,origin,attendant_chat_name", "instagram_user_id", socialIds),
            loadRows("thread", "id,client_id,instagram_user_id,channel,claimed_at,closed_at", "client_id", clientId ? [clientId] : []),
            loadRows("thread", "id,client_id,instagram_user_id,channel,claimed_at,closed_at", "instagram_user_id", socialIds),
            loadRows("conversation_analysis", "id,conversation_id,client_id,outcome_events", "client_id", clientId ? [clientId] : []),
            loadRows("conversation_analysis", "id,conversation_id,instagram_user_id,outcome_events", "instagram_user_id", socialIds),
            loadRows("tintim_attribution_events", "id,occurred_at,source,platform", "client_id", clientId ? [clientId] : []),
            loadRows("client_calls", "id,called_at,closure_tag", "client_id", clientId ? [clientId] : []),
            loadRows("funnel_history", "id,moved_at,note", "client_id", clientId ? [clientId] : []),
            loadRows("appointments", "id,source_external_id,created_at,starts_at,updated_at,status,procedure_name", "client_id", clientId ? [clientId] : []),
            loadRows("funnel_clinisys_events", "id,source_external_id,created_in_source_at,scheduled_for,procedure_name,status,event_kind", "client_id", clientId ? [clientId] : []),
            loadRows("schedules", "id,source_external_id,created_in_source_at,scheduled_for,procedure_name,status", "client_id", clientId ? [clientId] : []),
            loadRows("clinisys_invoices", "source_invoice_id,issued_at,amount,description,status", "client_id", clientId ? [clientId] : [], "source_invoice_id"),
        ]);

        const conversations = combine(directConversations, socialConversations);
        const threads = combine(directThreads, socialThreads);
        const analyses = combine(analysesDirect, analysesSocial);
        const threadIds = threads.rows.map(row => String(row.id));
        const conversationIds = conversations.rows.map(row => String(row.id));
        const appointmentIds = appointments.rows.map(row => String(row.id));
        const [threadAttributions, socialAttributions, adEvents, appointmentHistory] = await Promise.all([
            loadRows("conversation_ad_attributions", "id,thread_id,channel,ad_name,referral_ad_title,campaign_name,meta_ad_id,zernio_ad_id,referral_source,referral_received_at,created_at", "thread_id", threadIds),
            loadRows("conversation_ad_attributions", "id,instagram_user_id,channel,ad_name,referral_ad_title,campaign_name,meta_ad_id,zernio_ad_id,referral_source,referral_received_at,created_at", "instagram_user_id", socialIds),
            loadRows("ad_events", "id,conversation_id,event_type,platform,status,event_date,created_at", "conversation_id", conversationIds),
            loadRows("schedule_history", "id,entity_id,operation,recorded_at,before_state,after_state", "entity_id", appointmentIds, "id"),
        ]);
        // The history table also includes agenda-wide changes; only these
        // specific, client-linked appointment IDs are included.
        const history = appointmentHistory.rows.filter(row => row.operation === "UPDATE");
        const sources = [
            clientRows, linkedSocial, directConversations, socialConversations, directThreads, socialThreads,
            analysesDirect, analysesSocial, tintim, calls, funnelHistory, appointments, clinisys, schedules, invoices,
            threadAttributions, socialAttributions, adEvents, appointmentHistory,
        ];
        const journey = buildIndividualJourney({
            client: clientRows.rows[0] ?? null,
            instagramUsers: socialRows,
            conversations: conversations.rows,
            analyses: analyses.rows,
            threads: threads.rows,
            adAttributions: combine(threadAttributions, socialAttributions).rows,
            tintim: tintim.rows,
            adEvents: adEvents.rows,
            calls: calls.rows,
            funnelHistory: funnelHistory.rows,
            appointments: appointments.rows,
            appointmentHistory: history,
            clinisys: clinisys.rows,
            schedules: schedules.rows,
            invoices: invoices.rows,
            partial: sources.some(source => source.partial),
        });
        return NextResponse.json(journey, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        if (request.signal.aborted) return new NextResponse(null, { status: 499 });
        console.error("[client-journey] GET failed", error);
        return NextResponse.json({ error: "Não foi possível carregar a jornada do cliente." }, { status: 500 });
    }
}
