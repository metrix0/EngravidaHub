// components/clientes/ClientPanel.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
    CalendarCheck,
    ChevronRight,
    CircleAlert,
    Clock,
    Filter,
    Mail,
    MapPin,
    Phone,
} from "lucide-react";

import { DetailsSidePanel, Skeleton } from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import {
    ConversationResultBadge,
    type ConversationResult,
} from "@/components/conversations/ConversationResultBadge";

type PipelineStage = {
    id: string;
    pipeline_id: string;
    name: string;
    position: number;
    color: string | null;
    pipeline_name?: string | null;
    pipeline?: {
        id: string;
        name: string | null;
    } | null;
};

type ClientDetail = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    first_seen_at: string;
    last_interaction_at: string;
    created_at: string;
    updated_at: string;
    external_contact_id: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    state: string | null;
    country: string | null;
    notes: unknown;
    unit: {
        id: string;
        name: string;
    } | null;
    stage: PipelineStage | null;
    pipeline: {
        id: string;
        name: string | null;
    } | null;
};

type ClientLiveThread = {
    id: string;
    client_id: string;
    latest_conversation_id: string | null;
    status: string;
    channel: string;
    source: string;
    assigned_attendant_id: string | null;
    last_message_text: string | null;
    last_message_at: string | null;
    unread_count: number;
    created_at: string;
    updated_at: string;
};

type ClientConversationSummary = {
    id: string;
    source: string;
    started_at: string;
    ended_at: string | null;
    attendant_id: string | null;
    attendant_name: string;
    tunnel: string | null;
    origin: string | null;
    conversation_analysis_id: string | null;
    message_count: number;
    objective: string;
    result: ConversationResult;
    customer_final_state: string | null;
    notable: boolean;
    satisfaction_score: number | null;
    dropoff_happened: boolean;
    dropoff_moment: string | null;
};

type ClientDetailResponse = {
    client: ClientDetail;
    live_thread: ClientLiveThread | null;
    conversations: ClientConversationSummary[];
};

type BadgeTone = {
    bg: string;
    text: string;
};

