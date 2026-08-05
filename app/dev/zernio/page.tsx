// app/dev/zernio/page.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    ArrowLeft,
    Check,
    CircleAlert,
    ExternalLink,
    LoaderCircle,
    RefreshCw,
    Webhook,
} from "lucide-react";
import { FaFacebookF, FaInstagram } from "react-icons/fa6";

type ZernioProfile = {
    _id: string;
    name: string;
    isDefault?: boolean;
};

type ZernioAccount = {
    _id: string;
    platform: string;
    username: string | null;
    displayName: string | null;
    isActive: boolean;
    profileId:
        | string
        | {
              _id?: string;
              name?: string;
          }
        | null;
};

type ZernioWebhook = {
    _id: string;
    url: string;
    isActive: boolean;
    failureCount?: number;
};

type ZernioStatusResponse = {
    ok: boolean;
    configured?: boolean;
    profiles?: ZernioProfile[];
    accounts?: ZernioAccount[];
    webhook?: ZernioWebhook | null;
    redirect_url?: string;
    webhook_url?: string;
    error?: string;
};

export default function DevZernioPage() {
    return (
        <Suspense fallback={<ZernioPageLoading />}>
            <DevZernioPageContent />
        </Suspense>
    );
}

function DevZernioPageContent() {
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<ZernioStatusResponse | null>(null);
    const [profileId, setProfileId] = useState("");
    const [loading, setLoading] = useState(true);
    const [action, setAction] = useState<
        | "connect_instagram"
        | "connect_facebook"
        | "webhook"
        | "refresh"
        | null
    >(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(() => {
        const connected = searchParams.get("connected");
        if (connected === "instagram") {
            return "Instagram conectado ao Zernio.";
        }
        if (connected === "facebook") {
            return "Facebook Messenger conectado ao Zernio.";
        }
        return null;
    });

    const loadStatus = useCallback(async () => {
        const response = await fetch("/api/dev/zernio", {
            credentials: "include",
            cache: "no-store",
        });
        const payload = (await response.json()) as ZernioStatusResponse;

        if (!response.ok || !payload.ok) {
            throw new Error(
                payload.error ?? "Não foi possível consultar o Zernio.",
            );
        }

        setStatus(payload);
        setProfileId((current) => {
            if (
                current &&
                payload.profiles?.some((profile) => profile._id === current)
            ) {
                return current;
            }

            return (
                payload.profiles?.find((profile) => profile.isDefault)?._id ??
                payload.profiles?.[0]?._id ??
                ""
            );
        });
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            void loadStatus()
                .catch((loadError) => {
                    setError(
                        loadError instanceof Error
                            ? loadError.message
                            : "Não foi possível consultar o Zernio.",
                    );
                })
                .finally(() => setLoading(false));
        }, 0);

        return () => window.clearTimeout(timeoutId);
    }, [loadStatus]);

    const connectedAccounts = useMemo(
        () => status?.accounts?.filter((account) => account.isActive) ?? [],
        [status?.accounts],
    );

    async function runAction(
        nextAction:
            | "connect_instagram"
            | "connect_facebook"
            | "webhook"
            | "refresh",
    ) {
        if (action) return;

        setAction(nextAction);
        setError(null);
        setSuccess(null);

        try {
            if (nextAction === "refresh") {
                await loadStatus();
                setSuccess("Status atualizado.");
                return;
            }

            const response = await fetch("/api/dev/zernio", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    nextAction === "connect_instagram" ||
                        nextAction === "connect_facebook"
                        ? {
                              action: "connect_account",
                              platform:
                                  nextAction === "connect_facebook"
                                      ? "facebook"
                                      : "instagram",
                              profile_id: profileId,
                          }
                        : { action: "ensure_webhook" },
                ),
            });
            const payload = (await response.json()) as {
                ok?: boolean;
                auth_url?: string;
                error?: string;
            };

            if (!response.ok || !payload.ok) {
                throw new Error(
                    payload.error ?? "Não foi possível concluir a ação.",
                );
            }

            if (
                nextAction === "connect_instagram" ||
                nextAction === "connect_facebook"
            ) {
                if (!payload.auth_url) {
                    throw new Error(
                        "O Zernio não retornou a URL de conexão.",
                    );
                }

                window.location.assign(payload.auth_url);
                return;
            }

            await loadStatus();
            setSuccess("Webhook social configurado.");
        } catch (actionError) {
            setError(
                actionError instanceof Error
                    ? actionError.message
                    : "Não foi possível concluir a ação.",
            );
        } finally {
            setAction(null);
        }
    }

    return (
        <main className="h-full overflow-y-auto bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">
                <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-pink">
                            <FaInstagram size={15} />
                            <FaFacebookF size={15} />
                            Ferramenta de desenvolvedor
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                            Instagram e Facebook Messenger via Zernio
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                            Conecte as contas sociais e registre o webhook que
                            entrega as mensagens no Inbox.
                        </p>
                    </div>

                    <Link
                        href="/inbox"
                        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
                    >
                        <ArrowLeft size={16} />
                        Voltar ao Inbox
                    </Link>
                </header>

                {(error || success) && (
                    <div className="mb-5">
                        {error && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                                <CircleAlert
                                    size={17}
                                    className="mt-0.5 shrink-0"
                                />
                                {error}
                            </div>
                        )}
                        {success && (
                            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                                <Check size={17} />
                                {success}
                            </div>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <LoaderCircle
                            size={28}
                            className="animate-spin text-brand"
                        />
                    </div>
                ) : (
                    <div className="grid gap-5 lg:grid-cols-2">
                        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="mb-5 flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-950">
                                        Conexão
                                    </h2>
                                    <p className="mt-1 text-sm leading-6 text-slate-500">
                                        O OAuth acontece no Zernio. Nenhuma
                                        senha das redes sociais passa pelo Hub.
                                    </p>
                                </div>
                                <StatusDot
                                    active={connectedAccounts.length > 0}
                                    label={
                                        connectedAccounts.length > 0
                                            ? "Conectado"
                                            : "Pendente"
                                    }
                                />
                            </div>

                            {!status?.configured ? (
                                <MissingConfiguration message="Adicione ZERNIO_API_KEY antes de conectar a conta." />
                            ) : (
                                <>
                                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                        Perfil do Zernio
                                    </label>
                                    <select
                                        value={profileId}
                                        onChange={(event) =>
                                            setProfileId(event.target.value)
                                        }
                                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-brand/60 focus:ring-4 focus:ring-brand/10"
                                    >
                                        {(status.profiles ?? []).map(
                                            (profile) => (
                                                <option
                                                    key={profile._id}
                                                    value={profile._id}
                                                >
                                                    {profile.name}
                                                </option>
                                            ),
                                        )}
                                    </select>

                                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                void runAction(
                                                    "connect_instagram",
                                                )
                                            }
                                            disabled={
                                                !profileId || Boolean(action)
                                            }
                                            className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-pink px-4 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                                        >
                                            {action ===
                                            "connect_instagram" ? (
                                                <LoaderCircle
                                                    size={17}
                                                    className="animate-spin"
                                                />
                                            ) : (
                                                <FaInstagram size={17} />
                                            )}
                                            Conectar Instagram
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() =>
                                                void runAction(
                                                    "connect_facebook",
                                                )
                                            }
                                            disabled={
                                                !profileId || Boolean(action)
                                            }
                                            className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                                        >
                                            {action ===
                                            "connect_facebook" ? (
                                                <LoaderCircle
                                                    size={17}
                                                    className="animate-spin"
                                                />
                                            ) : (
                                                <FaFacebookF
                                                    size={17}
                                                />
                                            )}
                                            Conectar Messenger
                                        </button>
                                    </div>
                                </>
                            )}
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="mb-5 flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-950">
                                        Recebimento
                                    </h2>
                                    <p className="mt-1 text-sm leading-6 text-slate-500">
                                        O webhook recebe novas mensagens e as
                                        coloca na fila normal do Inbox.
                                    </p>
                                </div>
                                <StatusDot
                                    active={Boolean(status?.webhook?.isActive)}
                                    label={
                                        status?.webhook?.isActive
                                            ? "Ativo"
                                            : "Pendente"
                                    }
                                />
                            </div>

                            <>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                        Endpoint
                                    </div>
                                    <div className="mt-1 break-all text-sm font-medium text-slate-700">
                                        {status?.webhook_url}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() =>
                                        void runAction("webhook")
                                    }
                                    disabled={
                                        !status?.configured ||
                                        Boolean(action)
                                    }
                                    className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                                >
                                    {action === "webhook" ? (
                                        <LoaderCircle
                                            size={17}
                                            className="animate-spin"
                                        />
                                    ) : (
                                        <Webhook size={17} />
                                    )}
                                    Configurar webhook
                                </button>
                            </>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-950">
                                        Contas conectadas
                                    </h2>
                                    <p className="mt-1 text-sm text-slate-500">
                                        Contas do Instagram e Facebook
                                        disponíveis para receber e responder.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void runAction("refresh")}
                                    disabled={Boolean(action)}
                                    className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <RefreshCw
                                        size={15}
                                        className={
                                            action === "refresh"
                                                ? "animate-spin"
                                                : ""
                                        }
                                    />
                                    Atualizar
                                </button>
                            </div>

                            {connectedAccounts.length > 0 ? (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {connectedAccounts.map((account) => (
                                        <div
                                            key={`${account.platform}:${account._id}`}
                                            className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3"
                                        >
                                            <div className="flex min-w-0 items-center gap-3">
                                                <span
                                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                                        account.platform ===
                                                        "facebook"
                                                            ? "bg-blue-50 text-blue-600"
                                                            : "bg-pink-soft text-pink"
                                                    }`}
                                                >
                                                    {account.platform ===
                                                    "facebook" ? (
                                                        <FaFacebookF
                                                            size={18}
                                                        />
                                                    ) : (
                                                        <FaInstagram size={18} />
                                                    )}
                                                </span>
                                                <div className="min-w-0">
                                                    <div className="truncate font-bold text-slate-800">
                                                        {account.displayName ??
                                                            account.username ??
                                                        (account.platform ===
                                                        "facebook"
                                                            ? "Facebook Messenger"
                                                            : "Instagram")}
                                                    </div>
                                                    <div className="truncate text-xs text-slate-500">
                                                        {formatUsername(
                                                            account.username,
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <Check
                                                size={17}
                                                className="shrink-0 text-emerald-600"
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500">
                                    Nenhuma conta social ativa encontrada.
                                </div>
                            )}

                            <a
                                href="https://zernio.com/dashboard"
                                target="_blank"
                                rel="noreferrer"
                                className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-brand hover:underline"
                            >
                                Abrir painel do Zernio
                                <ExternalLink size={14} />
                            </a>
                        </section>
                    </div>
                )}
            </div>
        </main>
    );
}

function ZernioPageLoading() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50">
            <LoaderCircle size={28} className="animate-spin text-brand" />
        </main>
    );
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
    return (
        <span
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                active
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
            }`}
        >
            <span
                className={`h-2 w-2 rounded-full ${
                    active ? "bg-emerald-500" : "bg-amber-500"
                }`}
            />
            {label}
        </span>
    );
}

function MissingConfiguration({ message }: { message: string }) {
    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-6 text-amber-800">
            {message}
        </div>
    );
}

function formatUsername(value: string | null) {
    if (!value?.trim()) return "Usuário não informado";
    return value.startsWith("@") ? value : `@${value}`;
}
