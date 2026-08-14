// app/registrar/confirmar/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

import { Card } from "@/components";

export default function ConfirmRegistrationPage() {
    const [supabase] = useState(() =>
        createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                auth: {
                    detectSessionInUrl: false,
                    flowType: "implicit",
                },
            },
        ),
    );

    const [email, setEmail] = useState("");
    const [resending, setResending] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [resendMessage, setResendMessage] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setEmail(params.get("email")?.trim().toLowerCase() ?? "");

        if (params.get("confirmation_error") === "1") {
            setErrorMessage(
                "O link de confirmação é inválido ou expirou. Solicite um novo email.",
            );
        }
    }, []);

    async function handleResend() {
        if (!email || resending) return;

        setResending(true);
        setErrorMessage(null);
        setResendMessage(null);

        const { error } = await supabase.auth.resend({
            type: "signup",
            email,
        });

        setResending(false);

        if (error) {
            console.error("[registrar/confirmar] resend failed", error);
            setErrorMessage(
                error.status === 429
                    ? "Aguarde um momento antes de solicitar outro email."
                    : "Não foi possível reenviar o email agora.",
            );
            return;
        }

        setResendMessage("Novo email enviado.");
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10 text-slate-900">
            <div className="w-full max-w-[420px]">
                <Card>
                    <div className="mb-8">
                        <h1 className="text-2xl font-bold text-slate-950">
                            Confirme seu email
                        </h1>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                            Enviamos um link de confirmação para{email ? ` ${email}` : " seu email"}. Clique no link recebido para ativar sua conta.
                        </p>
                    </div>

                    {errorMessage ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {errorMessage}
                        </div>
                    ) : null}

                    {resendMessage ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                            {resendMessage}
                        </div>
                    ) : null}

                    <button
                        type="button"
                        onClick={() => void handleResend()}
                        disabled={!email || resending}
                        className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {resending ? "Reenviando..." : "Reenviar email"}
                    </button>

                    <p className="mt-6 text-center text-sm text-slate-500">
                        Email incorreto?{" "}
                        <Link
                            href="/registrar"
                            className="font-semibold text-brand transition hover:opacity-75"
                        >
                            Voltar ao cadastro
                        </Link>
                    </p>
                </Card>
            </div>
        </main>
    );
}
