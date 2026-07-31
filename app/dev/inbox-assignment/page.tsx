// app/dev/inbox-assignment/page.tsx
"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
    ArrowLeft,
    Check,
    ExternalLink,
    LoaderCircle,
    Search,
    ShieldAlert,
    UserCheck,
    Users,
} from "lucide-react";

import { ConversationChannelBadge } from "@/components/conversations/ConversationChannelBadge";

type AssignmentStatus = "unassigned" | "mine" | "other";
type AssignmentChannel = "WhatsApp" | "Instagram";

type CurrentAttendant = {
    id: string;
    name: string;
    email: string | null;
    active: boolean;
    is_online: boolean;
};

type SearchItem = {
    id: string;
    client_id: string | null;
    instagram_user_id: string | null;
    channel: AssignmentChannel;
    name: string;
    username: string | null;
    profile_picture_url: string | null;
    phone: string | null;
    email: string | null;
    preview: string;
    last_message_at: string | null;
    queued_at: string | null;
    claimed_at: string | null;
    assigned_attendant_id: string | null;
    assigned_attendant_name: string | null;
    assignment_status: AssignmentStatus;
};

type SearchResponse = {
    ok: boolean;
    current_attendant?: CurrentAttendant;
    items?: SearchItem[];
    error?: string;
};

type AssignmentResponse = {
    ok: boolean;
    already_assigned?: boolean;
    item?: SearchItem;
    requires_confirmation?: boolean;
    assigned_to?: string | null;
    error?: string;
};

