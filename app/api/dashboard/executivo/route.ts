// app/api/dashboard/executivo/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import type { ExecutiveDashboardData } from "@/types";

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

    const previousDateRange = getPreviousDateRange(dateRange);

    const {
        analyses,
        error: currentError,
    } = await fetchAnalyses({
        dateRange,
        unitIds,
        serviceIds,
        attendantIds,
        tunnelValues,
        originValues,
    });

    if (currentError) {
        return NextResponse.json(
            { error: currentError.message },
            { status: 500 }
        );
    }

    const {
        analyses: previousAnalyses,
        error: previousError,
    } = await fetchAnalyses({
        dateRange: previousDateRange,
        unitIds,
        serviceIds,
        attendantIds,
        tunnelValues,
        originValues,
    });

    if (previousError) {
        return NextResponse.json(
            { error: previousError.message },
            { status: 500 }
        );
    }

    const response: ExecutiveDashboardData = {
        filters: {
            days,
            start_date: customStartDate,
            end_date: customEndDate,
            unit_ids: unitIds,
            service_ids: serviceIds,
            attendant_ids: attendantIds,
            tunnel_values: tunnelValues,
            origin_values: originValues,
        },

        kpis: buildKpis(analyses),
        previous_kpis: buildKpis(previousAnalyses),

        daily_evolution: buildDailyEvolution(analyses),

        attendance_score: buildAttendanceScore(analyses),

        dropoff_moments: buildDropoffMoments(analyses),

        conversation_goals: buildConversationGoals(analyses),

        by_unit: buildByUnit(analyses),
    };

    return NextResponse.json(response);
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
        .select(`
      *,
      units (
        id,
        name
      ),
      services (
        id,
        name
      ),
      attendants (
        id,
        name
      )
    `)
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

    if (error) {
        return {
            analyses: [],
            error,
        };
    }

    const enriched = await enrichAnalysesWithClientUnits(data ?? []);

    return {
        analyses: enriched.analyses,
        error: enriched.error,
    };
}

function buildKpis(analyses: any[]) {
    const total = analyses.length;

    const resolved = analyses.filter(
        (item) => item.resolution_result === "resolved"
    ).length;

    const satisfied = analyses.filter(
        (item) => item.satisfaction_score >= 70
    ).length;

    const schedulingRelevant = analyses.filter((item) =>
        [
            "schedule_consultation",
            "reschedule_consultation",
            "confirm_attendance",
        ].includes(item.conversation_goal)
    );

    const scheduled = schedulingRelevant.filter((item) =>
        ["scheduled", "rescheduled", "confirmed_attendance"].includes(
            item.customer_final_state
        )
    ).length;

    return {
        conversations_analyzed: total,
        real_resolution_rate: percentage(resolved, total),
        clear_satisfaction_rate: percentage(satisfied, total),
        scheduling_rate: percentage(scheduled, schedulingRelevant.length),
        average_first_human_response_seconds: average(
            analyses
                .map((item) => item.first_human_response_time_seconds)
                .filter((value): value is number => typeof value === "number")
        ),
    };
}

