// app/login/page.tsx
"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";

import { Card } from "@/components";
import { clearCurrentAttendantCache } from "@/lib/attendants/currentAttendantApi";
import { clearCurrentUserCache } from "@/lib/auth/currentUserApi";

type PasswordFlow = "invite" | "recovery";
type LoginMode = "login" | "forgot-password";

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
                    // Invite and recovery hashes are handled explicitly below.
                    // Disabling automatic URL detection prevents the same
                    // refresh token from being consumed twice.
                    detectSessionInUrl: false,
                },
            },
        ),
    );

    const [mode, setMode] = useState<LoginMode>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    const [passwordFlow, setPasswordFlow] =
        useState<PasswordFlow | null>(null);
    const [passwordFlowReady, setPasswordFlowReady] = useState(false);

    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;

        async function handleEmailToken() {
            if (typeof window === "undefined") return;

            const searchParams = new URLSearchParams(window.location.search);
            if (searchParams.get("mode") === "forgot-password") {
                setMode("forgot-password");
            }

            const queryType = searchParams.get("type");
            const tokenHash = searchParams.get("token_hash");
            const queryFlow =
                queryType === "invite" || queryType === "recovery"
                    ? queryType
                    : null;

            if (queryFlow && tokenHash) {
                setPasswordFlow(queryFlow);
                setPasswordFlowReady(false);
                setErrorMessage(null);
                setSuccessMessage(null);
                window.history.replaceState(null, "", "/login");

                const { error: verifyError } = await supabase.auth.verifyOtp({
                    token_hash: tokenHash,
                    type: queryFlow,
                });

                if (verifyError) {
                    console.error("[login] email token verifyOtp failed", {
                        flow: queryFlow,
                        error: verifyError,
                    });

                    if (isMounted) {
                        setErrorMessage(getExpiredFlowMessage(queryFlow));
                    }
                    return;
                }

                const {
                    data: { user },
                    error: userError,
                } = await supabase.auth.getUser();

                if (userError || !user) {
                    console.error("[login] verified token getUser failed", {
                        flow: queryFlow,
                        error: userError,
                    });

                    if (isMounted) {
                        setErrorMessage(getExpiredFlowMessage(queryFlow));
                    }
                    return;
                }

                if (isMounted) {
                    setPasswordFlowReady(true);
                }
                return;
            }

            const hash = window.location.hash;
            if (!hash) return;

            const params = new URLSearchParams(hash.replace(/^#/, ""));
            const type = params.get("type");
            const flow =
                type === "invite" || type === "recovery" ? type : null;

            if (!flow) {
                const authError = params.get("error_description");
                if (authError && isMounted) {
                    setErrorMessage(
                        "O link de acesso é inválido ou expirou. Solicite um novo email.",
                    );
                    window.history.replaceState(null, "", "/login");
                }
                return;
            }

            setPasswordFlow(flow);
            setPasswordFlowReady(false);
            setErrorMessage(null);
            setSuccessMessage(null);

            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");
            window.history.replaceState(null, "", "/login");

            if (!accessToken || !refreshToken) {
                if (isMounted) {
                    setErrorMessage(getExpiredFlowMessage(flow));
                }
                return;
            }

            const { error: sessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
            });

            if (sessionError) {
                console.error("[login] email token setSession failed", {
                    flow,
                    error: sessionError,
                });

                if (isMounted) {
                    setErrorMessage(getExpiredFlowMessage(flow));
                }
                return;
            }

            const {
                data: { user },
                error: userError,
            } = await supabase.auth.getUser();

            if (userError || !user) {
                console.error("[login] email token getUser failed", {
                    flow,
                    error: userError,
                });

                if (isMounted) {
                    setErrorMessage(getExpiredFlowMessage(flow));
                }
                return;
            }

            window.history.replaceState(null, "", "/login");

            if (isMounted) {
                setPasswordFlowReady(true);
            }
        }

        void handleEmailToken();

        return () => {
            isMounted = false;
        };
    }, [supabase]);

    function resetCachedSessionData() {
        clearCurrentUserCache();
        clearCurrentAttendantCache();
    }

    function resetFeedback() {
        setErrorMessage(null);
        setSuccessMessage(null);
    }

    async function handleLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        setLoading(true);
        resetFeedback();

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

    async function handleForgotPassword(
        event: FormEvent<HTMLFormElement>,
    ) {
        event.preventDefault();

        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) {
            setErrorMessage("Informe seu email.");
            return;
        }

        setLoading(true);
        resetFeedback();

        const { error } =
            await supabase.auth.resetPasswordForEmail(normalizedEmail);

        setLoading(false);

        if (error) {
            console.error("[login] password recovery email failed", error);
            setErrorMessage(
                error.status === 429
                    ? "Aguarde um momento antes de solicitar outro email."
                    : "Não foi possível enviar o email agora. Tente novamente.",
            );
            return;
        }

        setSuccessMessage(
            "Se existir uma conta com este email, você receberá um link para redefinir sua senha.",
        );
    }

    async function handleSetPassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!passwordFlow) return;

        setLoading(true);
        resetFeedback();

        if (newPassword.length < 6) {
            setLoading(false);
            setErrorMessage("A senha precisa ter pelo menos 6 caracteres.");
            return;
        }

        if (
            passwordFlow === "recovery" &&
            newPassword !== confirmPassword
        ) {
            setLoading(false);
            setErrorMessage("As senhas não coincidem.");
            return;
        }

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
            setLoading(false);
            setPasswordFlowReady(false);
            setErrorMessage(getExpiredFlowMessage(passwordFlow));
            return;
        }

        const { error } = await supabase.auth.updateUser({
            password: newPassword,
        });

        if (error) {
            console.error("[login] password update failed", {
                flow: passwordFlow,
                error,
            });

            setLoading(false);

            if (
                error.status === 403 ||
                error.message.toLowerCase().includes("session")
            ) {
                setPasswordFlowReady(false);
                setErrorMessage(getExpiredFlowMessage(passwordFlow));
                return;
            }

            setErrorMessage(
                passwordFlow === "invite"
                    ? "Não foi possível criar a senha."
                    : "Não foi possível redefinir a senha.",
            );
            return;
        }

        resetCachedSessionData();
        window.location.replace("/");
    }

    function openForgotPassword() {
        resetFeedback();
        setMode("forgot-password");
    }

    function returnToLogin() {
        resetFeedback();
        setMode("login");
    }

    if (passwordFlow) {
        const isRecovery = passwordFlow === "recovery";

        return (
            <AuthPage>
                <form onSubmit={handleSetPassword}>
                    <div className="mb-8">
                        <h1 className="text-2xl font-bold text-slate-950">
                            {isRecovery ? "Redefinir senha" : "Criar senha"}
                        </h1>

                        <p className="mt-2 text-sm text-slate-500">
                            {isRecovery
                                ? "Escolha uma nova senha para sua conta."
                                : "Defina uma senha para acessar o Engravida Hub."}
                        </p>
                    </div>

                    <PasswordField
                        label="Nova senha"
                        value={newPassword}
                        onChange={setNewPassword}
                        showPassword={showPassword}
                        onTogglePassword={() =>
                            setShowPassword((current) => !current)
                        }
                        disabled={!passwordFlowReady}
                    />

                    {isRecovery ? (
                        <div className="mt-5">
                            <PasswordField
                                label="Confirmar nova senha"
                                value={confirmPassword}
                                onChange={setConfirmPassword}
                                showPassword={showPassword}
                                onTogglePassword={() =>
                                    setShowPassword((current) => !current)
                                }
                                disabled={!passwordFlowReady}
                            />
                        </div>
                    ) : null}

                    <FeedbackMessage
                        errorMessage={errorMessage}
                        successMessage={successMessage}
                    />

                    <button
                        type="submit"
                        disabled={loading || !passwordFlowReady}
                        className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {loading
                            ? "Salvando..."
                            : isRecovery
                              ? "Salvar nova senha"
                              : "Criar senha"}
                    </button>
                </form>
            </AuthPage>
        );
    }

    if (mode === "forgot-password") {
        return (
            <AuthPage>
                <form onSubmit={handleForgotPassword}>
                    <button
                        type="button"
                        onClick={returnToLogin}
                        className="mb-6 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-brand"
                    >
                        <ArrowLeft size={16} />
                        Voltar para o login
                    </button>

                    <div className="mb-8">
                        <h1 className="text-2xl font-bold text-slate-950">
                            Esqueci minha senha
                        </h1>

                        <p className="mt-2 text-sm text-slate-500">
                            Informe seu email para receber o link de redefinição.
                        </p>
                    </div>

                    <EmailField value={email} onChange={setEmail} />

                    <FeedbackMessage
                        errorMessage={errorMessage}
                        successMessage={successMessage}
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {loading ? "Enviando..." : "Enviar link"}
                    </button>
                </form>
            </AuthPage>
        );
    }

    return (
        <AuthPage>
            <form onSubmit={handleLogin}>
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-slate-950">
                        Engravida Hub
                    </h1>

                    <p className="mt-2 text-sm text-slate-500">
                        Entre para acessar o dashboard.
                    </p>
                </div>

                <EmailField value={email} onChange={setEmail} />

                <label className="mt-5 block">
                    <div className="mb-2 flex items-center justify-between gap-4">
                        <span className="text-sm font-semibold text-slate-700">
                            Senha
                        </span>

                        <button
                            type="button"
                            tabIndex={-1}
                            onClick={openForgotPassword}
                            className="cursor-pointer text-sm font-semibold text-brand transition hover:opacity-75"
                        >
                            Esqueci minha senha
                        </button>
                    </div>

                    <div className="relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                setPassword(event.target.value)
                            }
                            className="h-12 w-full rounded-xl border border-slate-200 px-4 pr-12 text-sm outline-none transition focus:border-brand"
                            autoComplete="current-password"
                            required
                        />

                        <PasswordVisibilityButton
                            showPassword={showPassword}
                            onToggle={() =>
                                setShowPassword((current) => !current)
                            }
                        />
                    </div>
                </label>

                <FeedbackMessage
                    errorMessage={errorMessage}
                    successMessage={successMessage}
                />

                <button
                    type="submit"
                    disabled={loading}
                    className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {loading ? "Entrando..." : "Entrar"}
                </button>
            </form>
        </AuthPage>
    );
}

