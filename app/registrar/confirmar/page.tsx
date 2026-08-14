// app/registrar/confirmar/page.tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { CheckCircle2 } from "lucide-react";

import { Card } from "@/components";

export default function ConfirmRegistrationPage() {
    const [supabase] = useState(() =>
        createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                auth: {
                    detectSessionInUrl: false,
                },
            },
        ),
    );

    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [confirmed, setConfirmed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [resendMessage, setResendMessage] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setEmail(params.get("email")?.trim().toLowerCase() ?? "");
        setConfirmed(params.get("confirmed") === "1");

        if (params.get("confirmation_error") === "1") {
            setErrorMessage(
                "O link de confirmação é inválido ou expirou. Digite o código recebido por email ou solicite um novo.",
            );
        }
    }, []);

    async function handleVerify(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const normalizedCode = code.replace(/\s/g, "");
        setErrorMessage(null);
        setResendMessage(null);

        if (!email) {
            setErrorMessage("Email não encontrado. Volte ao cadastro e tente novamente.");
            return;
        }

        if (!normalizedCode) {
            setErrorMessage("Informe o código enviado por email.");
            return;
        }

        setLoading(true);

        const { error } = await supabase.auth.verifyOtp({
            email,
            token: normalizedCode,
            type: "email",
        });

        if (error) {
            setLoading(false);
            setErrorMessage("Código inválido ou expirado.");
            return;
        }

        await supabase.auth.signOut();
        setLoading(false);
        setConfirmed(true);
        window.history.replaceState(null, "", "/registrar/confirmar?confirmed=1");
    }

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
                    ? "Aguarde um momento antes de solicitar outro código."
                    : "Não foi possível reenviar o email agora.",
            );
            return;
        }

        setResendMessage("Novo código enviado.");
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10 text-slate-900">
            <div className="w-full max-w-[420px]">
                <Card>
                    {confirmed ? (
                        <div>
                            <div className="mb-8">
                                <h1 className="text-2xl font-bold text-slate-950">
                                    Email confirmado
                                </h1>
                                <p className="mt-2 text-sm text-slate-500">
                                    Sua conta está pronta para entrar.
                                </p>
                            </div>

                            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
                                <span>Email confirmado com sucesso.</span>
                            </div>

                            <Link
                                href="/login"
                                className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90"
                            >
                                Ir para o login
                            </Link>
                        </div>
                    ) : (
                        <div>
                            <div className="mb-8">
                                <h1 className="text-2xl font-bold text-slate-950">
                                    Confirme seu email
                                </h1>
                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                    Digite o código enviado para{email ? ` ${email}` : " seu email"} ou clique no link de confirmação recebido.
                                </p>
                            </div>

                            <form onSubmit={handleVerify}>
                                <label className="block">
                                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                                        Código de confirmação
                                    </span>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        value={code}
                                        onChange={(event) => setCode(event.target.value)}
                                        className="h-12 w-full rounded-xl border border-slate-200 px-4 text-center text-lg font-semibold tracking-[0.2em] outline-none transition focus:border-brand"
                                        required
                                        autoFocus
                                    />
                                </label>

                                {errorMessage ? (
                                    <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                        {errorMessage}
                                    </div>
                                ) : null}

                                {resendMessage ? (
                                    <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                        {resendMessage}
                                    </div>
                                ) : null}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {loading ? "Confirmando..." : "Confirmar email"}
                                </button>
                            </form>

                            <button
                                type="button"
                                onClick={() => void handleResend()}
                                disabled={!email || resending}
                                className="mt-4 w-full cursor-pointer text-center text-sm font-semibold text-brand transition hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {resending ? "Reenviando..." : "Reenviar código"}
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
                        </div>
                    )}
                </Card>
            </div>
        </main>
    );
}
