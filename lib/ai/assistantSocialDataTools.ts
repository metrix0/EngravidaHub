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
    conversation_goal: string | null;
    goal_status: string | null;
    customer_final_state: string | null;
    resolution_result: string | null;
    dropoff_happened: boolean | null;
    dropoff_moment: string | null;
    notable: boolean | null;
    notable_reason: string | null;
};

const SOCIAL_CHANNELS: SocialChannel[] = ["Instagram", "Facebook"];
const MAX_SEARCH_ROWS = 5_000;
const MAX_MESSAGES = 300;
const MAX_TRANSCRIPT_CHARS = 24_000;

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
    const queryText = stringArg(args, "query")?.toLocaleLowerCase("pt-BR") ?? "";
    const dateFrom = stringArg(args, "date_from");
    const dateTo = stringArg(args, "date_to");
    const limit = integerArg(args, "limit", 12, 1, 30);
    const channels = normalizeChannels(requestedChannel);

    let query = supabase
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
                conversation_goal,
                goal_status,
                customer_final_state,
                resolution_result,
                dropoff_happened,
                dropoff_moment,
                notable,
                notable_reason
            )
        `)
        .in("channel", channels)
        .order("started_at", { ascending: false })
        .limit(MAX_SEARCH_ROWS);

    if (dateFrom) {
        query = query.gte("started_at", brazilDayBoundary(dateFrom));
    }
    if (dateTo) {
        query = query.lt("started_at", brazilDayBoundary(addDays(dateTo, 1)));
    }

    const { data, error } = await query;

    if (error) {
        throw new Error(`Falha ao buscar conversas sociais: ${error.message}`);
    }

    const conversations = (data ?? [])
        .map((row) => {
            const socialUser = relationOne(row.instagram_users) as SocialUser | null;
            const analysis = relationOne(
                row.conversation_analysis,
            ) as AnalysisSummary | null;

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
                analysis,
            };
        })
        .filter((item) => {
            if (!queryText) return true;

            const searchable = [
                item.social_user?.display_name,
                item.social_user?.username,
                item.preview,
                item.attendant_name,
                item.analysis?.short_label,
                item.analysis?.notable_reason,
                item.analysis?.conversation_goal,
                item.analysis?.customer_final_state,
            ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase("pt-BR");

            return searchable.includes(queryText.replace(/^@/, ""));
        })
        .slice(0, limit);

    return {
        output: {
            ok: true,
            channels,
            conversations,
            total_returned: conversations.length,
            note:
                "Para ler as mensagens de uma conversa específica, use get_social_conversation_context com o id retornado silenciosamente.",
        },
        cards: [],
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

    const socialUser = relationOne(conversation.instagram_users) as SocialUser | null;
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