function AuthPage({ children }: { children: ReactNode }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900">
            <div className="w-full max-w-[420px]">
                <Card>{children}</Card>
            </div>
        </main>
    );
}

function EmailField({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
                Email
            </span>

            <input
                type="email"
                value={value}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onChange(event.target.value)
                }
                className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition focus:border-brand"
                autoComplete="email"
                required
            />
        </label>
    );
}

function PasswordField({
    label,
    value,
    onChange,
    showPassword,
    onTogglePassword,
    disabled,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    showPassword: boolean;
    onTogglePassword: () => void;
    disabled: boolean;
}) {
    return (
        <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
                {label}
            </span>

            <div className="relative">
                <input
                    type={showPassword ? "text" : "password"}
                    value={value}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onChange(event.target.value)
                }
                    className="h-12 w-full rounded-xl border border-slate-200 px-4 pr-12 text-sm outline-none transition focus:border-brand"
                    autoComplete="new-password"
                    disabled={disabled}
                    minLength={6}
                    required
                />

                <PasswordVisibilityButton
                    showPassword={showPassword}
                    onToggle={onTogglePassword}
                />
            </div>
        </label>
    );
}

function PasswordVisibilityButton({
    showPassword,
    onToggle,
}: {
    showPassword: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 transition hover:text-slate-700"
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
        >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
    );
}

function FeedbackMessage({
    errorMessage,
    successMessage,
}: {
    errorMessage: string | null;
    successMessage: string | null;
}) {
    if (errorMessage) {
        return (
            <div className="mt-5 rounded-xl bg-red-soft px-4 py-3 text-sm font-medium text-red">
                {errorMessage}
            </div>
        );
    }

    if (successMessage) {
        return (
            <div className="mt-5 rounded-xl bg-green-soft px-4 py-3 text-sm font-medium text-green">
                {successMessage}
            </div>
        );
    }

    return null;
}

function getExpiredFlowMessage(flow: PasswordFlow) {
    return flow === "invite"
        ? "Convite inválido ou expirado. Solicite um novo convite."
        : "Link de redefinição inválido ou expirado. Solicite um novo email.";
}
