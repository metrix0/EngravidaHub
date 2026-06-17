// apps/insights/src/app/api/dashboard/jornada/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@engravida/lib";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const days = Number(searchParams.get("days") ?? 7);

    const customStartDate = searchParams.get("start_date");
    const customEndDate = searchParams.get("end_date");

    const unitIds = parseIds(searchParams.get("unit_ids"));
    const serviceIds = parseIds(searchParams.get("service_ids"));
    const attendantIds = parseIds(searchParams.get("attendant_ids"));
    const tunnelValues = parseIds(searchParams.get("tunnels"));
    const originValues = parseIds(searchParams.get("origins"));

    const dateRange = getDateRange({
        days,
        customStartDate,
        customEndDate,
    });

    const { analyses, error } = await fetchAnalyses({
        dateRange,
        unitIds,
        serviceIds,
        attendantIds,
        tunnelValues,
        originValues,
    });

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }

    return NextResponse.json({
        journey_funnel: buildJourneyFunnel(analyses),
        dropoff_moments: buildDropoffMoments(analyses),
        intent_paths: buildIntentPaths(analyses),
        objections: buildObjections(analyses),
    });
}

async function fetchAnalyses({
                                 dateRange,
                                 unitIds,
                                 serviceIds,
                                 attendantIds,
                                 tunnelValues,
                                 originValues,
                             }: {
    dateRange: {
        start: Date;
        end: Date;
    };
    unitIds: string[];
    serviceIds: string[];
    attendantIds: string[];
    tunnelValues: string[];
    originValues: string[];
}) {
    const needsConversationFilter =
        unitIds.length > 0 || tunnelValues.length > 0 || originValues.length > 0;

    let analysisIdsFromConversations: string[] | null = null;

    if (needsConversationFilter) {
        const conversationMatch = await getAnalysisIdsMatchingConversationFilters({
            dateRange,
            unitIds,
            tunnelValues,
            originValues,
        });

        if (conversationMatch.error) {
            return {
                analyses: [],
                error: conversationMatch.error,
            };
        }

        analysisIdsFromConversations = conversationMatch.analysisIds;

        if (analysisIdsFromConversations.length === 0) {
            return {
                analyses: [],
                error: null,
            };
        }
    }

    let query = supabase
        .from("conversation_analysis")
        .select("*")
        .gte("started_at", dateRange.start.toISOString())
        .lte("started_at", dateRange.end.toISOString());

    if (serviceIds.length > 0) {
        query = query.in("service_id", serviceIds);
    }

    if (attendantIds.length > 0) {
        query = query.in("attendant_id", attendantIds);
    }

    if (analysisIdsFromConversations) {
        query = query.in("id", analysisIdsFromConversations);
    }

    const { data, error } = await query;

    return {
        analyses: data ?? [],
        error,
    };
}

const NULL_FILTER_VALUE = "__NULL__";

async function getAnalysisIdsMatchingConversationFilters({
                                                             dateRange,
                                                             unitIds,
                                                             tunnelValues,
                                                             originValues,
                                                         }: {
    dateRange: {
        start: Date;
        end: Date;
    };
    unitIds: string[];
    tunnelValues: string[];
    originValues: string[];
}) {
    const { data: conversations, error: conversationsError } = await supabase
        .from("conversations")
        .select("conversation_analysis_id, client_id, tunnel, origin, started_at")
        .not("conversation_analysis_id", "is", null)
        .gte("started_at", dateRange.start.toISOString())
        .lte("started_at", dateRange.end.toISOString())
        .limit(10000);

    if (conversationsError) {
        return {
            analysisIds: [],
            error: conversationsError,
        };
    }

    let clientsById = new Map<string, { id: string; unit_id: string | null }>();

    if (unitIds.length > 0) {
        const clientIds = Array.from(
            new Set(
                (conversations ?? [])
                    .map((conversation) => conversation.client_id)
                    .filter(Boolean)
            )
        );

        const clientsResult = await fetchClientsByIds(clientIds);

        if (clientsResult.error) {
            return {
                analysisIds: [],
                error: clientsResult.error,
            };
        }

        clientsById = new Map(
            (clientsResult.data ?? []).map((client) => [client.id, client])
        );
    }

    const filtered = (conversations ?? []).filter((conversation) => {
        const tunnel = emptyToNull(conversation.tunnel);
        const origin = emptyToNull(conversation.origin);

        const matchesUnit =
            unitIds.length === 0 ||
            unitIds.includes(
                clientsById.get(conversation.client_id)?.unit_id ?? ""
            );

        const matchesTunnel =
            tunnelValues.length === 0 ||
            tunnelValues.includes(tunnel ?? NULL_FILTER_VALUE);

        const matchesOrigin =
            originValues.length === 0 ||
            originValues.includes(origin ?? NULL_FILTER_VALUE);

        return matchesUnit && matchesTunnel && matchesOrigin;
    });

    return {
        analysisIds: Array.from(
            new Set(
                filtered
                    .map((conversation) => conversation.conversation_analysis_id)
                    .filter(Boolean)
            )
        ),
        error: null,
    };
}