export default function DevInboxAssignmentPage() {
    const [search, setSearch] = useState("");
    const [submittedSearch, setSubmittedSearch] = useState("");
    const [items, setItems] = useState<SearchItem[]>([]);
    const [currentAttendant, setCurrentAttendant] =
        useState<CurrentAttendant | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [assigningThreadId, setAssigningThreadId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    async function handleSearch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const normalizedSearch = search.trim();
        if (normalizedSearch.length < 3 || isSearching) return;

        setIsSearching(true);
        setError(null);
        setSuccess(null);
        setSubmittedSearch(normalizedSearch);

        try {
            const response = await fetch(
                `/api/dev/inbox-assignment?search=${encodeURIComponent(normalizedSearch)}`,
                {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                },
            );
            const payload = (await response.json()) as SearchResponse;

            if (!response.ok || !payload.ok) {
                throw new Error(payload.error ?? "Não foi possível buscar as conversas.");
            }

            setCurrentAttendant(payload.current_attendant ?? null);
            setItems(payload.items ?? []);
        } catch (searchError) {
            setItems([]);
            setError(
                searchError instanceof Error
                    ? searchError.message
                    : "Não foi possível buscar as conversas.",
            );
        } finally {
            setIsSearching(false);
        }
    }

    async function assignConversation(item: SearchItem, force = false) {
        if (assigningThreadId) return;

        setAssigningThreadId(item.id);
        setError(null);
        setSuccess(null);

        try {
            const response = await fetch("/api/dev/inbox-assignment", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    thread_id: item.id,
                    force,
                }),
            });
            const payload = (await response.json()) as AssignmentResponse;

            if (
                response.status === 409 &&
                payload.requires_confirmation &&
                !force
            ) {
                const confirmed = window.confirm(
                    `${payload.error ?? "Esta conversa já está atribuída."}\n\nDeseja reatribuir para você?`,
                );

                if (confirmed) {
                    setAssigningThreadId(null);
                    await assignConversation(item, true);
                }
                return;
            }

            if (!response.ok || !payload.ok || !payload.item) {
                throw new Error(payload.error ?? "Não foi possível atribuir a conversa.");
            }

            setItems((currentItems) =>
                currentItems.map((currentItem) =>
                    currentItem.id === payload.item!.id ? payload.item! : currentItem,
                ),
            );
            setSuccess(
                payload.already_assigned
                    ? `${payload.item.name} já estava atribuída a você.`
                    : `${payload.item.name} foi atribuída a você.`,
            );
        } catch (assignmentError) {
            setError(
                assignmentError instanceof Error
                    ? assignmentError.message
                    : "Não foi possível atribuir a conversa.",
            );
        } finally {
            setAssigningThreadId(null);
        }
    }

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand">
                            <ShieldAlert size={15} />
                            Ferramenta de desenvolvedor
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                            Atribuir conversa específica
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                            Pesquise uma conversa aberta do WhatsApp ou Instagram e atribua-a ao atendente logado.
                        </p>
                    </div>

                    <Link
                        href="/inbox"
                        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
                    >
                        <ArrowLeft size={16} />
                        Voltar ao Inbox
                    </Link>
                </div>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 p-5 sm:p-6">
                        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
                            <div className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-sm focus-within:border-brand/60 focus-within:ring-4 focus-within:ring-brand/10">
                                <Search size={18} className="shrink-0 text-slate-400" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Telefone, nome ou @usuário do Instagram"
                                    autoFocus
                                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={search.trim().length < 3 || isSearching}
                                className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                            >
                                {isSearching ? (
                                    <LoaderCircle size={18} className="animate-spin" />
                                ) : (
                                    <Search size={18} />
                                )}
                                {isSearching ? "Buscando..." : "Buscar"}
                            </button>
                        </form>

                        {currentAttendant && (
                            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                                <UserCheck size={16} className="text-brand" />
                                Atribuindo para
                                <strong className="text-slate-800">{currentAttendant.name}</strong>
                                <span
                                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                        currentAttendant.is_online
                                            ? "bg-emerald-50 text-emerald-700"
                                            : "bg-amber-50 text-amber-700"
                                    }`}
                                >
                                    {currentAttendant.is_online ? "Online" : "Offline"}
                                </span>
                            </div>
                        )}
                    </div>

                    {(error || success) && (
                        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
                            {error && (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                                    {error}
                                </div>
                            )}
                            {success && (
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                                    <span className="flex items-center gap-2">
                                        <Check size={17} />
                                        {success}
                                    </span>
                                    <Link
                                        href="/inbox"
                                        className="inline-flex cursor-pointer items-center gap-1.5 font-bold underline decoration-emerald-300 underline-offset-4"
                                    >
                                        Abrir Inbox
                                        <ExternalLink size={14} />
                                    </Link>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="p-5 sm:p-6">
                        {!submittedSearch && !isSearching && (
                            <EmptyState
                                icon={<Search size={22} />}
                                title="Pesquise uma conversa"
                                description="Use telefone ou nome para WhatsApp, ou nome e @usuário para Instagram."
                            />
                        )}

                        {submittedSearch && !isSearching && items.length === 0 && !error && (
                            <EmptyState
                                icon={<Users size={22} />}
                                title="Nenhuma conversa aberta encontrada"
                                description={`Não encontramos threads abertas para “${submittedSearch}”.`}
                            />
                        )}

                        {items.length > 0 && (
                            <div className="space-y-3">
                                <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
                                    <span>
                                        {items.length} conversa{items.length === 1 ? "" : "s"} encontrada{items.length === 1 ? "" : "s"}
                                    </span>
                                    <span>Somente conversas abertas</span>
                                </div>

                                {items.map((item) => {
                                    const isAssigning = assigningThreadId === item.id;
                                    const isMine = item.assignment_status === "mine";
                                    const isOther = item.assignment_status === "other";

                                    return (
                                        <article
                                            key={item.id}
                                            className="rounded-2xl border border-slate-200 p-4 transition hover:border-slate-300 hover:shadow-sm sm:p-5"
                                        >
                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h2 className="truncate font-bold text-slate-950">
                                                            {item.name}
                                                        </h2>
                                                        <ConversationChannelBadge
                                                            channel={item.channel}
                                                            showLabel
                                                        />
                                                        <AssignmentBadge item={item} />
                                                    </div>

                                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                                                        <span className="font-semibold text-slate-700">
                                                            {formatIdentity(item)}
                                                        </span>
                                                        {item.email && <span>{item.email}</span>}
                                                        <span>{formatDate(item.last_message_at)}</span>
                                                    </div>

                                                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">
                                                        {item.preview || "Sem mensagens"}
                                                    </p>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => void assignConversation(item)}
                                                    disabled={isAssigning || isMine || !!assigningThreadId}
                                                    className={`inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed ${
                                                        isMine
                                                            ? "bg-emerald-50 text-emerald-700"
                                                            : isOther
                                                                ? "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                                                                : "bg-brand text-white shadow-sm hover:bg-brand/90 disabled:bg-slate-200 disabled:text-slate-500"
                                                    }`}
                                                >
                                                    {isAssigning ? (
                                                        <LoaderCircle size={17} className="animate-spin" />
                                                    ) : isMine ? (
                                                        <Check size={17} />
                                                    ) : (
                                                        <UserCheck size={17} />
                                                    )}
                                                    {isAssigning
                                                        ? "Atribuindo..."
                                                        : isMine
                                                            ? "Já está com você"
                                                            : isOther
                                                                ? "Reatribuir para mim"
                                                                : "Atribuir para mim"}
                                                </button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

function AssignmentBadge({ item }: { item: SearchItem }) {
    if (item.assignment_status === "mine") {
        return (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                Com você
            </span>
        );
    }

    if (item.assignment_status === "other") {
        return (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
                Com {item.assigned_attendant_name ?? "outro atendente"}
            </span>
        );
    }

    return (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
            Na fila
        </span>
    );
}

function EmptyState({
    icon,
    title,
    description,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
                {icon}
            </div>
            <h2 className="font-bold text-slate-800">{title}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                {description}
            </p>
        </div>
    );
}

function formatIdentity(item: SearchItem) {
    if (item.channel === "Instagram") {
        return item.username ? `@${item.username}` : "Perfil do Instagram";
    }

    return formatPhone(item.phone);
}

function formatPhone(value: string | null) {
    if (!value) return "Telefone não informado";

    const digits = value.replace(/\D/g, "");
    const local = digits.startsWith("55") ? digits.slice(2) : digits;

    if (local.length === 11) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }

    if (local.length === 10) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    }

    return value;
}

function formatDate(value: string | null) {
    if (!value) return "Sem data";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(date);
}
