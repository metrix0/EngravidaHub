// lib/ai/assistantAdvancedDataTools.ts
import { supabase } from "@/lib";
import {
    matchMediaBudgetCity,
    normalizeCampaignMatchText,
} from "@/lib/ads/mediaBudgetByCity";
import {
    getScheduleStatusLabel,
    normalizeScheduleStatus,
    resolveScheduleStatusFilters,
} from "@/lib/schedules/status";
import {
    applyAssistantUnitScope,
    type AssistantToolContext,
    unitRestrictedToolOutput,
} from "@/lib/ai/assistantToolContext";
import type { AssistantCard } from "@/types/assistant";

type JsonRecord = Record<string, unknown>;

type ToolExecution = {
    output: unknown;
    cards: AssistantCard[];
};

type ConversationRow = {
    id: string;
    client_id: string | null;
    conversation_analysis_id: string | null;
    channel: string | null;
    started_at: string;
    ended_at: string | null;
    attendant_chat_name: string | null;
    last_message_text: string | null;
};

type ClientRow = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
    first_seen_at: string | null;
    last_interaction_at: string | null;
    units: { name: string | null } | Array<{ name: string | null }> | null;
};

type AnalysisRow = {
    id: string;
    conversation_id: string | null;
    conversation_goal: string | null;
    goal_status: string | null;
    customer_final_state: string | null;
    resolution_result: string | null;
    dropoff_happened: boolean | null;
    dropoff_likely_reason: string | null;
    objections: unknown;
    short_label: string | null;
};

type MessageRow = {
    conversation_id: string;
    sender_type: string | null;
    sender_name: string | null;
    text: string | null;
    sent_at: string;
};

type ScheduleRow = {
    id: string;
    client_id: string | null;
    scheduled_for: string;
    created_in_source_at: string | null;
    patient_name: string | null;
    phone: string | null;
    unit_name: string | null;
    attendant_name: string | null;
    procedure_name: string | null;
    status: string | null;
};

type AttributionRow = {
    instagram_user_id: string;
    channel: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    ad_set_id: string | null;
    ad_set_name: string | null;
    ad_name: string | null;
    enrichment_status: string | null;
    referral_received_at: string;
};

type InstagramUserRow = {
    id: string;
    display_name: string | null;
    username: string | null;
    location: string | null;
};

const ADVANCED_TOOL_NAMES = new Set([
    "search_conversation_content",
    "get_cancellation_analysis",
    "get_meta_attribution_overview",
    "create_csv_export",
]);
const PAGE_SIZE = 1_000;
const MAX_CONVERSATION_CANDIDATES = 3_000;
const MAX_CANCELLATION_ROWS = 10_000;
const MAX_ATTRIBUTION_ROWS = 25_000;
const MAX_EXPORT_ROWS = 5_000;
const TIME_ZONE = "America/Sao_Paulo";
const SEARCH_STOP_WORDS = new Set([
    "a",
    "as",
    "ao",
    "aos",
    "de",
    "da",
    "das",
    "do",
    "dos",
    "e",
    "com",
    "em",
    "na",
    "nas",
    "no",
    "nos",
    "nao",
    "o",
    "os",
    "para",
    "por",
    "que",
    "se",
    "sem",
    "sim",
    "um",
    "uma",
]);
const CANCELLATION_WORDS = [
    "cancelar",
    "cancelamento",
    "desmarcar",
    "desmarcou",
    "remarcar",
    "remarcacao",
    "remarcou",
];

export function isAssistantAdvancedDataTool(name: string) {
    return ADVANCED_TOOL_NAMES.has(name);
}

export async function executeAssistantAdvancedDataTool(
    name: string,
    rawArguments: unknown,
    context: AssistantToolContext,
): Promise<ToolExecution> {
    const args = applyAssistantUnitScope(
        isRecord(rawArguments) ? rawArguments : {},
        context,
    );

    switch (name) {
        case "search_conversation_content":
            return searchConversationContent(args, context);
        case "get_cancellation_analysis":
            return getCancellationAnalysis(args, context);
        case "get_meta_attribution_overview":
            if (context.unitLock) {
                return unitRestrictedToolOutput(
                    context,
                    "A atribuição Meta por campanha",
                );
            }
            return getMetaAttributionOverview(args);
        case "create_csv_export":
            return createCsvExport(args, context);
        default:
            return {
                output: { ok: false, error: `Unknown advanced tool: ${name}` },
                cards: [],
            };
    }
}

