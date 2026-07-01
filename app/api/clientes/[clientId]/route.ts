// app/api/clientes/[clientId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib";
import { fetchAppointmentById } from "@/lib/scheduling/appointmentServer";
import {
    buildAppointmentIntegrationPayload,
    sendAppointmentIntegration,
} from "@/lib/scheduling/appointmentAutomation";

type RouteContext = {
    params: Promise<{
        clientId: string;
    }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
    const { clientId } = await params;

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
            cpf,
            birth_date,
            street,
            number,
            complement,
            neighborhood,
            city,
            cep,
            first_seen_at,
            last_interaction_at,
            last_active_message_sent_at,
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
            funnel_stage_id,
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

    const [unit, units, stage, liveThread, conversations, upcomingAppointments] =
        await Promise.all([
            fetchUnit(client.unit_id),
            fetchUnits(),
            fetchStageWithFunnel(client.funnel_stage_id),
            fetchLiveThread(clientId),
            fetchClientConversations(clientId),
            fetchCurrentOrFutureAppointments(clientId),
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
            funnel: stage?.funnel ?? null,
        },
        units,
        upcoming_appointment_count: upcomingAppointments.length,
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

export async function PATCH(request: NextRequest, { params }: RouteContext) {
    const { clientId } = await params;

    if (!clientId) {
        return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = cleanText(body.name);
    if (!name) {
        return NextResponse.json({ error: "Client name is required" }, { status: 400 });
    }

    const address = isRecord(body.address) ? body.address : {};
    const updateUpcomingAppointments = body.updateUpcomingAppointments === true;
    const birthDate = cleanText(body.birthDate);
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        return NextResponse.json({ error: "Invalid birth date" }, { status: 400 });
    }

    const update = {
        name,
        phone: digitsOrNull(body.phone),
        email: cleanText(body.email)?.toLowerCase() ?? null,
        cpf: digitsOrNull(body.cpf),
        birth_date: birthDate,
        unit_id: cleanText(body.unitId),
        street: cleanText(address.street),
        number: cleanText(address.number),
        complement: cleanText(address.complement),
        neighborhood: cleanText(address.neighborhood),
        city: cleanText(address.city),
        state: cleanText(address.state),
        country: cleanText(address.country),
        cep: digitsOrNull(address.cep),
        updated_at: new Date().toISOString(),
    };

    const { data: updatedClient, error } = await supabase
        .from("clients")
        .update(update)
        .eq("id", clientId)
        .select(`
            id,
            name,
            phone,
            email,
            cpf,
            birth_date,
            unit_id,
            street,
            number,
            complement,
            neighborhood,
            city,
            state,
            country,
            cep
        `)
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!updatedClient) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    let updatedAppointmentCount = 0;

    if (updateUpcomingAppointments) {
        const upcomingAppointments = await fetchCurrentOrFutureAppointments(clientId);
        const appointmentIds = upcomingAppointments.map((appointment) => appointment.id);

        if (appointmentIds.length > 0) {
            const { error: appointmentUpdateError } = await supabase
                .from("appointments")
                .update({
                    patient_name: updatedClient.name,
                    patient_phone: updatedClient.phone,
                    patient_email: updatedClient.email,
                    patient_cpf: updatedClient.cpf,
                    patient_birth_date: updatedClient.birth_date,
                    address_street: updatedClient.street,
                    address_number: updatedClient.number,
                    address_complement: updatedClient.complement,
                    address_neighborhood: updatedClient.neighborhood,
                    address_city: updatedClient.city,
                    address_state: updatedClient.state,
                    address_country: updatedClient.country,
                    address_cep: updatedClient.cep,
                    updated_at: new Date().toISOString(),
                })
                .in("id", appointmentIds);

            if (appointmentUpdateError) {
                return NextResponse.json(
                    { error: appointmentUpdateError.message },
                    { status: 500 },
                );
            }

            updatedAppointmentCount = appointmentIds.length;

            for (const appointmentId of appointmentIds) {
                const appointment = await fetchAppointmentById(
                    supabase,
                    appointmentId,
                );

                if (!appointment) continue;

                await sendAppointmentIntegration(
                    buildAppointmentIntegrationPayload(
                        "appointment.updated",
                        appointment,
                    ),
                );
            }
        }
    }

    const unit = await fetchUnit(updatedClient.unit_id);
    return NextResponse.json({
        client: { ...updatedClient, unit },
        updated_appointment_count: updatedAppointmentCount,
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized || null;
}

function digitsOrNull(value: unknown) {
    const normalized = cleanText(value);
    if (!normalized) return null;
    const digits = normalized.replace(/\D/g, "");
    return digits || null;
}

async function fetchCurrentOrFutureAppointments(clientId: string) {
    const { data, error } = await supabase
        .from("appointments")
        .select("id, starts_at, ends_at")
        .eq("client_id", clientId)
        .in("status", ["scheduled", "confirmed"])
        .gte("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

async function fetchUnits() {
    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return data ?? [];
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

async function fetchStageWithFunnel(stageId: string | null) {
    if (!stageId) return null;

    const { data: stage, error: stageError } = await supabase
        .from("funnel_stages")
        .select("id, funnel_id, name, position, color")
        .eq("id", stageId)
        .maybeSingle();

    if (stageError) throw stageError;
    if (!stage) return null;

    const { data: funnel, error: funnelError } = await supabase
        .from("funnels")
        .select("id, name")
        .eq("id", stage.funnel_id)
        .maybeSingle();

    if (funnelError) throw funnelError;

    return {
        stage,
        funnel: funnel ?? null,
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
