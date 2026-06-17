// app/src/lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

const supabaseKey =
    typeof window === "undefined"
        ? supabaseServiceRoleKey ?? supabaseAnonKey
        : supabaseAnonKey;

if (!supabaseKey) {
    throw new Error("Missing Supabase key");
}

export const supabase = createClient(supabaseUrl, supabaseKey);