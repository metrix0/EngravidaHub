// app/registrar/page.tsx
"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { Eye, EyeOff } from "lucide-react";

import { Card } from "@/components";

export default function RegisterPage() {
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

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function handleRegister(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const normalizedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();

        setErrorMessage(null);

        if (!normalizedName) {
            setErrorMessage("Informe seu nome.");
            return;
        }

        if (!normalizedEmail) {
            setErrorMessage("Informe seu email.");
            return;
        }

        if (password.length < 6) {
            setErrorMessage("A senha precisa ter pelo menos 6 caracteres.");
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage("As senhas não coincidem.");
            return;
        }

        setLoading(true);

        const { error } = await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
                data: {
                    name: normalizedName,
                },
            },
        });

        if (error) {
            setLoading(false);
            console.error("[registrar] signup failed", error);
            setErrorMessage(
                error.status === 429
                    ? "Aguarde um momento antes de tentar novamente."
                    : "Não foi possível criar a conta agora. Verifique os dados e tente novamente.",
            );
            return;
        }

        window.location.replace(
            `/registrar/confirmar?email=${encodeURIComponent(normalizedEmail)}`,
        );
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10 text-slate-900">
            <div className="w-full max-w-[420px]">
                <Card>
                    <div className="mb-8">
                        <h1 className="text-2xl font-bold text-slate-950">
                            Criar conta
                        </h1>

                        <p className="mt-2 text-sm text-slate-500">
                            Cadastre-se para acessar o Engravida Hub.
                        </p>
                    </div>

                    <form onSubmit={handleRegister}>
                        <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">
                                Nome
                            </span>
                            <input
                                type="text"
                                value={name}
                                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    setName(event.target.value)
                                }
                                className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition focus:border-brand"
                                autoComplete="name"
                                required
                            />
                        </label>

                        <label className="mt-5 block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">
                                Email
                            </span>
                            <input
                                type="email"
                                value={email}
                                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    setEmail(event.target.value)
                                }
                                className="h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition focus:border-brand"
                                autoComplete="email"
                                required
                            />
                        </label>

                        <PasswordField
                            label="Senha"
                            value={password}
                            onChange={setPassword}
                            showPassword={showPassword}
                            onTogglePassword={() =>
                                setShowPassword((current) => !current)
                            }
                            autoComplete="new-password"
                        />

                        <PasswordField
                            label="Confirmar senha"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            showPassword={showPassword}
                            onTogglePassword={() =>
                                setShowPassword((current) => !current)
                            }
                            autoComplete="new-password"
                        />

                        {errorMessage ? (
                            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                {errorMessage}
                            </div>
                        ) : null}

                        <button
                            type="submit"
                            disabled={loading}
                            className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-brand font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? "Criando conta..." : "Criar conta"}
                        </button>

                        <p className="mt-6 text-center text-sm text-slate-500">
                            Já possui uma conta?{" "}
                            <Link
                                href="/login"
                                className="font-semibold text-brand transition hover:opacity-75"
                            >
                                Entrar
                            </Link>
                        </p>
                    </form>
                </Card>
            </div>
        </main>
    );
}

function PasswordField({
    label,
    value,
    onChange,
    showPassword,
    onTogglePassword,
    autoComplete,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    showPassword: boolean;
    onTogglePassword: () => void;
    autoComplete: string;
}) {
    return (
        <label className="mt-5 block">
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
                    autoComplete={autoComplete}
                    required
                />

                <button
                    type="button"
                    tabIndex={-1}
                    onClick={onTogglePassword}
                    className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 transition hover:text-slate-600"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
            </div>
        </label>
    );
}
