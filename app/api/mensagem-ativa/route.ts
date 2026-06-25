// app/api/mensagem-ativa/route.ts

import { NextResponse } from "next/server";

import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import { ACTIVE_MESSAGE_TEMPLATES } from "@/lib/active-messages/templates";
import { supabase } from "@/lib/supabase/client";
import type {
    ActiveMessageClient,
    ActiveMessageFunnelStage,
    ActiveMessageSendHistory,
    ActiveMessagesPageResponse,
} from "@/types/activeMessages";

export const dynamic = "force-dynamic";

type ClientApiRow = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    last_interaction_at: string;
    utm_source: string | null;
    last_active_message_sent_at: string | null;
};

export async function GET() {
    const access = await requireActiveMessageAccess();

    if (!access.ok) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    try {
        const [
            clientsResult,
            stagesResult,
            funnelsResult,
            threadsResult,
            historyResult,
        ] = await Promise.all([
                supabase
                    .from("clients")
                    .select(`
                        id,
                        name,
                        phone,
                        email,
                        funnel_stage_id,
                        last_interaction_at,
                        utm_source,
                        last_active_message_sent_at
                    `)
                    .order("last_interaction_at", { ascending: false }),
                supabase
                    .from("funnel_stages")
                    .select("id, funnel_id, name, position, color")
                    .order("position", { ascending: true }),
                supabase
                    .from("funnels")
                    .select("id, name")
                    .order("name", { ascending: true }),
                supabase
                    .from("thread")
                    .select("client_id, last_client_message_at"),
                supabase
                    .from("active_message_sends")
                    .select(`
                        id,
                        template_id,
                        template_name,
                        requested_count,
                        sent_count,
                        failed_count,
                        normal_message_count,
                        template_message_count,
                        status,
                        created_by_name,
                        created_at,
                        completed_at
                    `)
                    .order("created_at", { ascending: false })
                    .limit(50),
            ]);

        const firstError = [
            clientsResult.error,
            stagesResult.error,
            funnelsResult.error,
            threadsResult.error,
            historyResult.error,
        ].find(Boolean);

        if (firstError) {
            throw firstError;
        }

        const lastClientMessageByClientId = new Map<string, string | null>();

        for (const thread of threadsResult.data ?? []) {
            if (!thread.client_id) continue;

            const current = lastClientMessageByClientId.get(thread.client_id);
            const next = thread.last_client_message_at ?? null;

            if (!current || (next && new Date(next) > new Date(current))) {
                lastClientMessageByClientId.set(thread.client_id, next);
            }
        }

        const funnelNameById = new Map(
            (funnelsResult.data ?? []).map((funnel) => [
                funnel.id,
                funnel.name ?? null,
            ]),
        );

        const stages: ActiveMessageFunnelStage[] = (
            stagesResult.data ?? []
        ).map((stage) => ({
            ...stage,
            funnel_name: funnelNameById.get(stage.funnel_id) ?? null,
        }));

        const clients: ActiveMessageClient[] = (clientsResult.data ?? []).map(
            (client: ClientApiRow) => ({
                id: client.id,
                name: client.name ?? null,
                phone: client.phone ?? null,
                email: client.email ?? null,
                funnel_stage_id: client.funnel_stage_id ?? null,
                last_interaction_at: client.last_interaction_at,
                utm_source: client.utm_source ?? null,
                last_client_message_at:
                    lastClientMessageByClientId.get(client.id) ?? null,
                last_active_message_sent_at:
                    client.last_active_message_sent_at ?? null,
            }),
        );

        const response: ActiveMessagesPageResponse = {
            templates: ACTIVE_MESSAGE_TEMPLATES,
            clients,
            stages,
            history: (historyResult.data ?? []) as ActiveMessageSendHistory[],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error("[mensagem-ativa] GET failed", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar a Mensagem Ativa",
            },
            { status: 500 },
        );
    }
}