async function searchConversationContent(
    args: JsonRecord,
    context: AssistantToolContext,
): Promise<ToolExecution> {
    const queryText = stringArg(args, "query");
    const channel = stringArg(args, "channel") ?? "all";
    const dateFrom = validDateArg(args, "date_from");
    const dateTo = validDateArg(args, "date_to");
    const unitName = stringArg(args, "unit_name");
    const matchMode = stringArg(args, "match_mode") ?? "all";
    const exactPhrase = booleanArg(args, "exact_phrase", false);
    const limit = integerArg(args, "limit", 20, 1, 50);

    if (!queryText || queryText.length < 2) {
        return {
            output: {
                ok: false,
                error: "Informe pelo menos 2 caracteres para pesquisar nas conversas.",
            },
            cards: [],
        };
    }

    const normalizedQuery = normalizeSearchText(queryText);
    const terms = unique(
        normalizedQuery
            .split(" ")
            .filter(
                (term) =>
                    term.length >= 2 && !SEARCH_STOP_WORDS.has(term),
            ),
    ).slice(0, 6);

    if (terms.length === 0) {
        return {
            output: {
                ok: false,
                error: "A pesquisa precisa conter ao menos uma palavra relevante.",
            },
            cards: [],
        };
    }

    const requestedUnit = context.unitLock
        ? context.unitLock
        : unitName
          ? await resolveSingleUnit(unitName)
          : null;

    if (unitName && !requestedUnit) {
        return {
            output: {
                ok: true,
                matches: [],
                note: `Unidade “${unitName}” não encontrada.`,
            },
            cards: [],
        };
    }

    const candidates = await loadFilteredConversationCandidates({
        terms,
        matchMode,
        channel,
        dateFrom,
        dateTo,
        unitId: requestedUnit?.id ?? null,
        exactPhrase: exactPhrase ? queryText : null,
        limit: MAX_CONVERSATION_CANDIDATES,
    });
    const candidateIds = candidates.map((row) => row.conversation_id);

    const conversationRows = await loadConversationsByIds(candidateIds, {
        channel,
        dateFrom,
        dateTo,
        unitId: requestedUnit?.id ?? null,
    });
    const clientIds = unique(
        conversationRows
            .map((row) => row.client_id)
            .filter((value): value is string => Boolean(value)),
    );
    const analysisIds = unique(
        conversationRows
            .map((row) => row.conversation_analysis_id)
            .filter((value): value is string => Boolean(value)),
    );
    const [clients, analyses] = await Promise.all([
        loadClients(clientIds, requestedUnit?.id ?? null),
        loadAnalyses(analysisIds),
    ]);

    const filteredRows = conversationRows
        .filter((row) => {
            if (!unitName) return true;
            const client = row.client_id ? clients.get(row.client_id) : null;
            return normalizeSearchText(relationOne(client?.units)?.name).includes(
                normalizeSearchText(unitName),
            );
        })
        .sort((first, second) => second.started_at.localeCompare(first.started_at));

    const inspectedRows = filteredRows.slice(0, limit);
    const messagesByConversation = await loadMessagesForConversations(
        inspectedRows.map((row) => row.id),
    );
    const results: Array<Record<string, unknown>> = [];

    for (const row of inspectedRows) {
        const messages = messagesByConversation.get(row.id) ?? [];
        const snippets = matchingSnippets(
            messages,
            normalizedQuery,
            terms,
            exactPhrase,
        );
        if (exactPhrase && snippets.length === 0) continue;

        const client = row.client_id ? clients.get(row.client_id) : null;
        const analysis = row.conversation_analysis_id
            ? analyses.get(row.conversation_analysis_id)
            : null;

        results.push({
            conversation_id: row.id,
            client_name: client?.name ?? "Cliente sem nome",
            unit_name: relationOne(client?.units)?.name ?? null,
            channel: row.channel,
            started_at: row.started_at,
            attendant_name: row.attendant_chat_name,
            short_label: analysis?.short_label ?? null,
            customer_final_state: analysis?.customer_final_state ?? null,
            resolution_result: analysis?.resolution_result ?? null,
            snippets:
                snippets.length > 0
                    ? snippets
                    : [truncate(row.last_message_text ?? "", 280)].filter(Boolean),
        });

        if (results.length >= limit) break;
    }

    const indexCapped = candidates.length >= MAX_CONVERSATION_CANDIDATES;

    return {
        output: {
            ok: true,
            query: queryText,
            normalized_terms: terms,
            filters: {
                channel,
                date_from: dateFrom,
                date_to: dateTo,
                unit_name: unitName,
                match_mode: matchMode,
                exact_phrase: exactPhrase,
            },
            matches: results,
            matches_returned: results.length,
            indexed_candidates_after_filters: candidates.length,
            coverage: {
                source: "Índice canônico de palavras das conversas e mensagens originais do Hub",
                candidate_limit: MAX_CONVERSATION_CANDIDATES,
                index_capped: indexCapped,
                exact_phrase_verified_in_transcript: exactPhrase,
                note: indexCapped
                    ? "A pesquisa atingiu o limite depois de aplicar período, canal e unidade. Refine os filtros para garantir cobertura total."
                    : "Período, canal, unidade e frase exata foram aplicados antes do limite de candidatos.",
            },
        },
        cards: [],
    };
}

