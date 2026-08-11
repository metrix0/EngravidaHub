// lib/ai/assistantSocialDataTools.ts
import { supabase } from "@/lib";

type JsonRecord = Record<string, unknown>;

type ToolExecution = {
    output: unknown;
    cards: [];
};

type SocialChannel = "Instagram" | "Facebook";

type SocialUser = {
    id: string;
    username: string | null;
    display_name: string | null;
    profile_picture_url: string | null;
    first_seen_at: string | null;
    last_interaction_at: string | null;
};

type AnalysisSummary = {
    short_label: string | null;
    customer_start_intent?: string | null;
    conversation_goal: string | null;
    goal_status: string | null;
    customer_final_state: string | null;
    resolution_result: string | null;
    dropoff_happened: boolean | null;
    dropoff_moment: string | null;
    notable: boolean | null;
    notable_reason: string | null;
    first_human_response_time_seconds?: number | null;
    average_human_response_time_seconds?: number | null;
    satisfaction_score?: number | null;
    attendant_quality_score?: number | null;
    analysis_message_count?: number | null;
};

type SocialConversationRow = {
    id: string;
    instagram_user_id: string | null;
    channel: string | null;
    started_at: string | null;
    ended_at: string | null;
    attendant_chat_name: string | null;
    source: string | null;
    tunnel: string | null;
    origin: string | null;
    last_message_text: string | null;
    instagram_users: SocialUser | SocialUser[] | null;
    conversation_analysis: AnalysisSummary | AnalysisSummary[] | null;
};

const SOCIAL_CHANNELS: SocialChannel[] = ["Instagram", "Facebook"];
const SEARCH_PAGE_SIZE = 1_000;
const MAX_SEARCH_ROWS = 20_000;
const MAX_MESSAGES = 300;
const MAX_TRANSCRIPT_CHARS = 24_000;
const DEFAULT_EXAMPLE_LIMIT = 8;

export function isAssistantSocialDataTool(name: string) {
    return (
        name === "search_social_conversations" ||
        name === "get_social_conversation_context"
    );
}

export async function executeAssistantSocialDataTool(
    name: string,
    rawArguments: unknown,
): Promise<ToolExecution> {
    const args = isRecord(rawArguments) ? rawArguments : {};

    if (name === "search_social_conversations") {
        return searchSocialConversations(args);
    }

    if (name === "get_social_conversation_context") {
        return getSocialConversationContext(args);
    }

    return {
        output: { ok: false, error: `Unknown social tool: ${name}` },
        cards: [],
    };
}

async function searchSocialConversations(
    args: JsonRecord,
): Promise<ToolExecution> {
    const requestedChannel = stringArg(args, "channel");
    const queryText =
        stringArg(args, "query")?.toLocaleLowerCase("pt-BR") ?? "";
    const dateTo = stringArg(args, "date_to") ?? saoPauloDateKey(new Date());
    const dateFrom = stringArg(args, "date_from") ?? addDays(dateTo, -29);
    const requestedLimit = integerArg(args, "limit", 12, 1, 30);
    const channels = normalizeChannels(requestedChannel);

    const { rows, capped } = await fetchSocialConversationRows({
        channels,
        dateFrom,
        dateTo,
    });

    const normalized = rows.map(normalizeSocialConversation);
    const filtered = queryText
        ? normalized.filter((item) => matchesSocialQuery(item, queryText))
        : normalized;
    const exampleLimit = queryText
        ? requestedLimit
        : Math.min(DEFAULT_EXAMPLE_LIMIT, requestedLimit);
    const examples = filtered.slice(0, exampleLimit);
    const overview = buildSocialOverview(filtered, dateFrom, dateTo, channels);

    return {
        output: {
            ok: true,
            period: { date_from: dateFrom, date_to: dateTo },
            channels,
            overview,
            conversations: examples,
            total_matching: filtered.length,
            examples_returned: examples.length,
            coverage: {
                capped,
                max_rows_scanned: MAX_SEARCH_ROWS,
                note: capped
                    ? `A leitura atingiu o limite de ${MAX_SEARCH_ROWS.toLocaleString("pt-BR")} conversas; totais podem ser parciais. Refine o período para precisão total.`
                    : "Todos os registros do período foram lidos.",
            },
            note: queryText
                ? "A lista contém exemplos que correspondem ao filtro. Para ler uma conversa específica, use get_social_conversation_context com o id retornado silenciosamente."
                : "Para contexto geral, responda diretamente usando overview; não é necessário abrir conversas individuais. Use get_social_conversation_context somente se o usuário pedir exemplos ou detalhes de uma conversa.",
        },
        cards: [],
    };
}

