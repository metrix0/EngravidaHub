// lib/ai/generateValidatedJson.ts
import type { ZodType } from "zod";

import { getGroqClient } from "@/lib/ai/groq";

type GenerateValidatedJsonOptions<T> = {
    schema: ZodType<T>;
    systemPrompt: string;
    userPrompt: string;
    models?: string[];
    maxAttempts?: number;
};

export async function generateValidatedJson<T>({
    schema,
    systemPrompt,
    userPrompt,
    models,
    maxAttempts = 3,
}: GenerateValidatedJsonOptions<T>): Promise<T> {
    const availableModels = (
        models?.length
            ? models
            : [
                process.env.GROQ_MODEL_EXTRACTION,
                process.env.GROQ_MODEL_ANALYSIS,
                process.env.GROQ_MODEL_ANALYSIS_2,
            ]
    ).filter(Boolean) as string[];

    if (availableModels.length === 0) {
        availableModels.push("openai/gpt-oss-120b");
    }

    let lastError: unknown = null;
    let lastContent = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const groq = getGroqClient();
        const model =
            availableModels[(attempt - 1) % availableModels.length] ??
            availableModels[0];

        try {
            const response = await groq.chat.completions.create({
                model,
                temperature: 0,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: [
                            userPrompt,
                            attempt > 1
                                ? `\nA tentativa anterior falhou na validação. Corrija o JSON. Erro: ${formatError(lastError)}`
                                : "",
                        ].join(""),
                    },
                ],
            });

            const content = response.choices[0]?.message?.content?.trim();

            if (!content) {
                throw new Error("AI did not return content");
            }

            lastContent = content;
            const json = JSON.parse(extractJson(content));
            const parsed = schema.safeParse(json);

            if (!parsed.success) {
                lastError = parsed.error;
                continue;
            }

            return parsed.data;
        } catch (error) {
            lastError = error;
        }
    }

    console.error("[generateValidatedJson] failed", {
        lastError,
        lastContent,
    });

    throw new Error("AI failed to return valid structured data");
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