export default function ClientPanel({
    clientId,
    onClose,
    onOpenConversation,
    onOpenThread,
}: {
    clientId: string | null;
    onClose: () => void;
    onOpenConversation: (conversationId: string) => void;
    onOpenThread: (threadId: string) => void;
}) {
    const [data, setData] = useState<ClientDetailResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const [activeClientId, setActiveClientId] = useState<string | null>(null);

    useEffect(() => {
        if (!clientId) return;

        setActiveClientId(clientId);
        setPanelOpen(false);
        setData(null);

        const openTimer = window.setTimeout(() => setPanelOpen(true), 20);
        let cancelled = false;

        async function loadClient() {
            setLoading(true);

            try {
                const response = await fetch(`/api/clientes/${clientId}`, {
                    cache: "no-store",
                });

                const json = await response.json();

                if (!response.ok) {
                    console.error("[ClientPanel] failed to load client", json);
                    if (!cancelled) setData(null);
                    return;
                }

                if (!cancelled) setData(json as ClientDetailResponse);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadClient();

        return () => {
            cancelled = true;
            window.clearTimeout(openTimer);
        };
    }, [clientId]);

    if (!activeClientId) return null;

    const title = loading ? "Carregando..." : data?.client.name ?? "Cliente sem nome";

    function handleClose() {
        setPanelOpen(false);
        window.setTimeout(() => {
            setActiveClientId(null);
            onClose();
        }, 250);
    }

    return (
        <DetailsSidePanel
            open={panelOpen}
            title="Perfil do cliente"
            onClose={handleClose}
            widthClassName="w-[620px]"
            zIndexClassName="z-40"
            headerContent={
                <div className="min-w-0">
                    <h3 className="truncate text-2xl font-bold text-text">
                        {title}
                    </h3>
                    <p className="mt-1 truncate text-sm text-muted">
                        {formatPhone(data?.client.phone ?? null)}
                    </p>
                </div>
            }
            bodyClassName="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5"
        >
            {loading ? (
                <ClientPanelSkeleton />
            ) : !data ? (
                <EmptyPanelMessage message="Não foi possível carregar este cliente." />
            ) : (
                <div className="space-y-5">
                    <ClientInfoSection client={data.client} />
                    <LiveConversationSection thread={data.live_thread} onOpenThread={onOpenThread} />
                    <ConversationHistorySection conversations={data.conversations} onOpenConversation={onOpenConversation} />
                </div>
            )}
        </DetailsSidePanel>
    );
}

function ClientInfoSection({ client }: { client: ClientDetail }) {
    return (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-4">
                <InitialsAvatar name={client.name ?? "Cliente"} />

                <div className="min-w-0">
                    <div className="truncate text-lg font-bold text-text">
                        {client.name ?? "Cliente sem nome"}
                    </div>
                    <div className="mt-1 text-sm text-muted">
                        Cliente desde {formatDate(client.first_seen_at)}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <InfoItem icon={<Phone size={15} />} label="Telefone" value={formatPhone(client.phone)} />
                <InfoItem icon={<Mail size={15} />} label="Email" value={client.email ?? "—"} />
                <InfoItem icon={<MapPin size={15} />} label="Unidade" value={client.unit?.name ?? "—"} />
                <InfoItem icon={<Filter size={15} />} label="Funil" value={client.pipeline?.name ?? "—"} />
                <InfoItem icon={<CalendarCheck size={15} />} label="Estágio" value={client.stage?.name ?? "—"} />
                <InfoItem icon={<Clock size={15} />} label="Última interação" value={timeAgo(client.last_interaction_at)} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                <Chip label={sourceLabel(client.utm_source)} tone={getSourceVariant(client.utm_source)} />
                {client.utm_campaign && <Chip label={client.utm_campaign} tone={{ bg: "bg-slate-100", text: "text-slate-500" }} />}
            </div>
        </section>
    );
}

function LiveConversationSection({
    thread,
    onOpenThread,
}: {
    thread: ClientLiveThread | null;
    onOpenThread: (threadId: string) => void;
}) {
    return (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-text">Conversas</h3>
                    <p className="mt-1 text-xs text-muted">Conversa ao vivo e histórico do cliente</p>
                </div>
                <LiveHalo active={Boolean(thread)} />
            </div>

            <div className="mb-3 flex items-center gap-2">
                <LiveHalo active={Boolean(thread)} small />
                <span className="text-sm font-bold text-slate-700">Conversa ao vivo</span>
            </div>

            {!thread ? (
                <EmptyPanelMessage message="Nenhuma conversa ao vivo para este cliente." />
            ) : (
                <button
                    type="button"
                    onClick={() => onOpenThread(thread.id)}
                    className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_24px] items-center rounded-xl border border-green/20 bg-soft-green px-4 py-4 text-left transition hover:bg-green/10"
                >
                    <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-green">Ao vivo • {thread.channel}</div>
                        <div className="mt-1 truncate text-sm text-slate-700">{thread.last_message_text ?? "Sem prévia"}</div>
                        <div className="mt-1 text-xs text-muted">
                            {thread.last_message_at ? `${timeAgo(thread.last_message_at)} atrás` : "Sem mensagens"}
                            {thread.unread_count > 0 ? ` • ${thread.unread_count} não lidas` : ""}
                        </div>
                    </div>

                    <ChevronRight size={17} className="justify-self-end text-green transition group-hover:translate-x-0.5" />
                </button>
            )}
        </section>
    );
}

function ConversationHistorySection({
    conversations,
    onOpenConversation,
}: {
    conversations: ClientConversationSummary[];
    onOpenConversation: (conversationId: string) => void;
}) {
    return (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-text">Histórico</h3>
                    <p className="mt-1 text-xs text-muted">Conversas anteriores deste cliente</p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-muted">{conversations.length}</span>
            </div>

            {conversations.length === 0 ? (
                <EmptyPanelMessage message="Nenhuma conversa histórica encontrada." />
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-100">
                    <div className="grid grid-cols-[1.15fr_1.2fr_1fr_48px_28px] bg-slate-50 px-3 py-3 text-xs font-bold text-muted">
                        <div>Data</div>
                        <div>Objetivo</div>
                        <div>Resultado</div>
                        <div>Msgs</div>
                        <div />
                    </div>

                    {conversations.map((conversation) => (
                        <button
                            key={conversation.id}
                            type="button"
                            onClick={() => onOpenConversation(conversation.id)}
                            className="group grid w-full cursor-pointer grid-cols-[1.15fr_1.2fr_1fr_48px_28px] items-center border-t border-slate-100 px-3 py-3 text-left text-sm transition hover:bg-selection/80"
                        >
                            <div className="min-w-0 pr-3">
                                <div className="truncate font-semibold text-slate-700">
                                    {formatConversationDateRange(conversation.started_at, conversation.ended_at)}
                                </div>
                                <div className="mt-1 truncate text-xs text-muted">{conversation.attendant_name}</div>
                            </div>

                            <div className="truncate pr-3 text-slate-700" title={conversation.objective}>{conversation.objective}</div>
                            <div><ConversationResultBadge result={conversation.result} /></div>
                            <div className="flex items-center gap-2 text-slate-600">
                                {conversation.notable && <CircleAlert size={14} className="text-orange" />}
                                {conversation.message_count}
                            </div>
                            <div className="flex justify-end"><ChevronRight size={16} className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" /></div>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}

function InfoItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-xl bg-slate-50 px-3 py-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">{icon}{label}</div>
            <div className="truncate text-sm font-semibold text-slate-700" title={value}>{value}</div>
        </div>
    );
}

function LiveHalo({ active, small = false }: { active: boolean; small?: boolean }) {
    const sizeClass = small ? "h-3 w-3" : "h-4 w-4";
    const dotClass = small ? "h-2 w-2" : "h-2.5 w-2.5";

    return (
        <span className={["relative inline-flex items-center justify-center", sizeClass].join(" ")}>
            {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-40" />}
            <span className={["relative inline-flex rounded-full", dotClass, active ? "bg-green" : "bg-slate-300"].join(" ")} />
        </span>
    );
}

function ClientPanelSkeleton() {
    return (
        <div className="space-y-5">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
        </div>
    );
}

function EmptyPanelMessage({ message }: { message: string }) {
    return <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">{message}</div>;
}

function Chip({ label, tone }: { label: string; tone: BadgeTone }) {
    return <span className={["inline-flex max-w-full truncate rounded-md px-2.5 py-1 text-xs font-bold", tone.bg, tone.text].join(" ")}>{label}</span>;
}

function sourceLabel(source: string | null) {
    const map: Record<string, string> = {
        meta_ads: "Meta Ads",
        facebook: "Meta Ads",
        instagram: "Instagram",
        google: "Google",
        direct: "Direto",
    };

    return map[source ?? "direct"] ?? source ?? "Direto";
}

function getSourceVariant(source: string | null): BadgeTone {
    const normalized = normalize(source ?? "direct");
    if (normalized.includes("meta_ads") || normalized.includes("facebook")) return { bg: "bg-soft-purple", text: "text-purple" };
    if (normalized.includes("google")) return { bg: "bg-soft-blue", text: "text-blue" };
    if (normalized.includes("instagram")) return { bg: "bg-soft-pink", text: "text-pink" };
    return { bg: "bg-slate-100", text: "text-slate-500" };
}

function formatPhone(phone: string | null) {
    if (!phone) return "Sem telefone";
    return phone.split("+55")[1] ?? phone;
}

function timeAgo(date: string) {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (minutes < 60) return `${Math.max(minutes, 1)} min`;
    if (hours < 24) return `${hours} h`;
    return `${days} dia${days > 1 ? "s" : ""}`;
}

function formatDate(date: string) {
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(date));
}

function formatTime(date: string) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

function formatConversationDateRange(startValue: string, endValue: string | null) {
    const start = new Date(startValue);
    const end = endValue ? new Date(endValue) : null;
    if (!end) return formatDate(startValue);
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) return `${formatDate(startValue)} ${formatTime(startValue)} às ${formatTime(endValue!)}`;
    return `de ${formatDate(startValue)} a ${formatDate(endValue!)}`;
}

function normalize(value: string) {
    return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