async function fetchSocialConversationRows({
    channels,
    dateFrom,
    dateTo,
}: {
    channels: SocialChannel[];
    dateFrom: string;
    dateTo: string;
}) {
    const rows: SocialConversationRow[] = [];
    let offset = 0;
    let capped = false;

    while (offset < MAX_SEARCH_ROWS) {
        const end = Math.min(
            offset + SEARCH_PAGE_SIZE - 1,
            MAX_SEARCH_ROWS - 1,
        );
        const { data, error } = await supabase
            .from("conversations")
            .select(`
                id,
                instagram_user_id,
                channel,
                started_at,
                ended_at,
                attendant_chat_name,
                source,
                tunnel,
                origin,
                last_message_text,
                instagram_users!conversations_instagram_user_id_fkey (
                    id,
                    username,
                    display_name,
                    profile_picture_url,
                    first_seen_at,
                    last_interaction_at
                ),
                conversation_analysis!conversations_conversation_analysis_id_fkey (
                    short_label,
                    customer_start_intent,
                    conversation_goal,
                    goal_status,
                    customer_final_state,
                    resolution_result,
                    dropoff_happened,
                    dropoff_moment,
                    notable,
                    notable_reason,
                    first_human_response_time_seconds,
                    average_human_response_time_seconds,
                    satisfaction_score,
                    attendant_quality_score,
                    analysis_message_count
                )
            `)
            .in("channel", channels)
            .gte("started_at", brazilDayBoundary(dateFrom))
            .lt("started_at", brazilDayBoundary(addDays(dateTo, 1)))
            .order("started_at", { ascending: false })
            .range(offset, end);

        if (error) {
            throw new Error(
                `Falha ao buscar conversas sociais: ${error.message}`,
            );
        }

        const page = (data ?? []) as unknown as SocialConversationRow[];
        rows.push(...page);

        if (page.length < SEARCH_PAGE_SIZE) {
            return { rows, capped: false };
        }

        offset += SEARCH_PAGE_SIZE;
    }

    capped = true;
    return { rows, capped };
}

function normalizeSocialConversation(row: SocialConversationRow) {
    const socialUser = relationOne(row.instagram_users);
    const analysis = relationOne(row.conversation_analysis);

    return {
        id: row.id,
        channel: normalizeRowChannel(row.channel),
        started_at: row.started_at,
        ended_at: row.ended_at,
        attendant_name: row.attendant_chat_name ?? null,
        source: row.source ?? null,
        tunnel: row.tunnel ?? null,
        origin: row.origin ?? null,
        preview: row.last_message_text ?? null,
        social_user: socialUser
            ? {
                  id: socialUser.id,
                  display_name: socialUser.display_name ?? null,
                  username: socialUser.username ?? null,
                  first_seen_at: socialUser.first_seen_at ?? null,
                  last_interaction_at:
                      socialUser.last_interaction_at ?? null,
              }
            : null,
        analysis: analysis ?? null,
    };
}

