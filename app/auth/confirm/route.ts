// app/auth/confirm/route.ts
import { NextRequest, NextResponse } from "next/server";

import { createServerAuthClient } from "@/lib/auth/getCurrentAuthUser";

function confirmationErrorRedirect(request: NextRequest) {
    const redirectUrl = new URL("/registrar/confirmar", request.url);
    redirectUrl.searchParams.set("confirmation_error", "1");
    return NextResponse.redirect(redirectUrl);
}

export async function GET(request: NextRequest) {
    const code = request.nextUrl.searchParams.get("code");
    const tokenHash = request.nextUrl.searchParams.get("token_hash");
    const type = request.nextUrl.searchParams.get("type");

    const supabase = await createServerAuthClient();

    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            console.error("[auth/confirm] code exchange failed", error);
            return confirmationErrorRedirect(request);
        }

        return NextResponse.redirect(new URL("/", request.url));
    }

    if (!tokenHash || type !== "email") {
        return confirmationErrorRedirect(request);
    }

    if (tokenHash.startsWith("pkce_")) {
        const verifyUrl = new URL(
            "/auth/v1/verify",
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
        );
        verifyUrl.searchParams.set("token", tokenHash);
        verifyUrl.searchParams.set("type", "signup");
        verifyUrl.searchParams.set(
            "redirect_to",
            new URL("/auth/confirm", request.url).toString(),
        );

        return NextResponse.redirect(verifyUrl);
    }

    const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email",
    });

    if (error) {
        console.error("[auth/confirm] email verification failed", error);
        return confirmationErrorRedirect(request);
    }

    return NextResponse.redirect(new URL("/", request.url));
}