async function getCancellationAnalysis(
    args: JsonRecord,
    context: AssistantToolContext,
): Promise<ToolExecution> {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const unitName = stringArg(args, "unit_name");
    const procedureType = stringArg(args, "procedure_type") ?? "all";
    const includeEvidence = booleanArg(args, "include_evidence", true);
    const evidenceLimit = integerArg(args, "evidence_limit", 12, 1, 25);
    const schedules = await loadCancellationSchedules(
        dateFrom,
        dateTo,
        unitName,
        Boolean(context.unitLock),
    );
    const filteredSchedules = schedules.rows.filter((schedule) =>
        procedureType === "first_evaluation"
            ? isFirstEvaluation(schedule.procedure_name)
            : true,
    );
    const groupedStatus = countRows(
        filteredSchedules,
        (row) => getScheduleStatusLabel(normalizeScheduleStatus(row.status)),
    );
    const groupedUnit = countRows(
        filteredSchedules,
        (row) => row.unit_name?.trim() || "Sem unidade",
    );
    const groupedProcedure = countRows(
        filteredSchedules,
        (row) => row.procedure_name?.trim() || "Sem procedimento",
    ).slice(0, 12);
    const clientIds = unique(
        filteredSchedules
            .map((row) => row.client_id)
            .filter((value): value is string => Boolean(value)),
    );

    const evidence: Array<Record<string, unknown>> = [];
    let linkedConversationCount = 0;

    if (includeEvidence && clientIds.length > 0) {
        const conversations = await loadClientConversations(
            clientIds,
            addDays(dateFrom, -60),
            addDays(dateTo, 2),
            context.unitLock?.id ?? null,
        );
        linkedConversationCount = conversations.length;
        const candidateConversationIds = await loadCancellationConversationIds(
            new Set(conversations.map((row) => row.id)),
            addDays(dateFrom, -60),
            addDays(dateTo, 2),
            context.unitLock?.id ?? null,
        );
        const candidateRows = conversations.filter((row) =>
            candidateConversationIds.has(row.id),
        );
        const messagesByConversation = await loadMessagesForConversations(
            candidateRows.slice(0, Math.max(evidenceLimit * 4, 40)).map((row) => row.id),
        );
        const schedulesByClient = groupBy(
            filteredSchedules.filter(
                (row): row is ScheduleRow & { client_id: string } =>
                    Boolean(row.client_id),
            ),
            (row) => row.client_id,
        );

        for (const conversation of candidateRows) {
            if (!conversation.client_id) continue;
            const messages = messagesByConversation.get(conversation.id) ?? [];
            const excerpt = cancellationExcerpt(messages);
            if (!excerpt) continue;
            const nearestSchedule = nearestScheduleForConversation(
                schedulesByClient.get(conversation.client_id) ?? [],
                conversation.started_at,
            );
            if (!nearestSchedule) continue;
            const reason = classifyCancellationEvidence(excerpt);

            evidence.push({
                conversation_id: conversation.id,
                patient_name: nearestSchedule.patient_name ?? "Paciente sem nome",
                unit_name: nearestSchedule.unit_name,
                scheduled_for: nearestSchedule.scheduled_for,
                schedule_status: getScheduleStatusLabel(
                    normalizeScheduleStatus(nearestSchedule.status),
                ),
                procedure_name: nearestSchedule.procedure_name,
                conversation_started_at: conversation.started_at,
                evidence_category: reason,
                excerpt,
            });

            if (evidence.length >= evidenceLimit) break;
        }
    }

    const evidenceReasons = countRows(
        evidence,
        (row) => String(row.evidence_category ?? "Motivo não classificado"),
    );

    return {
        output: {
            ok: true,
            period: { date_from: dateFrom, date_to: dateTo, timezone: TIME_ZONE },
            filters: { unit_name: unitName, procedure_type: procedureType },
            totals: {
                cancelled_or_rescheduled: filteredSchedules.length,
                cancelled: filteredSchedules.filter(
                    (row) => normalizeScheduleStatus(row.status) === "cancelled",
                ).length,
                rescheduled: filteredSchedules.filter(
                    (row) => normalizeScheduleStatus(row.status) === "rescheduled",
                ).length,
                with_linked_client: clientIds.length,
            },
            by_status: groupedStatus,
            by_unit: groupedUnit,
            by_procedure: groupedProcedure,
            conversation_evidence: {
                linked_conversations_scanned: linkedConversationCount,
                examples: evidence,
                examples_returned: evidence.length,
                explicit_reason_categories: evidenceReasons,
                method:
                    "Cruza pacientes cancelados/remarcados com conversas de WhatsApp e só apresenta motivo quando há texto explícito de cancelamento, desmarcação ou remarcação. A proximidade usa a data da conversa e a data marcada porque a agenda não possui data própria do cancelamento.",
            },
            coverage: {
                schedule_rows_read: schedules.rows.length,
                schedule_rows_capped: schedules.capped,
                evidence_is_not_a_reason_for_every_schedule: true,
                note: "O status da agenda informa que houve cancelamento ou remarcação, mas não armazena o motivo. Motivos sem evidência textual permanecem desconhecidos.",
            },
        },
        cards: [],
    };
}

