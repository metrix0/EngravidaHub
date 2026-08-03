// lib/supabase/retry.ts
type SupabaseOperationResult = {
    data: unknown;
    error: unknown;
};

type SupabaseRetryOptions = {
    attempts?: number;
    baseDelayMs?: number;
    label?: string;
    signal?: AbortSignal;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 180;

export async function withSupabaseRetry<
    TResult extends SupabaseOperationResult,
>(
    operation: () => PromiseLike<TResult>,
    {
        attempts = DEFAULT_ATTEMPTS,
        baseDelayMs = DEFAULT_BASE_DELAY_MS,
        label = "Supabase request",
        signal,
    }: SupabaseRetryOptions = {},
): Promise<TResult> {
    let lastResult: TResult | null = null;
    let lastThrownError: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (signal?.aborted) {
            if (lastResult) return lastResult;
            throw signal.reason ?? new DOMException("Aborted", "AbortError");
        }

        try {
            const result = await operation();

            if (
                !result.error ||
                !isTransientSupabaseError(result.error) ||
                attempt === attempts
            ) {
                return result;
            }

            lastResult = result;
            console.warn(`[${label}] transient Supabase error; retrying`, {
                attempt,
                error: supabaseErrorText(result.error),
            });
        } catch (error) {
            if (
                signal?.aborted ||
                !isTransientSupabaseError(error) ||
                attempt === attempts
            ) {
                throw error;
            }

            lastThrownError = error;
            console.warn(`[${label}] transient Supabase error; retrying`, {
                attempt,
                error: supabaseErrorText(error),
            });
        }

        await wait(baseDelayMs * 2 ** (attempt - 1), signal);
    }

    if (lastResult) return lastResult;
    throw lastThrownError ?? new Error(`${label} failed after retries`);
}

export function isTransientSupabaseError(error: unknown) {
    const text = supabaseErrorText(error);

    // A PostgreSQL statement timeout means the query itself exceeded its
    // budget. Retrying it immediately multiplies the same expensive work and
    // makes contention worse for every other page. Only transport-level
    // failures are retried here.
    if (
        errorCode(error) === "57014" ||
        /statement timeout|canceling statement/i.test(text)
    ) {
        return false;
    }

    return /ResponseAborted|UND_ERR_RES_ABORTED|UND_ERR|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network connection|connection terminated|HTTP 5(?:02|03|04|20|21|22|23|24|25|26|27)/i.test(
        text,
    );
}

export function supabaseErrorText(error: unknown): string {
    if (error instanceof Error) {
        return [
            error.name,
            error.message,
            error.cause ? supabaseErrorText(error.cause) : "",
        ]
            .filter(Boolean)
            .join(" ");
    }

    if (typeof error === "string") return error;
    if (!error || typeof error !== "object") return String(error);

    const record = error as Record<string, unknown>;
    const fields = [
        record.code,
        record.message,
        record.details,
        record.hint,
        record.cause ? supabaseErrorText(record.cause) : null,
    ]
        .filter((value): value is string => typeof value === "string" && Boolean(value))
        .join(" ");

    if (fields) return fields;

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function errorCode(error: unknown) {
    if (!error || typeof error !== "object") return null;
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : null;
}

async function wait(milliseconds: number, signal?: AbortSignal) {
    if (signal?.aborted) return;

    await new Promise<void>((resolve) => {
        const finish = () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", finish);
            resolve();
        };
        const timeout = setTimeout(finish, milliseconds);

        signal?.addEventListener("abort", finish, { once: true });
    });
}
