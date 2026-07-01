// components/clientes/ClientPanel.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
    Calendar,
    CalendarCheck,
    ChevronRight,
    CircleAlert,
    Clock,
    Filter,
    Mail,
    MapPin,
    Phone,
    Send,
} from "lucide-react";

import {
    Badge,
    DetailsSidePanel,
    getBadgeLabel,
    Skeleton,
    type ConversationResult,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import ClientInformationCard from "@/components/clientes/ClientInformationCard";

type FunnelStage = {
    id: string;
    funnel_id: string;
    name: string;
    position: number;
    color: string | null;
    funnel_name?: string | null;
    funnel?: {
        id: string;
        name: string | null;
    } | null;
};

type ClientDetail = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    cpf: string | null;
    birth_date: string | null;
    unit_id: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    cep: string | null;
    first_seen_at: string;
    last_interaction_at: string;
    last_active_message_sent_at: string | null;
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
    stage: FunnelStage | null;
    funnel: {
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
    units: Array<{ id: string; name: string }>;
    upcoming_appointment_count: number;
    live_thread: ClientLiveThread | null;
    conversations: ClientConversationSummary[];
};

export default function ClientPanel({
    clientId,
    onClose,
}: {
    clientId: string | null;
    onClose: () => void;
    onOpenConversation?: (conversationId: string) => void;
    onOpenThread?: (threadId: string) => void;
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
            zIndexClassName="z-40"
            headerContent={
                loading || !data ? (
                    <ClientPanelHeaderSkeleton />
                ) : (
                    <ClientPanelHeader client={data.client} />
                )
            }
            bodyClassName="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-5"
        >
            {loading ? (
                <ClientPanelSkeleton />
            ) : !data ? (
                <EmptyPanelMessage message="Não foi possível carregar este cliente." />
            ) : (
                <div className="space-y-4">
                    <ClientInformationCard
                        client={data.client}
                        units={data.units}
                        upcomingAppointmentCount={
                            data.upcoming_appointment_count ?? 0
                        }
                        onSaved={(savedClient) =>
                            setData((current) =>
                                current
                                    ? {
                                          ...current,
                                          client: { ...current.client, ...savedClient },
                                      }
                                    : current,
                            )
                        }
                    />
                    <LiveConversationButton thread={data.live_thread} />
                    <ConversationHistorySection conversations={data.conversations} />
                    <ActiveMessageButton client={data.client} />
                </div>
            )}
        </DetailsSidePanel>
    );
}

function ClientPanelHeader({ client }: { client: ClientDetail }) {
    const clientName = client.name ?? "Cliente sem nome";
    const source = getBadgeLabel(client.utm_source);

    return (
        <>
            <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <InitialsAvatar name={clientName} />

                    <div className="min-w-0">
                        <div
                            title={clientName}
                            className="truncate text-base font-bold text-slate-950"
                        >
                            {clientName}
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                            <Phone size={15} />
                            <span>{formatPhone(client.phone)}</span>
                        </div>


                    </div>
                </div>
                {client.utm_campaign && (
                        <Badge value={client.utm_campaign} none={""} />
                )}
            </div>

            <div className="grid grid-cols-3 gap-4 text-xs">

                <HeaderInfoItem
                    icon={<Calendar size={18} />}
                    label="Desde"
                    value={formatDate(client.first_seen_at) ?? "—"}
                />

                <HeaderInfoItem
                    icon={<MapPin size={18} />}
                    label="Unidade"
                    value={client.unit?.name ?? "—"}
                />

                <HeaderInfoItem
                    icon={<Filter size={18} />}
                    label="Funil"
                    value={client.funnel?.name ?? "—"}
                />

                <HeaderInfoItem
                    icon={<CalendarCheck size={18} />}
                    label="Estágio"
                    value={client.stage?.name ?? "—"}
                />

                <HeaderInfoItem
                    icon={<Clock size={18} />}
                    label="Última interação"
                    value={timeAgo(client.last_interaction_at)}
                />

                <HeaderInfoItem
                    icon={<Filter size={18} />}
                    label="Origem"
                    value={source}
                />
            </div>
        </>
    );
}

function HeaderInfoItem({
    icon,
    label,
    value,
}: {
    icon: ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="flex min-w-0 items-start gap-2">
            <div className="mt-0.5 text-slate-400">{icon}</div>

            <div className="min-w-0">
                <div className="text-slate-500">{label}</div>
                <div title={value} className="truncate font-semibold text-slate-700">
                    {value}
                </div>
            </div>
        </div>
    );
}

function ActiveMessageButton({ client }: { client: ClientDetail }) {
    const phone = client.phone?.trim() ?? "";
    const disabled = !phone;

    function openActiveMessage() {
        if (disabled) return;

        const params = new URLSearchParams({
            phone,
            client_id: client.id,
        });

        window.location.assign(`/mensagem-ativa?${params.toString()}`);
    }

    return (
        <button
            type="button"
            onClick={openActiveMessage}
            disabled={disabled}
            title={disabled ? "Cliente sem telefone" : "Abrir Mensagem Ativa"}
            className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_24px] items-center rounded-xl border border-purple/20 bg-purple-soft/60 px-4 py-4 text-left transition hover:bg-purple-soft disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:opacity-60"
        >
            <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-sm font-bold text-purple group-disabled:text-slate-500">
                    <Send size={16} />
                    <span>Mensagem Ativa</span>
                </div>
                <div className="truncate text-xs text-slate-500">
                    {formatLastActiveMessageSent(client.last_active_message_sent_at)}
                </div>
            </div>

            <ChevronRight
                size={17}
                className="justify-self-end text-purple transition group-hover:translate-x-0.5 group-disabled:text-slate-400"
            />
        </button>
    );
}