function buildDailyEvolution(analyses: any[]) {
    const map = new Map<
        string,
        {
            date: string;
            total: number;
            resolved: number;
            satisfied: number;
        }
    >();

    for (const item of analyses) {
        const date = formatDateKey(item.started_at);

        const current =
            map.get(date) ??
            {
                date,
                total: 0,
                resolved: 0,
                satisfied: 0,
            };

        current.total += 1;

        if (item.resolution_result === "resolved") current.resolved += 1;
        if (item.satisfaction_score >= 70) current.satisfied += 1;

        map.set(date, current);
    }

    return Array.from(map.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((item) => ({
            date: item.date,
            conversations: item.total,
            resolution_rate: percentage(item.resolved, item.total),
            satisfaction_rate: percentage(item.satisfied, item.total),
        }));
}

function buildAttendanceScore(analyses: any[]) {
    const kpis = buildKpis(analyses);

    const attendantQualityScore =
        average(
            analyses
                .map((item) => item.attendant_quality_score)
                .filter((value): value is number => typeof value === "number")
        ) ?? 0;

    const responseSpeedScore =
        average(
            analyses
                .map((item) => item.response_speed_score)
                .filter((value): value is number => typeof value === "number")
        ) ?? 0;

    const overallScore = average([
        kpis.real_resolution_rate,
        kpis.clear_satisfaction_rate,
        kpis.scheduling_rate,
        responseSpeedScore,
        attendantQualityScore,
    ]) ?? 0;

    return {
        overall_score: overallScore,
        resolution_score: kpis.real_resolution_rate,
        satisfaction_score: kpis.clear_satisfaction_rate,
        response_speed_score: responseSpeedScore,
        attendant_quality_score: attendantQualityScore,
    };
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
        .sort((a, b) => b.count - a.count);
}

function buildConversationGoals(analyses: any[]) {
    const grouped = groupBy(analyses, "conversation_goal");

    return Object.entries(grouped)
        .map(([goal, count]) => ({
            goal,
            label: getGoalLabel(goal),
            count,
            percentage: percentage(count, analyses.length),
        }))
        .sort((a, b) => b.count - a.count);
}

function buildByUnit(analyses: any[]) {
    const map = new Map<
        string,
        {
            unit_id: string | null;
            unit_name: string;
            total: number;
            resolved: number;
            satisfied: number;
            scheduled: number;
        }
    >();

    for (const item of analyses) {
        const unitId = item.unit_id ?? "unknown";
        const unitName = item.units?.name ?? "Sem unidade";

        const current =
            map.get(unitId) ??
            {
                unit_id: item.unit_id,
                unit_name: unitName,
                total: 0,
                resolved: 0,
                satisfied: 0,
                scheduled: 0,
            };

        current.total += 1;

        if (item.resolution_result === "resolved") current.resolved += 1;
        if (item.satisfaction_score >= 70) current.satisfied += 1;

        if (
            ["scheduled", "rescheduled", "confirmed_attendance"].includes(
                item.customer_final_state
            )
        ) {
            current.scheduled += 1;
        }

        map.set(unitId, current);
    }

    return Array.from(map.values()).map((unit) => ({
        unit_id: unit.unit_id,
        unit_name: unit.unit_name,
        conversations: unit.total,
        resolution_rate: percentage(unit.resolved, unit.total),
        satisfaction_rate: percentage(unit.satisfied, unit.total),
        scheduling_rate: percentage(unit.scheduled, unit.total),
    }));
}

function percentage(value: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;

    const total = values.reduce((sum, value) => sum + value, 0);
    return Math.round(total / values.length);
}

function groupBy(items: any[], key: string): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
        const value = item[key];

        if (!value) return acc;

        acc[value] = (acc[value] ?? 0) + 1;

        return acc;
    }, {});
}

function formatDateKey(value: string): string {
    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
    }).format(new Date(value));
}