function matchesSocialQuery(
    item: ReturnType<typeof normalizeSocialConversation>,
    queryText: string,
) {
    const normalizedQuery = queryText.replace(/^@/, "");
    const searchable = [
        item.social_user?.display_name,
        item.social_user?.username,
        item.preview,
        item.attendant_name,
        item.analysis?.short_label,
        item.analysis?.notable_reason,
        item.analysis?.customer_start_intent,
        item.analysis?.conversation_goal,
        item.analysis?.customer_final_state,
    ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR");

    return searchable.includes(normalizedQuery);
}

function buildSocialOverview(
    items: ReturnType<typeof normalizeSocialConversation>[],
    dateFrom: string,
    dateTo: string,
    channels: SocialChannel[],
) {
    const byChannel = countBy(items, (item) => item.channel);
    const byDay = countBy(
        items,
        (item) =>
            item.started_at
                ? saoPauloDateKey(new Date(item.started_at))
                : "sem-data",
    );
    const analyzed = items.filter((item) => item.analysis);
    const analyses = analyzed
        .map((item) => item.analysis)
        .filter((analysis): analysis is AnalysisSummary => Boolean(analysis));
    const socialProfiles = new Set(
        items
            .map((item) => item.social_user?.id)
            .filter((id): id is string => Boolean(id)),
    );

    const firstResponseValues = numericValues(
        analyses.map((analysis) => analysis.first_human_response_time_seconds),
    );
    const averageResponseValues = numericValues(
        analyses.map((analysis) => analysis.average_human_response_time_seconds),
    );
    const qualityValues = numericValues(
        analyses.map((analysis) => analysis.attendant_quality_score),
    );
    const satisfactionValues = numericValues(
        analyses.map((analysis) => analysis.satisfaction_score),
    );
    const analyzedMessageCounts = numericValues(
        analyses.map((analysis) => analysis.analysis_message_count),
    );

    return {
        period: { date_from: dateFrom, date_to: dateTo },
        requested_channels: channels,
        conversations: items.length,
        social_profiles: socialProfiles.size,
        by_channel: objectCountRows(byChannel, "channel"),
        daily_conversations: objectCountRows(byDay, "date").sort((a, b) =>
            String(a.date).localeCompare(String(b.date)),
        ),
        analysis_coverage: {
            analyzed_conversations: analyzed.length,
            unanalyzed_conversations: items.length - analyzed.length,
            analyzed_percentage: percentage(analyzed.length, items.length),
            analyzed_message_count_sum: sum(analyzedMessageCounts),
            note: "Métricas de resolução, abandono, intenção, qualidade e tempo abaixo cobrem apenas conversas com análise disponível.",
        },
        outcomes: {
            resolution_result: topCounts(
                analyses.map((analysis) => analysis.resolution_result),
                10,
            ),
            goal_status: topCounts(
                analyses.map((analysis) => analysis.goal_status),
                10,
            ),
            dropoff: {
                happened: analyses.filter(
                    (analysis) => analysis.dropoff_happened === true,
                ).length,
                not_happened: analyses.filter(
                    (analysis) => analysis.dropoff_happened === false,
                ).length,
                unknown: analyses.filter(
                    (analysis) => analysis.dropoff_happened == null,
                ).length,
            },
        },
        common_context: {
            start_intents: topCounts(
                analyses.map((analysis) => analysis.customer_start_intent),
                8,
            ),
            conversation_goals: topCounts(
                analyses.map((analysis) => analysis.conversation_goal),
                8,
            ),
            final_states: topCounts(
                analyses.map((analysis) => analysis.customer_final_state),
                8,
            ),
            dropoff_moments: topCounts(
                analyses.map((analysis) => analysis.dropoff_moment),
                8,
            ),
        },
        service_metrics: {
            average_first_human_response_seconds: average(firstResponseValues),
            average_human_response_seconds: average(averageResponseValues),
            average_attendant_quality_score: average(qualityValues),
            average_satisfaction_score: average(satisfactionValues),
            samples: {
                first_response: firstResponseValues.length,
                average_response: averageResponseValues.length,
                quality: qualityValues.length,
                satisfaction: satisfactionValues.length,
            },
        },
    };
}

async function getSocialConversationContext(
    args: JsonRecord,
): Promise<ToolExecution> {
    const conversationId = stringArg(args, "conversation_id");

    if (!conversationId) {
        return {
            output: { ok: false, error: "conversation_id is required" },
            cards: [],
        };
    }

    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select(`
            id,
            instagram_user_id,
            channel,
            started_at,
            ended_at,
            attendant_chat_name,
            source,
            tunnel,
            origin,
            last_message_text,
            conversation_analysis_id,
            instagram_users!conversations_instagram_user_id_fkey (
                id,
                username,
                display_name,
                profile_picture_url,
                first_seen_at,
                last_interaction_at
            )
        `)
        .eq("id", conversationId)
        .in("channel", SOCIAL_CHANNELS)
        .maybeSingle();

    if (conversationError) {
        throw new Error(
            `Falha ao carregar conversa social: ${conversationError.message}`,
        );
    }

    if (!conversation) {
        return {
            output: {
                ok: false,
                error: "Conversa de Instagram/Facebook não encontrada.",
            },
            cards: [],
        };
    }

    const [analysisResult, messagesResult] = await Promise.all([
        conversation.conversation_analysis_id
            ? supabase
                  .from("conversation_analysis")
                  .select("*")
                  .eq("id", conversation.conversation_analysis_id)
                  .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        supabase
            .from("messages")
            .select(
                "id, sender_type, sender_name, text, sent_at, sequence_index",
                { count: "exact" },
            )
            .eq("conversation_id", conversationId)
            .order("sent_at", { ascending: true })
            .order("sequence_index", { ascending: true })
            .limit(MAX_MESSAGES),
    ]);

    const firstError = analysisResult.error ?? messagesResult.error;
    if (firstError) {
        throw new Error(
            `Falha ao carregar contexto social: ${firstError.message}`,
        );
    }

    const socialUser = relationOne(
        conversation.instagram_users as SocialUser | SocialUser[] | null,
    );
    const messages = messagesResult.data ?? [];
    const transcript = messages
        .map((message) => {
            const sender =
                message.sender_name?.trim() ||
                senderLabel(message.sender_type ?? "unknown");
            return `[${message.sent_at}] ${sender}: ${cleanMessageText(
                message.text ?? "",
            ).slice(0, 2_000)}`;
        })
        .join("\n");
    const transcriptTruncated =
        (messagesResult.count ?? messages.length) > messages.length ||
        transcript.length > MAX_TRANSCRIPT_CHARS;

    return {
        output: {
            ok: true,
            conversation: {
                channel: normalizeRowChannel(conversation.channel),
                started_at: conversation.started_at,
                ended_at: conversation.ended_at,
                attendant_name: conversation.attendant_chat_name ?? null,
                source: conversation.source ?? null,
                tunnel: conversation.tunnel ?? null,
                origin: conversation.origin ?? null,
                preview: conversation.last_message_text ?? null,
            },
            social_user: socialUser
                ? {
                      display_name: socialUser.display_name ?? null,
                      username: socialUser.username ?? null,
                      profile_picture_url:
                          socialUser.profile_picture_url ?? null,
                      first_seen_at: socialUser.first_seen_at ?? null,
                      last_interaction_at:
                          socialUser.last_interaction_at ?? null,
                  }
                : null,
            analysis: analysisResult.data ?? null,
            messages: messages.map((message) => ({
                sender_type: message.sender_type ?? null,
                sender_name: message.sender_name ?? null,
                text: cleanMessageText(message.text ?? ""),
                sent_at: message.sent_at,
            })),
            message_count: messagesResult.count ?? messages.length,
            transcript:
                transcript.length > MAX_TRANSCRIPT_CHARS
                    ? transcript.slice(-MAX_TRANSCRIPT_CHARS)
                    : transcript,
            transcript_truncated: transcriptTruncated,
        },
        cards: [],
    };
}

function normalizeChannels(value: string | null): SocialChannel[] {
    if (value === "Instagram") return ["Instagram"];
    if (value === "Facebook") return ["Facebook"];
    return SOCIAL_CHANNELS;
}

function normalizeRowChannel(value: unknown): SocialChannel {
    return value === "Facebook" ? "Facebook" : "Instagram";
}

function brazilDayBoundary(date: string) {
    return `${date}T00:00:00-03:00`;
}

function addDays(date: string, amount: number) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + amount);
    return value.toISOString().slice(0, 10);
}

