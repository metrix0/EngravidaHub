// scripts/envdump/route.ts
import { NextResponse } from "next/server";

const PASSWORD = "whatever";

const KEYS = [
    "TINTIM_FORWARD_WEBHOOK_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "OPENAI_API_KEY",
    "OPENAI_MODEL_ANALYSIS",
    "GROQ_API_KEY",
    "GROQ_MODEL_ANALYSIS",
    "META_PIXEL_ID",
    "META_ACCESS_TOKEN",
    "META_TEST_EVENT_CODE",
    "META_PAGE_ID",
    "BLIP_CONTRACT_ID",
    "BLIP_AUTH_KEY",
    "BLIP_WEBHOOK_SECRET",
];

export async function GET(req: Request) {
    const url = new URL(req.url);
    const password = url.searchParams.get("password");

    if (password !== PASSWORD) {
        return new Response("HI", {
            status: 200,
            headers: {
                "Content-Type": "text/plain",
            },
        });
    }

    const envs: Record<string, string | null> = {};

    for (const key of KEYS) {
        envs[key] = process.env[key] ?? null;
    }

    return NextResponse.json(envs);
}