async function getMetaAttributionOverview(
    args: JsonRecord,
): Promise<ToolExecution> {
    const requestedFrom = validDateArg(args, "date_from") ?? dateDaysAgo(30);
    const requestedTo = validDateArg(args, "date_to") ?? todayInBrazil();
    const dateFrom = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
    const dateTo = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
    const channel = stringArg(args, "channel") ?? "all";
    const campaignQuery = normalizeSearchText(stringArg(args, "campaign_query"));
    const adSetQuery = normalizeSearchText(stringArg(args, "ad_set_query"));
    const cityArg = stringArg(args, "city");
    const cityQuery = cityArg
        ? (matchMediaBudgetCity(cityArg)?.key ??
          normalizeCampaignMatchText(cityArg))
        : "";
    const loaded = await loadAttributions(dateFrom, dateTo);
    const filtered = loaded.rows.filter((row) => {
        if (channel !== "all" && row.channel !== channel) return false;
        if (
            campaignQuery &&
            !normalizeSearchText(row.campaign_name).includes(campaignQuery)
        ) {
            return false;
        }
        if (
            adSetQuery &&
            !normalizeSearchText(row.ad_set_name).includes(adSetQuery)
        ) {
            return false;
        }
        const expectedCity = expectedAttributionCity(row);
        if (
            cityQuery &&
            (expectedCity?.key ??
                normalizeCampaignMatchText(expectedCity?.city)) !== cityQuery
        ) {
            return false;
        }
        return true;
    });
    const latestByUser = new Map<string, AttributionRow>();

    for (const row of filtered) {
        const current = latestByUser.get(row.instagram_user_id);
        if (!current || row.referral_received_at > current.referral_received_at) {
            latestByUser.set(row.instagram_user_id, row);
        }
    }

    const users = await loadInstagramUsers([...latestByUser.keys()]);
    const latestRows = [...latestByUser.values()];
    const cityChecks = latestRows.map((row) => {
        const expected = expectedAttributionCity(row);
        const user = users.get(row.instagram_user_id);
        const actual = user?.location?.trim() || null;
        const expectedName = expected?.city ?? null;

        return {
            profile_name: user?.display_name ?? user?.username ?? "Perfil sem nome",
            campaign_name: row.campaign_name,
            ad_set_name: row.ad_set_name,
            expected_city: expectedName,
            actual_location: actual,
            matches:
                expectedName === null
                    ? null
                    : normalizeCampaignMatchText(actual) ===
                      normalizeCampaignMatchText(expectedName),
            referral_received_at: row.referral_received_at,
        };
    });
    const expectedRows = cityChecks.filter((row) => row.expected_city);

    return {
        output: {
            ok: true,
            period: { date_from: dateFrom, date_to: dateTo, timezone: TIME_ZONE },
            filters: {
                channel,
                campaign_query: stringArg(args, "campaign_query"),
                ad_set_query: stringArg(args, "ad_set_query"),
                city: stringArg(args, "city"),
            },
            attribution: {
                events: filtered.length,
                unique_profiles_with_attribution: latestRows.length,
                events_with_campaign_name: filtered.filter((row) => row.campaign_name?.trim()).length,
                events_with_ad_set_name: filtered.filter((row) => row.ad_set_name?.trim()).length,
                enrichment_status: countRows(
                    filtered,
                    (row) => row.enrichment_status?.trim() || "Sem status",
                ),
                latest_referral_received_at:
                    filtered
                        .map((row) => row.referral_received_at)
                        .sort()
                        .at(-1) ?? null,
            },
            campaigns: countRows(
                filtered.filter((row) => row.campaign_name?.trim()),
                (row) => row.campaign_name!.trim(),
            ).slice(0, 20),
            ad_sets: countRows(
                filtered.filter((row) => row.ad_set_name?.trim()),
                (row) => row.ad_set_name!.trim(),
            ).slice(0, 20),
            location_resolution: {
                profiles_with_mapped_city_in_ad_names: expectedRows.length,
                matching_location: expectedRows.filter((row) => row.matches === true).length,
                missing_location: expectedRows.filter((row) => !row.actual_location).length,
                mismatching_location: expectedRows.filter(
                    (row) => row.actual_location && row.matches === false,
                ).length,
                by_expected_city: countRows(
                    expectedRows,
                    (row) => row.expected_city ?? "Sem cidade",
                ),
                recent_examples: cityChecks
                    .filter((row) => row.expected_city)
                    .sort((first, second) =>
                        second.referral_received_at.localeCompare(
                            first.referral_received_at,
                        ),
                    )
                    .slice(0, 12),
                rule:
                    "Usa primeiro o nome do conjunto e depois o nome da campanha, com o mesmo mapa de cidades do Financeiro.",
            },
            coverage: {
                rows_read: loaded.rows.length,
                capped: loaded.capped,
                source:
                    "Atribuições reais recebidas do Zernio/Meta e localização atual dos perfis sociais no Hub.",
            },
        },
        cards: [],
    };
}

async function createCsvExport(
    args: JsonRecord,
    context: AssistantToolContext,
): Promise<ToolExecution> {
    const dataset = stringArg(args, "dataset") ?? "conversations";
    const requestedLimit = integerArg(args, "limit", 1_000, 1, MAX_EXPORT_ROWS);
    const dateFrom = validDateArg(args, "date_from");
    const dateTo = validDateArg(args, "date_to");
    const unitName = stringArg(args, "unit_name");
    const queryText = stringArg(args, "query");
    const channel = stringArg(args, "channel") ?? "all";
    const statuses = stringArrayArg(args, "statuses");
    const nonScheduledOnly = booleanArg(args, "non_scheduled_only", false);
    const requestedUnit = context.unitLock
        ? context.unitLock
        : unitName
          ? await resolveSingleUnit(unitName)
          : null;
    let rows: Array<Record<string, unknown>>;
    let columns: string[];

    if (unitName && !requestedUnit) {
        rows = [];
        columns =
            dataset === "schedules"
                ? Object.keys(scheduleExportColumns())
                : dataset === "clients"
                  ? Object.keys(clientExportColumns())
                  : Object.keys(conversationExportColumns());
    } else if (dataset === "schedules") {
        const exported = await exportSchedules({
            dateFrom,
            dateTo,
            unitName: requestedUnit?.name ?? unitName,
            exactUnitName: Boolean(requestedUnit),
            queryText,
            statuses,
            limit: requestedLimit,
        });
        rows = exported.rows;
        columns = exported.columns;
    } else if (dataset === "clients") {
        const exported = await exportClients({
            unitId: requestedUnit?.id ?? null,
            queryText,
            limit: requestedLimit,
        });
        rows = exported.rows;
        columns = exported.columns;
    } else {
        const exported = await exportConversations({
            dateFrom,
            dateTo,
            unitId: requestedUnit?.id ?? null,
            queryText,
            channel,
            nonScheduledOnly,
            limit: requestedLimit,
        });
        rows = exported.rows;
        columns = exported.columns;
    }

    const safeDataset = ["schedules", "clients"].includes(dataset)
        ? dataset
        : "conversations";
    const dateSuffix = todayInBrazil();
    const fileName = `assistente-${safeDataset}-${dateSuffix}.csv`;
    const csv = toCsv(columns, rows);
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data, error } = await supabase
        .from("assistant_exports")
        .insert({
            auth_user_id: context.authUserId,
            session_id: context.sessionId,
            file_name: fileName,
            mime_type: "text/csv; charset=utf-8",
            content: csv,
            row_count: rows.length,
            expires_at: expiresAt,
        })
        .select("id")
        .single();

    if (error || !data) {
        throw new Error(
            `Falha ao preparar o CSV: ${error?.message ?? "arquivo não criado"}`,
        );
    }

    const card: AssistantCard = {
        type: "export",
        data: {
            id: data.id,
            file_name: fileName,
            row_count: rows.length,
            expires_at: expiresAt,
        },
    };

    return {
        output: {
            ok: true,
            download_ready: true,
            file_name: fileName,
            row_count: rows.length,
            expires_at: expiresAt,
            note:
                rows.length >= requestedLimit
                    ? `O arquivo atingiu o limite solicitado de ${requestedLimit.toLocaleString("pt-BR")} linhas.`
                    : "O arquivo contém todos os registros encontrados pelos filtros.",
        },
        cards: [card],
    };
}