function saoPauloDateKey(date: Date) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function senderLabel(value: string) {
    if (value === "client") return "Cliente";
    if (value === "attendant") return "Atendente";
    if (value === "bot") return "Bot";
    return "Sistema";
}

function cleanMessageText(value: string) {
    return value.replace(/\u0000/g, "").trim();
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
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

function numericValues(values: Array<number | null | undefined>) {
    return values.filter(
        (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
    );
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
    if (values.length === 0) return null;
    return Math.round((sum(values) / values.length) * 10) / 10;
}

function percentage(value: number, total: number) {
    if (total <= 0) return 0;
    return Math.round((value / total) * 1_000) / 10;
}

function countBy<T>(items: T[], keyOf: (item: T) => string) {
    const counts: Record<string, number> = {};
    for (const item of items) {
        const key = keyOf(item);
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

function objectCountRows(
    counts: Record<string, number>,
    keyName: string,
): Array<Record<string, string | number>> {
    return Object.entries(counts).map(([key, count]) => ({
        [keyName]: key,
        count,
    }));
}

function topCounts(
    values: Array<string | null | undefined>,
    limit: number,
) {
    const counts = countBy(
        values.filter((value): value is string => Boolean(value?.trim())),
        (value) => value.trim(),
    );

    return Object.entries(counts)
        .map(([label, count]) => ({ label, count }))
        .sort((first, second) => second.count - first.count)
        .slice(0, limit);
}
