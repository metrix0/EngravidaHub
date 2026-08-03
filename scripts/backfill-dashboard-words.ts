// scripts/backfill-dashboard-words.ts
export {};

const PAGE_SIZE = 1_000;
const BACKFILL_BATCH_SIZE = 200;
const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const MAX_RETRIES = 5;

async function main() {
    // supabase-js 2.108+ initializes its Realtime client even though this
    // script only performs HTTP database calls. Node.js 20 does not expose a
    // native WebSocket, so install the project's existing `ws` transport
    // before importing the shared Supabase client.
    if (typeof globalThis.WebSocket === "undefined") {
        const { default: NodeWebSocket } = await import("ws");

        Object.defineProperty(globalThis, "WebSocket", {
            value: NodeWebSocket,
            configurable: true,
            writable: true,
        });
    }

    const { supabase } = await import("../lib/supabase/client");
    const range = previousSaoPauloMonthRange();
    const skipConversations = readNonNegativeIntegerArgument("skip", 0);
    const resetCache = process.argv.includes("--reset");
    let lastConversationId: string | null = null;
    let conversationsSeen = 0;
    let conversationsProcessed = skipConversations;
    let cachedRowsWritten = 0;

    const { count: conversationCount } = await withRetry(
        "count previous-month conversations",
        async () => {
            const result = await supabase
                .from("conversations")
                .select("id", { count: "exact", head: true })
                .eq("channel", "WhatsApp")
                .gte("started_at", range.startAt)
                .lt("started_at", range.endAt);

            if (result.error) throw result.error;
            return result;
        },
    );

    if (!conversationCount) {
        throw new Error(
            `No WhatsApp conversations found from ${range.startDate} through ${range.endDate}. Existing cache was not deleted.`,
        );
    }
    if (skipConversations > conversationCount) {
        throw new Error(
            `--skip=${skipConversations} exceeds the ${conversationCount} conversations found for the period.`,
        );
    }

    console.log(
        `Rebuilding dashboard word-map cache for ${range.startDate} through ${range.endDate} (${conversationCount.toLocaleString("pt-BR")} conversations)...`,
    );

    if (resetCache) {
        const { count: deletedRows } = await withRetry(
            "clear the word cache",
            async () => {
                const result = await supabase
                    .from("dashboard_conversation_words")
                    .delete({ count: "exact" })
                    .not("conversation_id", "is", null);

                if (result.error) throw result.error;
                return result;
            },
        );

        console.log(
            `${Number(deletedRows ?? 0).toLocaleString("pt-BR")} previously cached word rows deleted.`,
        );
    } else {
        console.log(
            "Existing cached rows preserved. Use --reset only when a complete rebuild is intentional.",
        );
    }

    if (skipConversations > 0) {
        console.log(
            `Resuming after ${skipConversations.toLocaleString("pt-BR")} previously completed conversations.`,
        );
    }

    for (;;) {
        const { data } = await withRetry("load a conversation page", async () => {
            let query = supabase
                .from("conversations")
                .select("id")
                .eq("channel", "WhatsApp")
                .gte("started_at", range.startAt)
                .lt("started_at", range.endAt)
                .order("id", { ascending: true })
                .limit(PAGE_SIZE);

            if (lastConversationId) {
                query = query.gt("id", lastConversationId);
            }

            const result = await query;
            if (result.error) throw result.error;
            return result;
        });

        const ids = (data ?? []).flatMap((row) =>
            typeof row.id === "string" ? [row.id] : [],
        );

        for (const batch of chunk(ids, BACKFILL_BATCH_SIZE)) {
            const batchStart = conversationsSeen;
            conversationsSeen += batch.length;

            if (conversationsSeen <= skipConversations) continue;
            const pendingBatch =
                batchStart < skipConversations
                    ? batch.slice(skipConversations - batchStart)
                    : batch;

            const { data: affected } = await withRetry(
                "backfill a conversation batch",
                async () => {
                    const result = await supabase.rpc(
                        "dashboard_backfill_conversation_words_batch_v1",
                        { p_conversation_ids: pendingBatch },
                    );

                    if (result.error) throw result.error;
                    return result;
                },
            );

            conversationsProcessed += pendingBatch.length;
            cachedRowsWritten += Number(affected ?? 0);
            console.log(
                `${conversationsProcessed.toLocaleString("pt-BR")} conversations processed · ${cachedRowsWritten.toLocaleString("pt-BR")} cached word rows written this run`,
            );
        }

        if (ids.length < PAGE_SIZE) break;
        lastConversationId = ids.at(-1) ?? null;
    }

    const { count: totalCachedRows } = await withRetry(
        "count cached word rows",
        async () => {
            const result = await supabase
                .from("dashboard_conversation_words")
                .select("conversation_id", { count: "exact", head: true });

            if (result.error) throw result.error;
            return result;
        },
    );

    console.log(
        `Backfill complete for ${range.startDate} through ${range.endDate}: ${conversationsProcessed.toLocaleString("pt-BR")} conversations and ${Number(totalCachedRows ?? 0).toLocaleString("pt-BR")} total cached word rows.`,
    );
}

function readNonNegativeIntegerArgument(name: string, fallback: number) {
    const prefix = `--${name}=`;
    const argument = process.argv.find((value) => value.startsWith(prefix));
    if (!argument) return fallback;

    const parsed = Number(argument.slice(prefix.length));
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Invalid --${name} value: ${argument}`);
    }

    return parsed;
}

async function withRetry<T>(label: string, operation: () => Promise<T>) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (!isRetryableError(error) || attempt === MAX_RETRIES) throw error;

            const delayMs = 500 * 2 ** (attempt - 1);
            console.warn(
                `${label} failed (${errorText(error)}). Retrying ${attempt}/${MAX_RETRIES - 1} in ${delayMs}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}

function isRetryableError(error: unknown) {
    return /fetch failed|econnreset|etimedout|responseaborted|network|timeout|und_err|\b429\b|\b50[234]\b/i.test(
        errorText(error),
    );
}

function errorText(error: unknown) {
    if (error instanceof Error) {
        return [error.message, error.cause ? String(error.cause) : ""]
            .filter(Boolean)
            .join(" ");
    }
    if (typeof error === "string") return error;

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function previousSaoPauloMonthRange(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: SAO_PAULO_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(
        parts.map((part) => [part.type, part.value]),
    );
    const currentYear = Number(values.year);
    const currentMonth = Number(values.month);
    const previousMonth = new Date(
        Date.UTC(currentYear, currentMonth - 2, 1),
    );
    const previousYear = previousMonth.getUTCFullYear();
    const previousMonthNumber = previousMonth.getUTCMonth() + 1;
    const previousMonthKey = `${previousYear}-${String(previousMonthNumber).padStart(2, "0")}`;
    const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
    const previousMonthDays = new Date(
        Date.UTC(previousYear, previousMonthNumber, 0),
    ).getUTCDate();

    return {
        startDate: `${previousMonthKey}-01`,
        endDate: `${previousMonthKey}-${String(previousMonthDays).padStart(2, "0")}`,
        startAt: `${previousMonthKey}-01T00:00:00-03:00`,
        endAt: `${currentMonthKey}-01T00:00:00-03:00`,
    };
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

main().catch((error) => {
    console.error(
        "Dashboard word-map backfill failed:",
        error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
});
