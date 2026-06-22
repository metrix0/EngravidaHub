// app/login/page.tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Eye, EyeOff } from "lucide-react";

import { Card } from "@/components";
import { clearCurrentAttendantCache } from "@/lib/attendants/currentAttendantApi";
import { clearCurrentUserCache } from "@/lib/auth/currentUserApi";

export default function LoginPage() {
    function getNextUrl() {
        if (typeof window === "undefined") return "/";

        const params = new URLSearchParams(window.location.search);
        const next = params.get("next");

        if (!next || !next.startsWith("/") || next.startsWith("//")) {
            return "/";
        }

        return next;
    }

    const [supabase] = useState(() =>
        createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                auth: {
                    // The invite hash is handled explicitly below.
                    // Disabling automatic URL detection prevents the same
                    // refresh token from being consumed twice.
                    detectSessionInUrl: false,
                },
            },
        ),
    );

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    const [isInvite, setIsInvite] = useState(false);
    const [inviteReady, setInviteReady] = useState(false);

    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;

        async function handleInviteToken() {
            if (typeof window === "undefined") return;

            const hash = window.location.hash;

            if (!hash.includes("type=invite")) return;

            setIsInvite(true);
            setInviteReady(false);
            setErrorMessage(null);

            const params = new URLSearchParams(hash.replace(/^#/, ""));
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");

            if (!accessToken || !refreshToken) {
                if (isMounted) {
                    setErrorMessage(
                        "Convite inválido ou expirado. Solicite um novo convite.",
                    );
                }
                return;
            }

            const { error: sessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
            });

            if (sessionError) {
                console.error("[login] invite setSession failed", sessionError);

                if (isMounted) {
                    setErrorMessage(
                        "Convite inválido ou expirado. Solicite um novo convite.",
                    );
                }
                return;
            }

            const {
                data: { user },
                error: userError,
            } = await supabase.auth.getUser();

            if (userError || !user) {
                console.error("[login] invite getUser failed", userError);

                if (isMounted) {
                    setErrorMessage(
                        "A sessão do convite expirou. Solicite um novo convite.",
                    );
                }
                return;
            }

            window.history.replaceState(null, "", "/login");

            if (isMounted) {
                setInviteReady(true);
            }
        }

        void handleInviteToken();

        return () => {
            isMounted = false;
        };
    }, [supabase]);

    function resetCachedSessionData() {
        clearCurrentUserCache();
        clearCurrentAttendantCache();
    }

    async function handleLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        setLoading(true);
        setErrorMessage(null);

        const { error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
        });

        if (error) {
            setLoading(false);
            setErrorMessage("Email ou senha inválidos.");
            return;
        }

        resetCachedSessionData();

        // The full navigation mounts CurrentUserProvider once on the protected
        // app. That provider performs the single permissions fetch and then
        // keeps the result in memory/sessionStorage across tab changes.
        window.location.replace(getNextUrl());
    }

    async function handleSetPassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        setLoading(true);
        setErrorMessage(null);

        if (newPassword.length < 6) {
            setLoading(false);
            setErrorMessage("A senha precisa ter pelo menos 6 caracteres.");
            return;
        }

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
            setLoading(false);
            setInviteReady(false);
            setErrorMessage(
                "A sessão do convite expirou. Solicite um novo convite.",
            );
            return;
        }

        const { error } = await supabase.auth.updateUser({
            password: newPassword,
        });

        if (error) {
            console.error("[login] invite updateUser failed", error);

            setLoading(false);

            if (
                error.status === 403 ||
                error.message.toLowerCase().includes("session")
            ) {
                setInviteReady(false);
                setErrorMessage(
                    "A sessão do convite expirou. Solicite um novo convite.",
                );
                return;
            }

            setErrorMessage("Não foi possível criar a senha.");
            return;
        }

        resetCachedSessionData();
        window.location.replace("/");
    }

    if (isInvite) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900">
                <div className="w-full max-w-[420px]">
                    <Card>
                        <form onSubmit={handleSetPassword}>
                            <div className="mb-8">
                                <h1 className="text-2xl font-bold text-slate-950">
                                    Criar senha
                                </h1>

                                <p className="mt-2 text-sm text-slate-500">
                                    Defina uma senha para acessar o Engravida Insights.
                                </p>
                            </div>

                            <label className="block">
                                <span className="mb-2 block text-sm font-semibold text-slate-700">
                                    Nova senha
                                </span>

                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={newPassword}
                                        onChange={(event) => setNewPassword(event.target.value)}
                                        className="h-12 w-full rounded-xl border border-slate-200 px-4 pr-12 text-sm outline-none transition focus:border-brand"
                                        disabled={!inviteReady}
                                        required
                                    />

                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((current) => !current)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </label>

                            {errorMessage ? (
                                <div className="mt-5 rounded-xl bg-red-soft px-4 py-3 text-sm font-medium text-red">
                                    {errorMessage}
                                </div>
                            ) : null}

                            <button
                                type="submit"
                                disabled={loading || !inviteReady}
                                className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loading ? "Salvando..." : "Criar senha"}
                            </button>
                        </form>
                    </Card>
                </div>
            </main>
        );
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900">
            <div className="w-full max-w-[420px]">
                <Card>
                    <form onSubmit={handleLogin}>
                        <div className="mb-8">
                            <h1 className="text-2xl font-bold text-slate-950">
                                Engravida Insights
                            </h1>

                            <p className="mt-2 text-sm text-slate-500">
                                Entre para acessar o dashboard.
                            </p>
                        </div>

                        <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">
                                Email
                            </span>

                            <input
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition focus:border-brand"
                                required
                            />
                        </label>

                        <label className="mt-5 block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">
                                Senha
                            </span>

                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    className="h-12 w-full rounded-xl border border-slate-200 px-4 pr-12 text-sm outline-none transition focus:border-brand"
                                    required
                                />

                                <button
                                    type="button"
                                    onClick={() => setShowPassword((current) => !current)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
                                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </label>

                        {errorMessage ? (
                            <div className="mt-5 rounded-xl bg-red-soft px-4 py-3 text-sm font-medium text-red">
                                {errorMessage}
                            </div>
                        ) : null}

                        <button
                            type="submit"
                            disabled={loading}
                            className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? "Entrando..." : "Entrar"}
                        </button>
                    </form>
                </Card>
            </div>
        </main>
    );
}