function LiveConversationButton({
    thread,
}: {
    thread: ClientLiveThread | null;
}) {
    if (!thread) return null;

    return (
        <button
            type="button"
            onClick={() => openFloatingConversation({ type: "thread", id: thread.id })}
            className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_24px] items-center rounded-xl border border-green/20 bg-soft-green px-4 py-4 text-left transition hover:bg-green/10"
        >
            <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-sm font-bold text-green">
                    <LiveHalo active small />
                    <span>Conversa ao vivo</span>
                </div>

                <div className="truncate text-sm text-slate-700">
                    {thread.last_message_text ?? "Sem prévia"}
                </div>

                <div className="mt-1 text-xs text-muted">
                    {thread.last_message_at
                        ? `${timeAgo(thread.last_message_at)} atrás`
                        : "Sem mensagens"}
                    {thread.unread_count > 0
                        ? ` • ${thread.unread_count} não lidas`
                        : ""}
                </div>
            </div>

            <ChevronRight
                size={17}
                className="justify-self-end text-green transition group-hover:translate-x-0.5"
            />
        </button>
    );
}

function ConversationHistorySection({
    conversations,
}: {
    conversations: ClientConversationSummary[];
}) {
    return (
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-text">Histórico</h3>
                    <p className="mt-1 text-xs text-muted">Conversas anteriores deste cliente</p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-muted">
                    {conversations.length}
                </span>
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
                            onClick={() => openFloatingConversation({ type: "conversation", id: conversation.id })}
                            className="group grid w-full cursor-pointer grid-cols-[1.15fr_1.2fr_1fr_48px_28px] items-center border-t border-slate-100 px-3 py-3 text-left text-sm transition hover:bg-selection/80"
                        >
                            <div className="min-w-0 pr-3">
                                <div className="truncate font-semibold text-slate-700">
                                    {formatConversationDateRange(
                                        conversation.started_at,
                                        conversation.ended_at,
                                    )}
                                </div>
                                <div className="mt-1 truncate text-xs text-muted">
                                    {conversation.attendant_name}
                                </div>
                            </div>

                            <div
                                className="truncate pr-3 text-slate-700"
                                title={conversation.objective}
                            >
                                {conversation.objective}
                            </div>

                            <div>
                                <Badge value={conversation.result} />
                            </div>

                            <div className="flex items-center gap-2 text-slate-600">
                                {conversation.notable && (
                                    <CircleAlert size={14} className="text-orange" />
                                )}
                                {conversation.message_count}
                            </div>

                            <div className="flex justify-end">
                                <ChevronRight
                                    size={16}
                                    className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700"
                                />
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </section>
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

function ClientPanelHeaderSkeleton() {
    return (
        <div>
            <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="h-9 w-9 rounded-full" />

                    <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="mt-3 h-3 w-28" />
                    </div>
                </div>

                <Skeleton className="h-7 w-16 rounded-md" />
            </div>

            <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="flex gap-2">
                        <Skeleton className="h-4 w-4 rounded" />
                        <div className="min-w-0 flex-1">
                            <Skeleton className="h-3 w-14" />
                            <Skeleton className="mt-2 h-3 w-20" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ClientPanelSkeleton() {
    return (
        <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="mt-2 h-3 w-48" />
                    </div>
                    <Skeleton className="h-9 w-24 rounded-xl" />
                </div>

                <div className="grid grid-cols-2 gap-x-5 gap-y-5">
                    <div className="col-span-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="mt-2 h-4 w-48" />
                    </div>
                    {Array.from({ length: 5 }).map((_, index) => (
                        <div key={index}>
                            <Skeleton className="h-3 w-20" />
                            <Skeleton className="mt-2 h-4 w-32" />
                        </div>
                    ))}
                    <div className="col-span-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="mt-2 h-4 w-full max-w-[360px]" />
                    </div>
                </div>
            </section>

            <Skeleton className="h-[92px] rounded-xl" />

            <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="mt-2 h-3 w-48" />
                    </div>
                    <Skeleton className="h-6 w-8 rounded-md" />
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-100">
                    <div className="grid grid-cols-[1.15fr_1.2fr_1fr_48px_28px] gap-3 bg-slate-50 px-3 py-3">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <Skeleton key={index} className="h-3 w-full" />
                        ))}
                    </div>
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div
                            key={index}
                            className="grid grid-cols-[1.15fr_1.2fr_1fr_48px_28px] items-center gap-3 border-t border-slate-100 px-3 py-3"
                        >
                            <div>
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="mt-2 h-3 w-20" />
                            </div>
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-6 w-16 rounded-md" />
                            <Skeleton className="h-4 w-6" />
                            <Skeleton className="h-4 w-4" />
                        </div>
                    ))}
                </div>
            </section>

            <Skeleton className="h-[76px] rounded-xl" />
        </div>
    );
}

function EmptyPanelMessage({ message }: { message: string }) {
    return <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-medium text-slate-400">{message}</div>;
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

function formatLastActiveMessageSent(value: string | null) {
    if (!value) return "Nenhuma mensagem ativa enviada ainda.";

    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "Nenhuma mensagem ativa enviada ainda.";

    const elapsed = Math.max(0, Date.now() - timestamp);
    const days = Math.floor(elapsed / (24 * 60 * 60 * 1000));

    if (days === 0) return "Última mensagem ativa enviada hoje.";
    if (days === 1) return "Última mensagem ativa enviada 1 dia atrás.";
    return `Última mensagem ativa enviada ${days} dias atrás.`;
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
