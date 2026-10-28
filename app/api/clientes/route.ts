// app/api/clientes/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import { invoiceStatusIsAuthorized, journeyInvoiceKind } from "@/lib/funnel/fullJourney";
import { isTrackedWhatsappConversation } from "@/lib/funnel/whatsappTracking";

const FILTER_BATCH_SIZE = 100;
const FILTER_PAGE_SIZE = 1000;
const TINTIM_MATCH_MS = 2 * 86_400_000;

/** Fetch every matching row: Supabase/PostgREST caps a single response at 1,000. */
async function loadClientFilterRows<T>(
    clientIds: string[],
    getPage: (ids: string[], from: number) => Promise<T[]>,
): Promise<T[]> {
    const result: T[] = [];
    for (let start = 0; start < clientIds.length; start += FILTER_BATCH_SIZE) {
        const ids = clientIds.slice(start, start + FILTER_BATCH_SIZE);
        for (let from = 0; ; from += FILTER_PAGE_SIZE) {
            const page = await getPage(ids, from);
            result.push(...page);
            if (page.length < FILTER_PAGE_SIZE) break;
        }
    }
    return result;
}

type LatestAttendantRow = {
    client_id: string;
    attendant_name: string | null;
};

export async function GET(request: Request) {
    try {
        const searchParams = new URL(request.url).searchParams;

        if (searchParams.get("picker") === "1") {
            const search = (searchParams.get("search") ?? "")
                .replace(/[,%()]/g, " ")
                .trim()
                .slice(0, 120);

            let query = supabase
                .from("clients")
                .select("id, name, phone, email")
                .order("last_interaction_at", {
                    ascending: false,
                    nullsFirst: false,
                })
                .limit(10);

            if (search) {
                query = query.or(
                    `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`,
                );
            }

            const { data, error } = await query;

            if (error) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: "Failed to search clients",
                        details: error,
                    },
                    { status: 500 },
                );
            }

            return NextResponse.json({ clients: data ?? [] });
        }
        const [
            { data: clientsRaw, error: clientsError },
            { data: latestAttendants, error: attendantsError },
            { data: stagesRaw, error: stagesError },
            { data: funnels, error: funnelsError },
            { data: directBookings, error: bookingsError },
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
                    unit_id,
                    last_closing_tag,
                    first_seen_at,
                    last_interaction_at,
                    last_origin,
                    last_tunnel,
                    utm_source,
                    utm_medium,
                    utm_campaign,
                    utm_content,
                    utm_term,
                    gclid,
                    gbraid,
                    wbraid,
                    fbclid,
                    fbc,
                    ctwa_clid,
                    tracking_updated_at
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
            supabase
                .from("funnels")
                .select("id, name")
                .order("name", { ascending: true }),
            supabase.from("appointments")
                .select("client_id,thread!inner(channel)")
                .in("thread.channel", ["Instagram", "Messenger"]),
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

        if (bookingsError) {
            return NextResponse.json({ error: "Failed to load Direct bookings" }, { status: 500 });
        }
        const bookingChannels = new Map<string, Set<string>>();
        for (const booking of directBookings ?? []) {
            const thread = Array.isArray(booking.thread) ? booking.thread[0] : booking.thread;
            if (!booking.client_id || !thread?.channel) continue;
            const channels = bookingChannels.get(booking.client_id) ?? new Set<string>();
            channels.add(thread.channel);
            bookingChannels.set(booking.client_id, channels);
        }

        const clientIds = (clientsRaw ?? []).map((client) => client.id);
        const [invoices, whatsappConversations, tintimEvents] = await Promise.all([
            loadClientFilterRows(clientIds, async (ids, from) => {
                const { data, error } = await supabase.from("clinisys_invoices")
                    .select("client_id,status,description")
                    .in("client_id", ids)
                    .order("source_invoice_id")
                    .range(from, from + FILTER_PAGE_SIZE - 1);
                if (error) throw error;
                return data ?? [];
            }),
            loadClientFilterRows(clientIds, async (ids, from) => {
                const { data, error } = await supabase.from("conversations")
                    .select("client_id,started_at,origin")
                    .eq("channel", "WhatsApp")
                    .in("client_id", ids)
                    .order("id")
                    .range(from, from + FILTER_PAGE_SIZE - 1);
                if (error) throw error;
                return data ?? [];
            }),
            loadClientFilterRows(clientIds, async (ids, from) => {
                const { data, error } = await supabase.from("tintim_attribution_events")
                    .select("id,client_id,occurred_at,source,platform")
                    .in("client_id", ids)
                    .order("id")
                    .range(from, from + FILTER_PAGE_SIZE - 1);
                if (error) throw error;
                return data ?? [];
            }),
        ]);

        // Same description and authorization rules used by Jornada, regardless of amount.
        const paidTreatmentIds = new Set(
            invoices.filter((invoice) => invoice.client_id &&
                invoiceStatusIsAuthorized(invoice.status) &&
                journeyInvoiceKind(invoice.description) === "procedure")
                .map((invoice) => invoice.client_id),
        );

        const clientById = new Map((clientsRaw ?? []).map((client) => [client.id, client]));
        const tintimByClient = new Map<string, typeof tintimEvents>();
        for (const event of tintimEvents) {
            if (!event.client_id) continue;
            const events = tintimByClient.get(event.client_id) ?? [];
            events.push(event);
            tintimByClient.set(event.client_id, events);
        }
        const trackedWhatsappIds = new Set<string>();
        for (const conversation of whatsappConversations) {
            const clientId = conversation.client_id;
            if (!clientId || trackedWhatsappIds.has(clientId)) continue;
            const conversationAt = new Date(conversation.started_at).getTime();
            let nearest: (typeof tintimEvents)[number] | null = null;
            let nearestDistance = Infinity;
            for (const event of tintimByClient.get(clientId) ?? []) {
                const distance = Math.abs(new Date(event.occurred_at).getTime() - conversationAt);
                if (distance <= TINTIM_MATCH_MS &&
                    (distance < nearestDistance || (distance === nearestDistance && event.id > (nearest?.id ?? "")))) {
                    nearest = event;
                    nearestDistance = distance;
                }
            }
            if (isTrackedWhatsappConversation({
                conversationOrigin: conversation.origin,
                conversationStartedAt: conversation.started_at,
                client: clientById.get(clientId) ?? null,
                tintimAttribution: nearest,
            })) trackedWhatsappIds.add(clientId);
        }

        const clients = (clientsRaw ?? []).map((client) => ({
            ...client,
            // Existing clients UI consumes this key as "Origem". Its canonical
            // source is now the latest spreadsheet-matched conversation.
            utm_source: client.last_origin ?? null,
            attendant_name: attendantByClientId.get(client.id) ?? null,
            booking_channels: [...(bookingChannels.get(client.id) ?? [])],
            has_paid_treatment: paidTreatmentIds.has(client.id),
            has_tracked_whatsapp: trackedWhatsappIds.has(client.id),
        }));

        if (stagesError || funnelsError) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Failed to load funnel stages",
                    details: stagesError ?? funnelsError,
                },
                { status: 500 },
            );
        }

        const funnelNameById = new Map(
            (funnels ?? []).map((funnel) => [
                funnel.id,
                funnel.name ?? null,
            ]),
        );
        const stages = (stagesRaw ?? []).map((stage) => ({
            ...stage,
            funnel_name: funnelNameById.get(stage.funnel_id) ?? null,
        }));

        return NextResponse.json({
            clients,
            stages,
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