async function fetchClientsByIds(ids: string[]) {
    const rows: { id: string; unit_id: string | null }[] = [];

    if (ids.length === 0) {
        return { data: rows, error: null };
    }

    for (const batch of chunk(ids, 100)) {
        const { data, error } = await supabase
            .from("clients")
            .select("id, unit_id")
            .in("id", batch);

        if (error) {
            return { data: rows, error };
        }

        rows.push(...(data ?? []));
    }

    return { data: rows, error: null };
}

function emptyToNull(value: unknown) {
    if (value === null || value === undefined) return null;

    const trimmed = String(value).trim();

    return trimmed ? trimmed : null;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

function buildJourneyFunnel(analyses: any[]) {
    const clients = groupAnalysesByClient(analyses);

    const startedClients = clients.filter((clientAnalyses) => {
        return clientAnalyses.length > 0;
    });

    const requestedInformationClients = startedClients.filter((clientAnalyses) =>
        hasClientOutcomeEvent(clientAnalyses, "information_requested")
    );

    const answeredInformationClients = requestedInformationClients.filter((clientAnalyses) =>
        hasClientOutcomeEvent(clientAnalyses, "information_answered")
    );

    const pricePresentedClients = answeredInformationClients.filter((clientAnalyses) =>
        hasClientOutcomeEvent(clientAnalyses, "price_presented")
    );

    const consultationOfferedClients = pricePresentedClients.filter((clientAnalyses) =>
        hasClientOutcomeEvent(clientAnalyses, "consultation_offered")
    );

    const scheduledClients = consultationOfferedClients.filter((clientAnalyses) =>
        clientAnalyses.some((analysis) =>
            ["scheduled", "rescheduled", "confirmed_attendance"].includes(
                analysis.customer_final_state
            )
        ) ||
        hasClientOutcomeEvent(clientAnalyses, "appointment_scheduled") ||
        hasClientOutcomeEvent(clientAnalyses, "appointment_rescheduled")
    );

    const total = startedClients.length;

    const steps = [
        {
            key: "started",
            name: "Iniciou conversa",
            value: startedClients.length,
            fill: "#ddd6fe",
        },
        {
            key: "information_requested",
            name: "Pediu informação",
            value: requestedInformationClients.length,
            fill: "#bbf7d0",
        },
        {
            key: "information_answered",
            name: "Informação respondida",
            value: answeredInformationClients.length,
            fill: "#bfdbfe",
        },
        {
            key: "price_presented",
            name: "Preço apresentado",
            value: pricePresentedClients.length,
            fill: "#c4b5fd",
        },
        {
            key: "consultation_offered",
            name: "Consulta oferecida",
            value: consultationOfferedClients.length,
            fill: "#fed7aa",
        },
        {
            key: "appointment_scheduled",
            name: "Agendamento realizado",
            value: scheduledClients.length,
            fill: "#fbcfe8",
        },
    ];

    return steps.map((step, index) => {
        const previousValue = index === 0 ? total : steps[index - 1].value;

        return {
            ...step,
            percentage: percentage(step.value, total),
            relative_percentage: percentage(step.value, previousValue),
        };
    });
}

function groupAnalysesByClient(analyses: any[]) {
    const map = new Map<string, any[]>();

    for (const analysis of analyses) {
        if (!analysis.client_id) continue;

        const current = map.get(analysis.client_id) ?? [];
        current.push(analysis);
        map.set(analysis.client_id, current);
    }

    return Array.from(map.values());
}

function hasClientOutcomeEvent(clientAnalyses: any[], eventType: string) {
    return clientAnalyses.some((analysis) => {
        const events = Array.isArray(analysis.outcome_events)
            ? analysis.outcome_events
            : [];

        return events.some((event: { type?: string }) => event.type === eventType);
    });
}


function buildDropoffMoments(analyses: any[]) {
    const dropoffs = analyses.filter(
        (item) => item.dropoff_happened && item.dropoff_moment
    );

    const grouped = groupBy(dropoffs, "dropoff_moment");

    return Object.entries(grouped)
        .map(([moment, count]) => ({
            moment,
            label: getDropoffLabel(moment),
            count,
            percentage: percentage(count, dropoffs.length),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
}

function buildIntentPaths(analyses: any[]) {
    const map = new Map<
        string,
        {
            intent: string;
            resolved: number;
            partial: number;
            abandoned: number;
        }
    >();

    for (const item of analyses) {
        const key = item.customer_start_intent ?? "other";

        const current =
            map.get(key) ??
            {
                intent: getIntentLabel(key),
                resolved: 0,
                partial: 0,
                abandoned: 0,
            };

        if (item.dropoff_happened || item.resolution_reasoning_category === "customer_abandoned") {
            current.abandoned += 1;
        } else if (item.resolution_result === "resolved") {
            current.resolved += 1;
        } else {
            current.partial += 1;
        }

        map.set(key, current);
    }

    return Array.from(map.values()).sort(
        (a, b) =>
            b.resolved +
            b.partial +
            b.abandoned -
            (a.resolved + a.partial + a.abandoned)
    );
}

function buildObjections(analyses: any[]) {
    const counts = new Map<string, number>();

    for (const item of analyses) {
        const objections = Array.isArray(item.objections) ? item.objections : [];

        for (const objection of objections) {
            if (!objection?.type) continue;

            counts.set(objection.type, (counts.get(objection.type) ?? 0) + 1);
        }
    }

    const max = Math.max(...Array.from(counts.values()), 0);

    return Array.from(counts.entries())
        .map(([type, value]) => ({
            type,
            label: getObjectionLabel(type),
            value,
            percentage: percentage(value, max),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
}


function percentage(value: number, total: number): number {
    if (total === 0) return 0;

    return Math.round((value / total) * 100);
}

function groupBy(items: any[], key: string): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
        const value = item[key];

        if (!value) return acc;

        acc[value] = (acc[value] ?? 0) + 1;

        return acc;
    }, {});
}

function parseIds(value: string | null): string[] {
    if (!value) return [];

    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function getDateRange({
                          days,
                          customStartDate,
                          customEndDate,
                      }: {
    days: number;
    customStartDate: string | null;
    customEndDate: string | null;
}) {
    if (customStartDate) {
        const start = new Date(`${customStartDate}T00:00:00.000`);
        const end = new Date(`${customEndDate ?? customStartDate}T23:59:59.999`);

        return { start, end };
    }

    const end = new Date();
    const start = new Date();

    start.setDate(start.getDate() - days);

    return { start, end };
}

function getDropoffLabel(moment: string): string {
    const labels: Record<string, string> = {
        after_price: "Após preço",
        after_consultation_online: "Após apresentação da consulta online",
        after_unit_presented: "Após unidade apresentada",
        after_schedule_options: "Após opções de agendamento",
        after_payment_info: "Após informação de pagamento",
        after_medical_question: "Após pergunta médica",
        after_delay: "Após demora no atendimento",
        unknown: "Desconhecido",
    };

    return labels[moment] ?? moment;
}

function getIntentLabel(intent: string): string {
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
        asked_to_think: "Pediu para pensar",
        other: "Outro",
    };

    return labels[intent] ?? intent;
}

function getObjectionLabel(type: string): string {
    const labels: Record<string, string> = {
        price: "Preço",
        distance: "Distância",
        online_consultation: "Consulta online",
        time_availability: "Disponibilidade",
        trust: "Confiança",
        medical_uncertainty: "Incerteza médica",
        partner_or_family: "Parceiro/família",
        already_treating_elsewhere: "Já trata em outro lugar",
        other: "Outro",
    };

    return labels[type] ?? type;
}