async function exportSchedules({
    dateFrom,
    dateTo,
    unitName,
    exactUnitName,
    queryText,
    statuses,
    limit,
}: {
    dateFrom: string | null;
    dateTo: string | null;
    unitName: string | null;
    exactUnitName: boolean;
    queryText: string | null;
    statuses: string[];
    limit: number;
}) {
    let query = supabase
        .from("schedules")
        .select(
            "scheduled_for, patient_name, phone, unit_name, attendant_name, procedure_name, status",
        )
        .order("scheduled_for", { ascending: false })
        .limit(limit);
    if (dateFrom) query = query.gte("scheduled_for", dateFrom);
    if (dateTo) query = query.lte("scheduled_for", dateTo);
    if (unitName) {
        query = query.ilike(
            "unit_name",
            exactUnitName
                ? sanitizeFilter(unitName)
                : `%${sanitizeFilter(unitName)}%`,
        );
    }
    const rawStatuses = resolveScheduleStatusFilters(statuses);
    if (rawStatuses.length > 0) query = query.in("status", rawStatuses);
    if (queryText) {
        const safe = sanitizeFilter(queryText);
        query = query.or(
            `patient_name.ilike.%${safe}%,phone.ilike.%${safe}%,procedure_name.ilike.%${safe}%`,
        );
    }

    const { data, error } = await query;
    if (error) throw new Error(`Falha ao exportar agenda: ${error.message}`);

    const rows = (data ?? []).map((row) => ({
        Data: row.scheduled_for,
        Paciente: row.patient_name,
        Telefone: row.phone,
        Unidade: row.unit_name,
        Atendente: row.attendant_name,
        Procedimento: row.procedure_name,
        Situação: getScheduleStatusLabel(normalizeScheduleStatus(row.status)),
    }));
    return { rows, columns: Object.keys(rows[0] ?? scheduleExportColumns()) };
}

async function exportClients({
    unitId,
    queryText,
    limit,
}: {
    unitId: string | null;
    queryText: string | null;
    limit: number;
}) {
    let query = supabase
        .from("clients")
        .select(
            "id, name, phone, email, city, state, first_seen_at, last_interaction_at, units(name)",
        )
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .limit(limit);
    if (unitId) query = query.eq("unit_id", unitId);
    if (queryText) {
        const safe = sanitizeFilter(queryText);
        query = query.or(
            `name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`,
        );
    }
    const { data, error } = await query;
    if (error) throw new Error(`Falha ao exportar clientes: ${error.message}`);

    const rows = ((data ?? []) as unknown as ClientRow[]).map((row) => ({
            Nome: row.name,
            Telefone: row.phone,
            Email: row.email,
            Unidade: relationOne(row.units)?.name ?? null,
            Cidade: row.city,
            Estado: row.state,
            "Primeiro contato": row.first_seen_at,
            "Última interação": row.last_interaction_at,
        }));
    return { rows, columns: Object.keys(rows[0] ?? clientExportColumns()) };
}

