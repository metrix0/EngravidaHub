// lib/ai/generateValidatedJson.ts
import type { ZodType } from "zod";

import { getGroqClient } from "@/lib/ai/groq";

type GenerateValidatedJsonOptions<T> = {
    schema: ZodType<T>;
    jsonSchema?: Record<string, unknown>;
    systemPrompt: string;
    userPrompt: string;
    models?: string[];
    maxAttempts?: number;
};

export class AiGenerationError extends Error {
    constructor(
        public readonly reason: "provider" | "validation",
        public readonly providerStatus?: number,
    ) {
        super(reason === "validation"
            ? "A IA não retornou os dados no formato esperado. Tente novamente."
            : providerStatus === 429
              ? "O serviço de IA atingiu o limite de uso. Tente novamente em alguns instantes."
              : providerStatus === 401 || providerStatus === 403
                ? "Não foi possível autenticar no serviço de IA. Verifique a configuração."
                : providerStatus === 404
                  ? "Os modelos de IA configurados estão indisponíveis. Verifique a configuração."
                  : "O serviço de IA está indisponível no momento. Tente novamente.");
        this.name = "AiGenerationError";
    }
}

export async function generateValidatedJson<T>({
    schema,
    jsonSchema,
    systemPrompt,
    userPrompt,
    models,
    maxAttempts = 3,
}: GenerateValidatedJsonOptions<T>): Promise<T> {
    const availableModels = [...new Set((
        models?.length
            ? models
            : [
                process.env.GROQ_MODEL_EXTRACTION,
                process.env.GROQ_MODEL_ANALYSIS,
                process.env.GROQ_MODEL_ANALYSIS_2,
                process.env.GROQ_MODEL_ANALYSIS_3,
                process.env.GROQ_MODEL_ANALYSIS_4,
            ]
    ).filter(Boolean) as string[])];

    if (availableModels.length === 0) {
        availableModels.push("openai/gpt-oss-120b");
    }

    let lastError: unknown = null;
    let lastContentLength = 0;
    let lastPhase: "provider" | "validation" = "provider";
    let lastModel = "";
    const unavailableModels = new Set<string>();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const candidates = availableModels.filter(model => !unavailableModels.has(model));
        if (!candidates.length) break;
        const model = candidates[(attempt - 1) % candidates.length];
        lastModel = model;
        const previousWasValidation = lastPhase === "validation";
        lastPhase = "provider";

        try {
            const groq = getGroqClient();
            const response = await groq.chat.completions.create({
                model,
                temperature: 0,
                ...(jsonSchema ? { max_completion_tokens: 2048, reasoning_effort: "low" as const } : {}),
                response_format: jsonSchema
                    ? { type: "json_schema", json_schema: { name: "scheduling_autofill", strict: true, schema: jsonSchema } }
                    : { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: [
                            userPrompt,
                            attempt > 1 && previousWasValidation
                                ? `\nA tentativa anterior falhou na validação. Corrija o JSON. Erro: ${formatError(lastError)}`
                                : "",
                        ].join(""),
                    },
                ],
            });

            lastPhase = "validation";
            const content = response.choices[0]?.message?.content?.trim();

            if (!content) {
                throw new Error("AI did not return content");
            }

            lastContentLength = content.length;
            const json = JSON.parse(extractJson(content));
            const parsed = schema.safeParse(json);

            if (!parsed.success) {
                lastError = parsed.error;
                continue;
            }

            return parsed.data;
        } catch (error) {
            lastError = error;
            if (lastPhase === "provider" && providerStatus(error) === 404) unavailableModels.add(model);
        }
    }

    const status = lastPhase === "provider" ? providerStatus(lastError) : undefined;
    console.error("[generateValidatedJson] failed", {
        model: lastModel,
        phase: lastPhase,
        status,
        error: lastPhase === "provider" ? formatError(lastError) : "JSON parsing or schema validation failed",
        contentLength: lastContentLength,
    });

    throw new AiGenerationError(lastPhase, status);
}

function providerStatus(error: unknown) {
    if (error && typeof error === "object" && "status" in error && typeof error.status === "number") return error.status;
    return undefined;
}

function extractJson(content: string) {
    const withoutFence = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    const firstBrace = withoutFence.indexOf("{");
    const lastBrace = withoutFence.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new Error("AI response does not contain a JSON object");
    }

    return withoutFence.slice(firstBrace, lastBrace + 1);
}

function formatError(error: unknown) {
    if (error instanceof Error) return error.message;

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}
