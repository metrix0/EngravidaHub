// apps/insights/src/lib/ai/groq.ts
import OpenAI from "openai";

const groqApiKeys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
    process.env.GROQ_API_KEY_6,
    process.env.GROQ_API_KEY_7,
    process.env.GROQ_API_KEY_8,
].filter(Boolean) as string[];

if (groqApiKeys.length === 0) {
    throw new Error("Missing GROQ_API_KEY");
}

export function getGroqClient() {
    const apiKey =
        groqApiKeys[Math.floor(Math.random() * groqApiKeys.length)];

    return new OpenAI({
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
    });
}