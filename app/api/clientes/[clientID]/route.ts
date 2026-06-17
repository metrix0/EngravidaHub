// app/api/clientes/[clientID]/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";

type RouteContext = {
    params: {
        clientId: string;
    };
};

export async function GET(_request: Request, { params }: RouteContext) {
    const clientId = params.clientId;

    if (!clientId) {
        return NextResponse.json(
            { error: "clientId is required" },
            { status: 400 },
        );
    }

    const { data: client, error: clientError } = await supabase
        .from("clients")
        .select(
            `
            id,
            name,
            phone,
            email,
            first_seen_at,
            last_interaction_at,
            created_at,
            updated_at,
            external_contact_id,
            utm_source,
            utm_medium,
            utm_campaign,
            utm_content,
            utm_term,
            state,
            country,
            pipeline_stage_id,
            unit_id,
            notes
            `,
        )
        .eq("id", clientId)
        .maybeSingle();

    if (clientError) {
        return NextResponse.json({ error: clientError.message }, { status: 500 });
    }

    if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [unit, stage, liveThread, conversations] = await Promise.all([
        fetchUnit(client.unit_id),
        fetchStageWithPipeline(client.pipeline_stage_id),
        fetchLiveThread(clientId),
        fetchClientConversations(clientId),
    ]);

    const liveConversationId = liveThread?.latest_conversation_id ?? null;

    const historicalConversations = conversations.filter(
        (conversation) => conversation.id !== liveConversationId,
    );

    const conversationIds = historicalConversations.map((item) => item.id);
    const analysisIds = historicalConversations
        .map((item) => item.conversation_analysis_id)
        .filter(Boolean) as string[];

    const [analysesById, messageCountsByConversationId] = await Promise.all([
        fetchAnalysesById(analysisIds),
        fetchMessageCountsByConversationId(conversationIds),
    ]);

    return NextResponse.json({
        client: {
            ...client,
            unit,
            stage: stage?.stage ?? null,
            pipeline: stage?.pipeline ?? null,
        },
        live_thread: liveThread,
        conversations: historicalConversations.map((conversation) => {
            const analysis = conversation.conversation_analysis_id
                ? analysesById.get(conversation.conversation_analysis_id)
                : null;

            return {
                id: conversation.id,
                source: conversation.source,
                started_at: conversation.started_at,
                ended_at: conversation.ended_at,
                attendant_id: conversation.attendant_id,
                attendant_name: conversation.attendant_chat_name ?? "Sem atendente",
                tunnel: conversation.tunnel,
                origin: conversation.origin,
                conversation_analysis_id: conversation.conversation_analysis_id,
                message_count: messageCountsByConversationId.get(conversation.id) ?? 0,
                objective: analysis
                    ? getGoalLabel(analysis.conversation_goal)
                    : "Sem análise",
                result: getConversationResult(analysis?.resolution_result),
                customer_final_state: analysis?.customer_final_state ?? null,
                notable: Boolean(analysis?.notable),
                satisfaction_score: analysis?.satisfaction_score ?? null,
                dropoff_happened: Boolean(analysis?.dropoff_happened),
                dropoff_moment: analysis?.dropoff_moment ?? null,
            };
        }),
    });
}

async function fetchUnit(unitId: string | null) {
    if (!unitId) return null;

    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .eq("id", unitId)
        .maybeSingle();

    if (error) throw error;

    return data ?? null;
}

async function fetchStageWithPipeline(stageId: string | null) {
    if (!stageId) return null;

    const { data: stage, error: stageError } = await supabase
        .from("pipeline_stages")
        .select("id, pipeline_id, name, position, color")
        .eq("id", stageId)
        .maybeSingle();

    if (stageError) throw stageError;
    if (!stage) return null;

    const { data: pipeline, error: pipelineError } = await supabase
        .from("pipelines")
        .select("id, name")
        .eq("id", stage.pipeline_id)
        .maybeSingle();

    if (pipelineError) throw pipelineError;

    return {
        stage,
        pipeline: pipeline ?? null,
    };
}

async function fetchLiveThread(clientId: string) {
    const { data, error } = await supabase
        .from("thread")
        .select(
            `
            id,
            client_id,
            latest_conversation_id,
            status,
            channel,
            source,
            assigned_attendant_id,
            last_message_text,
            last_message_at,
            unread_count,
            created_at,
            updated_at
            `,
        )
        .eq("client_id", clientId)
        .eq("status", "open")
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;

    return data ?? null;
}

async function fetchClientConversations(clientId: string) {
    const { data, error } = await supabase
        .from("conversations")
        .select(
            `
            id,
            client_id,
            source,
            started_at,
            ended_at,
            attendant_id,
            attendant_chat_name,
            unit_id,
            service_id,
            conversation_analysis_id,
            tunnel,
            origin,
            created_at,
            updated_at
            `,
        )
        .eq("client_id", clientId)
        .order("started_at", { ascending: false })
        .limit(100);

    if (error) throw error;

    return data ?? [];
}

async function fetchAnalysesById(ids: string[]) {
    const map = new Map<string, any>();

    if (ids.length === 0) return map;

    for (const batch of chunk(ids, 100)) {
        const { data, error } = await supabase
            .from("conversation_analysis")
            .select(
                `
                id,
                conversation_goal,
                resolution_result,
                customer_final_state,
                satisfaction_score,
                dropoff_happened,
                dropoff_moment,
                notable
                `,
            )
            .in("id", batch);

        if (error) throw error;

        for (const analysis of data ?? []) {
            map.set(analysis.id, analysis);
        }
    }

    return map;
}

async function fetchMessageCountsByConversationId(ids: string[]) {
    const map = new Map<string, number>();

    if (ids.length === 0) return map;

    for (const batch of chunk(ids, 100)) {
        const { data, error } = await supabase
            .from("messages")
            .select("conversation_id")
            .in("conversation_id", batch);

        if (error) throw error;

        for (const message of data ?? []) {
            if (!message.conversation_id) continue;

            map.set(
                message.conversation_id,
                (map.get(message.conversation_id) ?? 0) + 1,
            );
        }
    }

    return map;
}

function getConversationResult(value: string | null | undefined) {
    if (value === "resolved") return "resolvida";
    if (value === "partial") return "parcial";
    if (value === "not_resolved") return "nao_resolvida";

    return "pendente";
}

function getGoalLabel(goal: string | null | undefined): string {
    if (!goal) return "Sem análise";

    const labels: Record<string, string> = {
        answer_information: "Informação",
        schedule_consultation: "Agendar consulta",
        reschedule_consultation: "Reagendar",
        confirm_attendance: "Confirmar presença",
        recover_inactive_lead: "Recuperar lead",
        explain_treatment: "Explicar tratamento",
        handle_price_objection: "Objeção de preço",
        collect_documents_or_exams: "Documentos/exames",
        post_consultation_followup: "Pós-consulta",
        other: "Outro",
    };

    return labels[goal] ?? goal;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}