function getGoalLabel(goal: string): string {
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

function getPreviousDateRange(dateRange: { start: Date; end: Date }) {
    const durationMs = dateRange.end.getTime() - dateRange.start.getTime();

    const previousEnd = new Date(dateRange.start);
    const previousStart = new Date(dateRange.start.getTime() - durationMs);

    return {
        start: previousStart,
        end: previousEnd,
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
    const { data, error } = await supabase
        .from("conversations")
        .select("conversation_analysis_id, client_id, tunnel, origin, started_at")
        .not("conversation_analysis_id", "is", null)
        .gte("started_at", dateRange.start.toISOString())
        .lte("started_at", dateRange.end.toISOString())
        .limit(5000);

    if (error) {
        return {
            analysisIds: [],
            error,
        };
    }

    const conversations = data ?? [];

    const clientUnitMatch = unitIds.length > 0
        ? await fetchClientUnitsByIds(
            Array.from(
                new Set(
                    conversations
                        .map((conversation) => conversation.client_id)
                        .filter(Boolean)
                )
            )
        )
        : {
            clientsById: new Map<string, { unit_id: string | null; unit_name: string | null }>(),
            error: null,
        };

    if (clientUnitMatch.error) {
        return {
            analysisIds: [],
            error: clientUnitMatch.error,
        };
    }

    const filtered = conversations.filter((conversation) => {
        const tunnel = emptyToNull(conversation.tunnel);
        const origin = emptyToNull(conversation.origin);

        const matchesTunnel =
            tunnelValues.length === 0 ||
            tunnelValues.includes(tunnel ?? NULL_FILTER_VALUE);

        const matchesOrigin =
            originValues.length === 0 ||
            originValues.includes(origin ?? NULL_FILTER_VALUE);

        const clientUnit = conversation.client_id
            ? clientUnitMatch.clientsById.get(conversation.client_id)?.unit_id ?? null
            : null;

        const matchesUnit =
            unitIds.length === 0 ||
            Boolean(clientUnit && unitIds.includes(clientUnit));

        return matchesTunnel && matchesOrigin && matchesUnit;
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

async function enrichAnalysesWithClientUnits(analyses: any[]) {
    if (analyses.length === 0) {
        return {
            analyses,
            error: null,
        };
    }

    const analysisIds = analyses.map((analysis) => analysis.id).filter(Boolean);
    const conversationMatch = await fetchConversationsByAnalysisIds(analysisIds);

    if (conversationMatch.error) {
        return {
            analyses,
            error: conversationMatch.error,
        };
    }

    const analysisClientById = new Map(
        conversationMatch.conversations
            .filter((conversation) => conversation.conversation_analysis_id && conversation.client_id)
            .map((conversation) => [conversation.conversation_analysis_id, conversation.client_id])
    );

    const clientUnitMatch = await fetchClientUnitsByIds(
        Array.from(new Set(Array.from(analysisClientById.values()).filter(Boolean)))
    );

    if (clientUnitMatch.error) {
        return {
            analyses,
            error: clientUnitMatch.error,
        };
    }

    return {
        analyses: analyses.map((analysis) => {
            const clientId = analysisClientById.get(analysis.id);
            const clientUnit = clientId
                ? clientUnitMatch.clientsById.get(clientId)
                : null;

            if (!clientUnit?.unit_id) {
                return analysis;
            }

            return {
                ...analysis,
                unit_id: clientUnit.unit_id,
                units: {
                    id: clientUnit.unit_id,
                    name: clientUnit.unit_name ?? "Sem unidade",
                },
            };
        }),
        error: null,
    };
}

async function fetchConversationsByAnalysisIds(analysisIds: string[]) {
    const conversations: Array<{
        conversation_analysis_id: string | null;
        client_id: string | null;
    }> = [];

    if (analysisIds.length === 0) {
        return {
            conversations,
            error: null,
        };
    }

    for (const batch of chunk(analysisIds, 100)) {
        const { data, error } = await supabase
            .from("conversations")
            .select("conversation_analysis_id, client_id")
            .in("conversation_analysis_id", batch);

        if (error) {
            return {
                conversations,
                error,
            };
        }

        conversations.push(...(data ?? []));
    }

    return {
        conversations,
        error: null,
    };
}

async function fetchClientUnitsByIds(clientIds: string[]) {
    const clients: Array<{
        id: string;
        unit_id: string | null;
    }> = [];

    if (clientIds.length === 0) {
        return {
            clientsById: new Map<string, { unit_id: string | null; unit_name: string | null }>(),
            error: null,
        };
    }

    for (const batch of chunk(clientIds, 100)) {
        const { data, error } = await supabase
            .from("clients")
            .select("id, unit_id")
            .in("id", batch);

        if (error) {
            return {
                clientsById: new Map<string, { unit_id: string | null; unit_name: string | null }>(),
                error,
            };
        }

        clients.push(...(data ?? []));
    }

    const unitIds = Array.from(
        new Set(clients.map((client) => client.unit_id).filter(Boolean))
    );

    const unitsById = new Map<string, string>();

    for (const batch of chunk(unitIds, 100)) {
        const { data, error } = await supabase
            .from("units")
            .select("id, name")
            .in("id", batch);

        if (error) {
            return {
                clientsById: new Map<string, { unit_id: string | null; unit_name: string | null }>(),
                error,
            };
        }

        for (const unit of data ?? []) {
            unitsById.set(unit.id, unit.name);
        }
    }

    return {
        clientsById: new Map(
            clients.map((client) => [
                client.id,
                {
                    unit_id: client.unit_id,
                    unit_name: client.unit_id ? unitsById.get(client.unit_id) ?? null : null,
                },
            ])
        ),
        error: null,
    };
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