async function exportConversations({
    dateFrom,
    dateTo,
    unitId,
    queryText,
    channel,
    nonScheduledOnly,
    limit,
}: {
    dateFrom: string | null;
    dateTo: string | null;
    unitId: string | null;
    queryText: string | null;
    channel: string;
    nonScheduledOnly: boolean;
    limit: number;
}) {
    const { data, error } = await supabase.rpc(
        "assistant_export_conversations",
        {
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_unit_id: unitId,
            p_query: queryText,
            p_channel: channel === "all" ? null : channel,
            p_non_scheduled_only: nonScheduledOnly,
            p_limit: Math.min(MAX_EXPORT_ROWS, limit),
        },
    );
    if (error) throw new Error(`Falha ao exportar conversas: ${error.message}`);
    const rows = ((data ?? []) as Array<{
        client_name: string | null;
        unit_name: string | null;
        channel: string | null;
        started_at: string;
        ended_at: string | null;
        attendant_name: string | null;
        conversation_goal: string | null;
        goal_status: string | null;
        customer_final_state: string | null;
        resolution_result: string | null;
        dropoff_happened: boolean | null;
        dropoff_likely_reason: string | null;
        short_label: string | null;
    }>).map((conversation) => {
            return {
                Cliente: conversation.client_name ?? "Cliente sem nome",
                Unidade: conversation.unit_name,
                Canal: conversation.channel,
                Início: conversation.started_at,
                Término: conversation.ended_at,
                Atendente: conversation.attendant_name,
                Objetivo: conversation.conversation_goal,
                "Resultado do objetivo": conversation.goal_status,
                "Situação final": conversation.customer_final_state,
                Resolução: conversation.resolution_result,
                Abandono: conversation.dropoff_happened,
                "Motivo provável": conversation.dropoff_likely_reason,
                Resumo: conversation.short_label,
            };
        });
    return { rows, columns: Object.keys(rows[0] ?? conversationExportColumns()) };
}

async function loadFilteredConversationCandidates({
    terms,
    matchMode,
    channel,
    dateFrom,
    dateTo,
    unitId,
    exactPhrase,
    limit,
}: {
    terms: string[];
    matchMode: string;
    channel: string;
    dateFrom: string | null;
    dateTo: string | null;
    unitId: string | null;
    exactPhrase: string | null;
    limit: number;
}) {
    const { data, error } = await supabase.rpc(
        "assistant_search_conversation_candidates",
        {
            p_terms: terms,
            p_match_mode: matchMode === "any" ? "any" : "all",
            p_channel: channel === "all" ? null : channel,
            p_date_from: dateFrom,
            p_date_to: dateTo,
            p_unit_id: unitId,
            p_exact_phrase: exactPhrase,
            p_limit: limit,
        },
    );

    if (error) {
        throw new Error(`Falha ao pesquisar conversas: ${error.message}`);
    }

    return (data ?? []) as Array<{
        conversation_id: string;
        mentions: number | string;
    }>;
}

async function loadConversationsByIds(
    ids: string[],
    filters: {
        channel: string;
        dateFrom: string | null;
        dateTo: string | null;
        unitId: string | null;
    },
) {
    const rows: ConversationRow[] = [];
    for (const idChunk of chunk(ids, 100)) {
        let query = supabase
            .from("conversations")
            .select(
                "id, client_id, conversation_analysis_id, channel, started_at, ended_at, attendant_chat_name, last_message_text",
            )
            .in("id", idChunk);
        if (filters.channel !== "all") query = query.eq("channel", filters.channel);
        if (filters.dateFrom) {
            query = query.gte("started_at", brazilDayBoundary(filters.dateFrom));
        }
        if (filters.dateTo) {
            query = query.lt(
                "started_at",
                brazilDayBoundary(addDays(filters.dateTo, 1)),
            );
        }
        const { data, error } = await query;
        if (error) throw new Error(`Falha ao carregar conversas: ${error.message}`);
        rows.push(...((data ?? []) as ConversationRow[]));
    }
    return rows;
}

async function loadClients(ids: string[], unitId: string | null = null) {
    const result = new Map<string, ClientRow>();
    for (const idChunk of chunk(ids, 100)) {
        let query = supabase
            .from("clients")
            .select(
                "id, name, phone, email, city, state, first_seen_at, last_interaction_at, units(name)",
            )
            .in("id", idChunk);
        if (unitId) query = query.eq("unit_id", unitId);
        const { data, error } = await query;
        if (error) throw new Error(`Falha ao carregar clientes: ${error.message}`);
        for (const row of (data ?? []) as unknown as ClientRow[]) {
            result.set(row.id, row);
        }
    }
    return result;
}

async function loadAnalyses(ids: string[]) {
    const result = new Map<string, AnalysisRow>();
    for (const idChunk of chunk(ids, 100)) {
        const { data, error } = await supabase
            .from("conversation_analysis")
            .select(
                "id, conversation_id, conversation_goal, goal_status, customer_final_state, resolution_result, dropoff_happened, dropoff_likely_reason, objections, short_label",
            )
            .in("id", idChunk);
        if (error) throw new Error(`Falha ao carregar análises: ${error.message}`);
        for (const row of (data ?? []) as AnalysisRow[]) result.set(row.id, row);
    }
    return result;
}

async function loadMessagesForConversations(ids: string[]) {
    const result = new Map<string, MessageRow[]>();

    for (const idChunk of chunk(ids, 8)) {
        const pages = await Promise.all(
            idChunk.map(async (conversationId) => {
                const { data, error } = await supabase
                    .from("messages")
                    .select("conversation_id, sender_type, sender_name, text, sent_at")
                    .eq("conversation_id", conversationId)
                    .order("sent_at", { ascending: true })
                    .limit(500);
                if (error) {
                    throw new Error(`Falha ao carregar mensagens: ${error.message}`);
                }
                return [conversationId, (data ?? []) as MessageRow[]] as const;
            }),
        );
        for (const [conversationId, rows] of pages) result.set(conversationId, rows);
    }

    return result;
}

