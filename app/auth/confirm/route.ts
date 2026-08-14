// app/auth/confirm/route.ts
import { NextRequest, NextResponse } from "next/server";

import { createServerAuthClient } from "@/lib/auth/getCurrentAuthUser";

export async function GET(request: NextRequest) {
    const tokenHash = request.nextUrl.searchParams.get("token_hash");
    const type = request.nextUrl.searchParams.get("type");
    const redirectUrl = new URL("/registrar/confirmar", request.url);

    if (!tokenHash || type !== "email") {
        redirectUrl.searchParams.set("confirmation_error", "1");
        return NextResponse.redirect(redirectUrl);
    }

    const supabase = await createServerAuthClient();
    const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email",
    });

    if (error) {
        console.error("[auth/confirm] email verification failed", error);
        redirectUrl.searchParams.set("confirmation_error", "1");
        return NextResponse.redirect(redirectUrl);
    }

    await supabase.auth.signOut();

    redirectUrl.searchParams.set("confirmed", "1");
    return NextResponse.redirect(redirectUrl);
}