async function loadCancellationSchedules(
    dateFrom: string,
    dateTo: string,
    unitName: string | null,
    exactUnitName: boolean,
) {
    const rows: ScheduleRow[] = [];
    for (let offset = 0; offset < MAX_CANCELLATION_ROWS; offset += PAGE_SIZE) {
        let query = supabase
            .from("schedules")
            .select(
                "id, client_id, scheduled_for, created_in_source_at, patient_name, phone, unit_name, attendant_name, procedure_name, status",
            )
            .gte("scheduled_for", dateFrom)
            .lte("scheduled_for", dateTo)
            .in("status", ["Desmarcou", "Remarcou"])
            .order("scheduled_for", { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
        if (unitName) {
            query = query.ilike(
                "unit_name",
                exactUnitName
                    ? sanitizeFilter(unitName)
                    : `%${sanitizeFilter(unitName)}%`,
            );
        }
        const { data, error } = await query;
        if (error) throw new Error(`Falha ao carregar cancelamentos: ${error.message}`);
        const page = (data ?? []) as ScheduleRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return { rows, capped: false };
    }
    return { rows, capped: true };
}

async function loadClientConversations(
    clientIds: string[],
    dateFrom: string,
    dateTo: string,
    unitId: string | null,
) {
    const rows: ConversationRow[] = [];
    const scopedClientIds = unitId
        ? await filterClientIdsByUnit(clientIds, unitId)
        : clientIds;

    for (const idChunk of chunk(scopedClientIds, 100)) {
        const query = supabase
            .from("conversations")
            .select(
                "id, client_id, conversation_analysis_id, channel, started_at, ended_at, attendant_chat_name, last_message_text",
            )
            .in("client_id", idChunk)
            .eq("channel", "WhatsApp")
            .gte("started_at", brazilDayBoundary(dateFrom))
            .lt("started_at", brazilDayBoundary(addDays(dateTo, 1)))
            .order("started_at", { ascending: false });
        const { data, error } = await query;
        if (error) throw new Error(`Falha ao cruzar conversas: ${error.message}`);
        rows.push(...((data ?? []) as ConversationRow[]));
    }
    return rows;
}

async function filterClientIdsByUnit(clientIds: string[], unitId: string) {
    const ids: string[] = [];

    for (const idChunk of chunk(clientIds, 100)) {
        const { data, error } = await supabase
            .from("clients")
            .select("id")
            .in("id", idChunk)
            .eq("unit_id", unitId);

        if (error) {
            throw new Error(`Falha ao validar unidade dos clientes: ${error.message}`);
        }

        ids.push(...(data ?? []).map((row) => row.id));
    }

    return ids;
}

async function loadCancellationConversationIds(
    allowedIds: Set<string>,
    dateFrom: string,
    dateTo: string,
    unitId: string | null,
) {
    const ids = new Set<string>();
    const rows = await loadFilteredConversationCandidates({
        terms: CANCELLATION_WORDS,
        matchMode: "any",
        channel: "WhatsApp",
        dateFrom,
        dateTo,
        unitId,
        exactPhrase: null,
        limit: MAX_CANCELLATION_ROWS,
    });
    for (const row of rows) {
        if (allowedIds.has(row.conversation_id)) ids.add(row.conversation_id);
    }
    return ids;
}

async function loadAttributions(dateFrom: string, dateTo: string) {
    const rows: AttributionRow[] = [];
    for (let offset = 0; offset < MAX_ATTRIBUTION_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("conversation_ad_attributions")
            .select(
                "instagram_user_id, channel, campaign_id, campaign_name, ad_set_id, ad_set_name, ad_name, enrichment_status, referral_received_at",
            )
            .gte("referral_received_at", brazilDayBoundary(dateFrom))
            .lt("referral_received_at", brazilDayBoundary(addDays(dateTo, 1)))
            .order("referral_received_at", { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw new Error(`Falha ao carregar atribuições: ${error.message}`);
        const page = (data ?? []) as AttributionRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return { rows, capped: false };
    }
    return { rows, capped: true };
}

async function loadInstagramUsers(ids: string[]) {
    const result = new Map<string, InstagramUserRow>();
    for (const idChunk of chunk(ids, 100)) {
        const { data, error } = await supabase
            .from("instagram_users")
            .select("id, display_name, username, location")
            .in("id", idChunk);
        if (error) throw new Error(`Falha ao carregar perfis sociais: ${error.message}`);
        for (const row of (data ?? []) as InstagramUserRow[]) result.set(row.id, row);
    }
    return result;
}

function matchingSnippets(
    messages: MessageRow[],
    normalizedQuery: string,
    terms: string[],
    exactPhrase: boolean,
) {
    const snippets: string[] = [];
    for (const message of messages) {
        const text = message.text?.trim();
        if (!text) continue;
        const normalized = normalizeSearchText(text);
        const matches = exactPhrase
            ? normalized.includes(normalizedQuery)
            : terms.some((term) => normalized.includes(term));
        if (!matches) continue;
        snippets.push(
            `${message.sender_name?.trim() || senderLabel(message.sender_type)}: ${truncate(text, 360)}`,
        );
        if (snippets.length >= 3) break;
    }
    return snippets;
}

function cancellationExcerpt(messages: MessageRow[]) {
    const matchingIndexes = messages
        .map((message, index) => ({
            index,
            normalized: normalizeSearchText(message.text),
        }))
        .filter(({ normalized }) =>
            CANCELLATION_WORDS.some((word) => normalized.includes(word)),
        )
        .map(({ index }) => index);
    const firstIndex = matchingIndexes[0];
    if (firstIndex === undefined) return null;
    return messages
        .slice(Math.max(0, firstIndex - 2), firstIndex + 4)
        .map((message) => {
            const text = message.text?.trim();
            if (!text) return null;
            return `${message.sender_name?.trim() || senderLabel(message.sender_type)}: ${text}`;
        })
        .filter((value): value is string => Boolean(value))
        .join("\n")
        .slice(0, 1_200);
}

function classifyCancellationEvidence(value: string) {
    const normalized = normalizeSearchText(value);
    const categories: Array<[string, RegExp]> = [
        ["Preço ou condição financeira", /\b(valor|preco|caro|dinheiro|pagamento|pagar|condicao)\b/],
        ["Horário ou disponibilidade", /\b(horario|data|dia|trabalho|agenda|disponibilidade|consigo)\b/],
        ["Distância ou localização", /\b(longe|distancia|cidade|unidade|deslocamento|viagem)\b/],
        ["Saúde ou intercorrência", /\b(doente|doenca|saude|hospital|febre|medico|menstruei)\b/],
        ["Adiamento ou desistência", /\b(desisti|desistir|depois|pensar|momento|quero)\b/],
    ];
    return categories.find(([, pattern]) => pattern.test(normalized))?.[0] ??
        "Cancelamento/remarcação explícita sem motivo classificável";
}

function nearestScheduleForConversation(
    schedules: ScheduleRow[],
    conversationStartedAt: string,
) {
    const conversationTime = new Date(conversationStartedAt).getTime();
    return [...schedules].sort((first, second) => {
        const firstDistance = Math.abs(
            new Date(`${first.scheduled_for}T12:00:00-03:00`).getTime() -
                conversationTime,
        );
        const secondDistance = Math.abs(
            new Date(`${second.scheduled_for}T12:00:00-03:00`).getTime() -
                conversationTime,
        );
        return firstDistance - secondDistance;
    })[0] ?? null;
}

function expectedAttributionCity(row: AttributionRow) {
    return (
        matchMediaBudgetCity(row.ad_set_name) ??
        matchMediaBudgetCity(row.campaign_name)
    );
}

function isFirstEvaluation(value: string | null) {
    return /\b(?:1|1a|1o|primeira)\s+avaliacao\b/.test(
        normalizeSearchText(value),
    );
}

function countRows<T>(rows: T[], keyOf: (row: T) => string) {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const key = keyOf(row);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort(
            (first, second) =>
                second.count - first.count ||
                first.label.localeCompare(second.label, "pt-BR"),
        );
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string) {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
        const key = keyOf(row);
        const current = grouped.get(key) ?? [];
        current.push(row);
        grouped.set(key, current);
    }
    return grouped;
}

function toCsv(columns: string[], rows: Array<Record<string, unknown>>) {
    const lines = [
        columns.map(csvCell).join(";"),
        ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(";")),
    ];
    return `\uFEFF${lines.join("\r\n")}`;
}

function csvCell(value: unknown) {
    const text =
        value === null || value === undefined
            ? ""
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function scheduleExportColumns() {
    return {
        Data: null,
        Paciente: null,
        Telefone: null,
        Unidade: null,
        Atendente: null,
        Procedimento: null,
        Situação: null,
    };
}

function clientExportColumns() {
    return {
        Nome: null,
        Telefone: null,
        Email: null,
        Unidade: null,
        Cidade: null,
        Estado: null,
        "Primeiro contato": null,
        "Última interação": null,
    };
}

function conversationExportColumns() {
    return {
        Cliente: null,
        Unidade: null,
        Canal: null,
        Início: null,
        Término: null,
        Atendente: null,
        Objetivo: null,
        "Resultado do objetivo": null,
        "Situação final": null,
        Resolução: null,
        Abandono: null,
        "Motivo provável": null,
        Resumo: null,
    };
}

function normalizeSearchText(value: unknown) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function senderLabel(value: string | null) {
    if (value === "client") return "Cliente";
    if (value === "attendant") return "Atendente";
    if (value === "bot") return "Bot";
    return "Sistema";
}

function truncate(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function chunk<T>(values: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function unique<T>(values: T[]) {
    return [...new Set(values)];
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArg(args: JsonRecord, key: string) {
    const value = args[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function stringArrayArg(args: JsonRecord, key: string) {
    const value = args[key];
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
}

function booleanArg(args: JsonRecord, key: string, fallback: boolean) {
    return typeof args[key] === "boolean" ? args[key] : fallback;
}

function integerArg(
    args: JsonRecord,
    key: string,
    fallback: number,
    min: number,
    max: number,
) {
    const value = Number(args[key]);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

function validDateArg(args: JsonRecord, key: string) {
    const value = stringArg(args, key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function sanitizeFilter(value: string) {
    return value.replace(/[,%()]/g, " ").trim().slice(0, 120);
}

async function resolveSingleUnit(name: string) {
    const safe = sanitizeFilter(name);
    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .ilike("name", `%${safe}%`)
        .eq("active", true)
        .order("name", { ascending: true })
        .limit(10);

    if (error) {
        throw new Error(`Falha ao localizar unidade: ${error.message}`);
    }

    const rows = data ?? [];
    const exact = rows.find(
        (row) =>
            row.name.toLocaleLowerCase("pt-BR") ===
            name.toLocaleLowerCase("pt-BR"),
    );

    return exact ?? rows[0] ?? null;
}

function todayInBrazil() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function dateDaysAgo(days: number) {
    return addDays(todayInBrazil(), -Math.max(0, days - 1));
}

function addDays(value: string, amount: number) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
}

function brazilDayBoundary(value: string) {
    return `${value}T00:00:00-03:00`;
}
