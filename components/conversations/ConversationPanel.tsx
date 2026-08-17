// components/conversations/ConversationPanel.tsx
"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { AtSign, Calendar, ChevronRight, CircleAlert, Clock, Phone, Target, User } from "lucide-react";
import { FaFacebookMessenger, FaGoogle, FaMeta } from "react-icons/fa6";

import {
    getAdTagsForOutcomeEventType,
    type AdPlatformTag,
    QUALIFIED_LEAD_OUTCOME_EVENTS,
    SCHEDULE_OUTCOME_EVENTS,
} from "@/lib";
import {
    getConversationGoalLabel,
    getCustomerFinalStateLabel,
    getCustomerStartIntentLabel,
    getDropoffMomentLabel,
    getDropoffReasonLabel,
    getGoalStatusLabel,
    getOutcomeEventLabel,
} from "@/lib/conversationAnalysisLabels";
import { isPreservedMessageText } from "@/lib/messages/preservedMessage";
import {
    Badge,
    DetailsSidePanel,
    Skeleton,
    type ConversationResult,
} from "@/components";
import { openClientProfile } from "@/components/clientes/PermanentClientProfilePanel";
import { InitialsAvatar } from "./InitialsAvatar";
import { ChatMessageContent } from "./ChatMessageBubble";
import { ConversationChannelBadge } from "./ConversationChannelBadge";
import { OPEN_CONVERSATION_DETAILS_EVENT } from "./FloatingConversationPanel";

type SenderType = "client" | "attendant" | "bot" | "system";

type PanelMessage = {
    id: string;
    sender_type: SenderType;
    sender_name: string | null;
    text: string;
    sent_at: string;
    external_id: string | null;
    external_contact_id: string | null;
};

type PanelData = {
    item_type: "conversation" | "thread";
    conversation: {
        id: string;
        client_id?: string | null;
        started_at: string;
        ended_at: string | null;
        attendant_chat_name: string | null;
        tunnel: string | null;
        origin: string | null;
        source: string | null;
        channel: string | null;
        analysis_status: "pending" | "processing" | "completed" | "failed";
    };
    client: {
        id: string;
        name: string | null;
        phone: string | null;
        identity_type: "client" | "instagram";
        is_clickable: boolean;
        instagram_username: string | null;
    };
    messages: PanelMessage[];
    analysis: any | null;
};

type ConversationPanelProps = {
    conversationId: string | null;
    threadId?: string | null;
    onClose: () => void;
};

type Tab = "messages" | "analysis" | "events" | "details";

export function ConversationPanel({
    conversationId,
    threadId = null,
    onClose,
}: ConversationPanelProps) {
    const [data, setData] = useState<PanelData | null>(null);
    const [loading, setLoading] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [activeItemType, setActiveItemType] = useState<
        "conversation" | "thread"
    >("conversation");
    const [tab, setTab] = useState<Tab>("messages");

    const requestIdRef = useRef(0);

    const loadConversation = useCallback(
        async (
            nextConversationId: string,
            itemType: "conversation" | "thread",
            requestId: number,
        ) => {
            const startedAt = Date.now();

            try {
                const params = new URLSearchParams({
                    item_type: itemType,
                });
                const response = await fetch(
                    `/api/dashboard/conversas/${nextConversationId}?${params.toString()}`,
                );
                const json: PanelData = await response.json();
                const elapsed = Date.now() - startedAt;
                const minimumLoadingTime = 500;

                if (elapsed < minimumLoadingTime) {
                    await new Promise((resolve) =>
                        window.setTimeout(
                            resolve,
                            minimumLoadingTime - elapsed,
                        ),
                    );
                }

                if (requestIdRef.current === requestId) setData(json);
            } finally {
                if (requestIdRef.current === requestId) setLoading(false);
            }
        },
        [],
    );

    const openConversation = useCallback(
        (
            nextConversationId: string,
            itemType: "conversation" | "thread",
        ) => {
            const requestId = requestIdRef.current + 1;
            requestIdRef.current = requestId;

            setActiveConversationId(nextConversationId);
            setActiveItemType(itemType);
            setPanelOpen(false);
            setData(null);
            setLoading(true);
            setTab("messages");

            window.setTimeout(() => {
                if (requestIdRef.current === requestId) {
                    setPanelOpen(true);
                }
            }, 20);

            void loadConversation(
                nextConversationId,
                itemType,
                requestId,
            );
        },
        [loadConversation],
    );

    useEffect(() => {
        const requestedId = threadId ?? conversationId;
        if (!requestedId) return;

        const itemType = threadId ? "thread" : "conversation";
        const timeoutId = window.setTimeout(() => {
            openConversation(requestedId, itemType);
        }, 0);

        return () => window.clearTimeout(timeoutId);
    }, [conversationId, openConversation, threadId]);

    useEffect(() => {
        function handleOpenConversationDetails(event: Event) {
            const conversationDetail = (
                event as CustomEvent<{ conversationId?: string }>
            ).detail;

            if (!conversationDetail?.conversationId) return;
            openConversation(
                conversationDetail.conversationId,
                "conversation",
            );
        }

        window.addEventListener(
            OPEN_CONVERSATION_DETAILS_EVENT,
            handleOpenConversationDetails,
        );

        return () => {
            window.removeEventListener(
                OPEN_CONVERSATION_DETAILS_EVENT,
                handleOpenConversationDetails,
            );
        };
    }, [openConversation]);

    if (!activeConversationId) return null;

    const clientName = data?.client.name ?? "Cliente sem nome";
    const result = data?.analysis
        ? getResult(data.analysis.resolution_result)
        : null;
    const isSocialIdentity = data?.client.identity_type === "instagram";
    const isMessengerIdentity =
        isSocialIdentity && data?.conversation.channel === "Facebook";
    const clientProfileId =
        data?.conversation.client_id ??
        (data?.client.is_clickable ? data.client.id : null);

    function handleClose() {
        setPanelOpen(false);
        window.setTimeout(() => {
            setActiveConversationId(null);
            onClose();
        }, 250);
    }

    function handleOpenClientProfile() {
        if (!clientProfileId) return;

        setPanelOpen(false);
        window.setTimeout(() => {
            setActiveConversationId(null);
            onClose();
            openClientProfile(clientProfileId);
        }, 80);
    }

    return (
        <DetailsSidePanel
            open={panelOpen}
            title={
                <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="truncate">
                        {activeItemType === "thread"
                            ? "Conversa ao vivo"
                            : "Detalhes da conversa"}
                    </span>
                    {data ? (
                        <ConversationChannelBadge
                            channel={
                                data.conversation.channel ??
                                (data.conversation.source === "zernio"
                                    ? "Instagram"
                                    : "WhatsApp")
                            }
                        />
                    ) : null}
                </span>
            }
            onClose={handleClose}
            headerContent={
                loading || !data ? (
                    <PanelHeaderSkeleton />
                ) : (
                    <>
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <button
                                type="button"
                                disabled={!clientProfileId}
                                onClick={handleOpenClientProfile}
                                className={`flex min-w-0 flex-1 items-center justify-between gap-4 text-left ${
                                    clientProfileId
                                        ? "cursor-pointer transition-opacity hover:opacity-80"
                                        : "cursor-default"
                                }`}
                                aria-label={
                                    clientProfileId
                                        ? `Abrir perfil de ${clientName}`
                                        : undefined
                                }
                            >
                                <div className="flex min-w-0 items-center gap-4">
                                    <InitialsAvatar
                                        name={clientName}
                                        conversationState={
                                            data.item_type === "thread"
                                                ? "live"
                                                : undefined
                                        }
                                    />

                                    <div className="min-w-0">
                                        <div
                                            title={clientName}
                                            className="truncate text-base font-bold text-slate-950"
                                        >
                                            {clientName}
                                        </div>

                                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                                            {isSocialIdentity ? (
                                                isMessengerIdentity ? (
                                                    <FaFacebookMessenger size={15} />
                                                ) : (
                                                    <AtSign size={15} />
                                                )
                                            ) : (
                                                <Phone size={15} />
                                            )}
                                            <span>
                                                {isSocialIdentity
                                                    ? isMessengerIdentity
                                                        ? "Messenger"
                                                        : data.client
                                                              .instagram_username
                                                            ? `@${data.client.instagram_username.replace(/^@+/, "")}`
                                                            : "Instagram"
                                                    : data.client.phone ?? "-"}
                                            </span>
                                        </div>

                                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                                            <Calendar size={15} />
                                            <span
                                                className="truncate"
                                                title={formatConversationPeriod(
                                                    data.conversation.started_at,
                                                    data.conversation.ended_at,
                                                )}
                                            >
                                                {formatConversationPeriod(
                                                    data.conversation.started_at,
                                                    data.conversation.ended_at,
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {data.client.is_clickable ? (
                                    <ChevronRight
                                        size={18}
                                        className="shrink-0 text-slate-400"
                                    />
                                ) : null}
                            </button>

                            {result ? (
                                <span title={`Resolução ${result}`}>
                                    <Badge value={result} />
                                </span>
                            ) : null}
                        </div>

                        <div className="grid grid-cols-3 gap-4 text-xs">
                            <InfoItem
                                icon={<User size={18} />}
                                label="Atendente"
                                value={data.conversation.attendant_chat_name ?? "Sem atendente"}
                            />
                            <InfoItem
                                icon={<Target size={18} />}
                                label={data.analysis ? "Resolução" : "Status"}
                                value={
                                    data.analysis
                                        ? data.analysis.resolution_score == null
                                            ? "—"
                                            : `${data.analysis.resolution_score}%`
                                        : data.item_type === "thread"
                                            ? "Ao vivo"
                                            : "Não analisada"
                                }
                            />
                            <InfoItem
                                icon={<Clock size={18} />}
                                label="Duração"
                                value={formatDuration(
                                    data.conversation.started_at,
                                    data.conversation.ended_at,
                                )}
                            />
                        </div>
                    </>
                )
            }
            bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
        >
            <div className="flex border-b border-slate-100">
                <PanelTab active={tab === "messages"} onClick={() => setTab("messages")}>
                    Mensagens
                </PanelTab>
                <PanelTab active={tab === "analysis"} onClick={() => setTab("analysis")}>
                    Análise
                </PanelTab>
                <PanelTab active={tab === "events"} onClick={() => setTab("events")}>
                    Eventos
                </PanelTab>
                <PanelTab active={tab === "details"} onClick={() => setTab("details")}>
                    Detalhes
                </PanelTab>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {loading || !data ? (
                    <PanelBodySkeleton />
                ) : (
                    <>
                        {tab === "messages" && <MessagesTab messages={data.messages} />}
                        {tab === "analysis" && (
                            <AnalysisTab
                                analysis={data.analysis}
                                analysisStatus={data.conversation.analysis_status}
                                isLive={data.item_type === "thread"}
                            />
                        )}
                        {tab === "events" && <EventsTab analysis={data.analysis} />}
                        {tab === "details" && <DetailsTab data={data} />}
                    </>
                )}
            </div>
        </DetailsSidePanel>
    );
}

function MessagesTab({ messages }: { messages: PanelMessage[] }) {
    const visibleMessages = messages.filter(
        (message) => !isPreservedMessageText(message.text),
    );

    if (visibleMessages.length === 0) {
        return <EmptyPanelMessage text="Nenhuma mensagem encontrada." />;
    }

    return (
        <div className="space-y-5">
            {visibleMessages.map((message) => {
                const isClient = message.sender_type === "client";
                const isAttendant = message.sender_type === "attendant";
                const isBot = message.sender_type === "bot";
                const label = isClient
                    ? "Cliente"
                    : isAttendant
                        ? message.sender_name ?? "Atendente"
                        : isBot
                            ? "Bot"
                            : "Sistema";

                return (
                    <div
                        key={message.id}
                        className={`flex gap-3 ${isClient ? "justify-start" : "justify-end"}`}
                    >
                        {isClient && (
                            <InitialsAvatar name={message.sender_name ?? "Cliente"} />
                        )}

                        <div
                            className={`max-w-[75%] ${
                                isClient ? "items-start" : "items-end"
                            } flex flex-col`}
                        >
                            <div className="mb-1 text-xs font-medium text-slate-500">
                                {label}{" "}
                                <span className="font-normal">
                                    {formatTime(message.sent_at)}
                                </span>
                            </div>

                            <div
                                title={message.text}
                                className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                                    isClient
                                        ? "bg-slate-100 text-slate-800"
                                        : "bg-purple-soft text-slate-800"
                                }`}
                            >
                                <ChatMessageContent
                                    message={message}
                                    attachmentAccess="conversation"
                                />
                            </div>
                        </div>

                        {!isClient && (
                            <InitialsAvatar name={message.sender_name ?? label} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function AnalysisTab({
    analysis,
    analysisStatus,
    isLive,
}: {
    analysis: any | null;
    analysisStatus: PanelData["conversation"]["analysis_status"];
    isLive: boolean;
}) {
    if (!analysis) {
        return (
            <EmptyPanelMessage
                text={
                    isLive
                        ? "Essa conversa ainda está em andamento."
                        : analysisStatus === "processing"
                        ? "Análise em processamento."
                        : "Essa conversa ainda não foi analisada."
                }
            />
        );
    }

    const hasDropoffDetails = Boolean(
        analysis.dropoff_happened ||
        analysis.dropoff_likely_reason ||
        (analysis.dropoff_moment && analysis.dropoff_moment !== "unknown"),
    );

    return (
        <div className="space-y-4">
            <SummaryCard title="Resumo da análise">
                <InfoGrid
                    items={[
                        ["Objetivo", getConversationGoalLabel(analysis.conversation_goal)],
                        ["Status do objetivo", getGoalStatusLabel(analysis.goal_status)],
                        ["Resultado", getResultLabel(analysis.resolution_result)],
                        [
                            "Estado final",
                            getCustomerFinalStateLabel(analysis.customer_final_state),
                        ],
                        ["Satisfação", `${analysis.satisfaction_score ?? 0}%`],
                        ["Resolução", `${analysis.resolution_score ?? 0}%`],
                    ]}
                />
            </SummaryCard>

            {hasDropoffDetails && (
                <SummaryCard title="Motivo provável da perda">
                    <InfoGrid
                        items={[
                            ["Momento", getDropoffMomentLabel(analysis.dropoff_moment)],
                            ["Confiança", formatConfidence(analysis.dropoff_confidence)],
                        ]}
                    />
                    <div className="mt-4 border-t border-slate-100 pt-4">
                        <div className="text-xs text-slate-500">Motivo provável</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {getDropoffReasonLabel(analysis.dropoff_likely_reason)}
                        </p>
                    </div>
                </SummaryCard>
            )}

            {analysis.notable && (
                <SummaryCard title={null}>
                    <div className="mb-2 flex items-center gap-2 font-bold text-amber-800">
                        <CircleAlert className="h-4 w-4" />
                        Conversa notável
                    </div>
                    <p className="text-sm leading-relaxed text-amber-800/80">
                        {analysis.notable_reason ?? "Motivo não descrito."}
                    </p>
                </SummaryCard>
            )}

            <SummaryCard title="Intenção inicial">
                <p className="text-sm leading-relaxed text-slate-600">
                    {getCustomerStartIntentLabel(analysis.customer_start_intent)}
                </p>
            </SummaryCard>
        </div>
    );
}

function EventsTab({ analysis }: { analysis: any | null }) {
    const events = analysis?.outcome_events ?? [];

    if (!analysis || events.length === 0) {
        return <EmptyPanelMessage text="Nenhum evento encontrado." />;
    }

    return (
        <div className="space-y-3">
            {events.map((event: any, index: number) => {
                const adTags = getAdTagsForOutcomeEventType(event.type);
                const conversionLabel = getAdConversionLabel(event.type);
                const eventLabel = getOutcomeEventLabel(event.type);

                return (
                    <div
                        key={`${event.type}-${index}`}
                        className="rounded-xl border border-slate-100 p-4"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div
                                    title={eventLabel}
                                    className="truncate font-semibold text-slate-800"
                                >
                                    {eventLabel}
                                </div>
                                <div className="mt-1 text-sm text-slate-500">
                                    Confiança: {formatConfidence(event.confidence)}
                                </div>
                                {event.occurred_at && (
                                    <div className="mt-1 text-sm text-slate-500">
                                        {formatDateTime(event.occurred_at)}
                                    </div>
                                )}
                            </div>

                            {adTags.length > 0 && conversionLabel && (
                                <div className="flex shrink-0 flex-col flex-wrap justify-end gap-2">
                                    {adTags.map((tag) => (
                                        <AdTagBadge
                                            key={tag}
                                            tag={tag}
                                            conversionLabel={conversionLabel}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function DetailsTab({ data }: { data: PanelData }) {
    const isSocialIdentity = data.client.identity_type === "instagram";
    const isMessengerIdentity =
        isSocialIdentity && data.conversation.channel === "Facebook";

    return (
        <div className="space-y-4">
            <SummaryCard title="Conversa">
                <InfoGrid
                    items={[
                        ["ID", data.conversation.id],
                        [
                            isSocialIdentity ? "Usuário" : "Cliente",
                            data.client.name ??
                                (isSocialIdentity
                                    ? isMessengerIdentity
                                        ? "Usuário do Messenger"
                                        : "Usuário do Instagram"
                                    : "Cliente sem nome"),
                        ],
                        [
                            isSocialIdentity
                                ? isMessengerIdentity
                                    ? "Messenger"
                                    : "Instagram"
                                : "Telefone",
                            isSocialIdentity
                                ? isMessengerIdentity
                                    ? data.client.instagram_username ?? "-"
                                    : data.client.instagram_username
                                      ? `@${data.client.instagram_username.replace(/^@+/, "")}`
                                      : "-"
                                : data.client.phone ?? "-",
                        ],
                        ["Data inicial", formatDateTime(data.conversation.started_at)],
                        [
                            "Data final",
                            data.conversation.ended_at
                                ? formatDateTime(data.conversation.ended_at)
                                : "-",
                        ],
                        [
                            "Duração",
                            formatDuration(
                                data.conversation.started_at,
                                data.conversation.ended_at,
                            ),
                        ],
                        [
                            "Atendente",
                            data.conversation.attendant_chat_name ?? "Sem atendente",
                        ],
                        ["Túnel", data.conversation.tunnel ?? "Não definido"],
                        ["Origem", data.conversation.origin ?? "Não definido"],
                        [
                            "Plataforma",
                            data.conversation.channel === "Facebook"
                                ? "Messenger"
                                : data.conversation.channel ??
                                  (data.conversation.source === "zernio"
                                      ? "Instagram"
                                      : "WhatsApp"),
                        ],
                    ]}
                />
            </SummaryCard>
        </div>
    );
}

function InfoItem({
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

function PanelTab({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 cursor-pointer border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                active
                    ? "border-brand text-brand"
                    : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
        >
            {children}
        </button>
    );
}

function SummaryCard({
    title,
    children,
}: {
    title: string | null;
    children: ReactNode;
}) {
    return (
        <div className="rounded-xl border border-slate-100 p-4">
            {title && <h3 className="mb-4 font-bold text-slate-900">{title}</h3>}
            {children}
        </div>
    );
}

function InfoGrid({ items }: { items: [string, string][] }) {
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            {items.map(([label, value]) => (
                <div key={label} className="min-w-0">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div
                        title={value}
                        className="mt-1 truncate font-semibold text-slate-700"
                    >
                        {value}
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyPanelMessage({ text }: { text: string }) {
    return (
        <div className="rounded-xl border border-slate-100 p-4 text-sm text-slate-500">
            {text}
        </div>
    );
}

function PanelHeaderSkeleton() {
    return (
        <div>
            <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="mt-3 h-3 w-28" />
                        <Skeleton className="mt-3 h-3 w-36" />
                    </div>
                </div>
                <Skeleton className="h-7 w-20 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-10 rounded-lg" />
                <Skeleton className="h-10 rounded-lg" />
                <Skeleton className="h-10 rounded-lg" />
            </div>
        </div>
    );
}

function PanelBodySkeleton() {
    return (
        <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-xl" />
            ))}
        </div>
    );
}

function AdTagBadge({
    tag,
    conversionLabel,
}: {
    tag: AdPlatformTag;
    conversionLabel: string;
}) {
    const className =
        tag === "Meta Ads"
            ? "bg-blue-100 text-blue-700"
            : "bg-amber-100 text-amber-700";
    const icon =
        tag === "Meta Ads" ? (
            <FaMeta className="h-4 w-4" />
        ) : (
            <FaGoogle className="h-3 w-3" />
        );

    return (
        <span
            title={conversionLabel}
            className={`inline-flex gap-2 rounded-md px-2 py-1 text-[11px] font-bold ${className}`}
        >
            {icon} {conversionLabel}
        </span>
    );
}

function getAdConversionLabel(eventType: string) {
    if (QUALIFIED_LEAD_OUTCOME_EVENTS.includes(eventType as any)) {
        return "Qualified Lead";
    }
    if (SCHEDULE_OUTCOME_EVENTS.includes(eventType as any)) return "Schedule";
    return null;
}

function getResult(value: unknown): ConversationResult {
    if (
        value === "resolvida" ||
        value === "parcial" ||
        value === "nao_resolvida" ||
        value === "pendente"
    ) {
        return value;
    }
    if (value === "resolved") return "resolvida";
    if (value === "partial") return "parcial";
    if (value === "unresolved" || value === "not_resolved") {
        return "nao_resolvida";
    }
    return "pendente";
}

function getResultLabel(value: unknown) {
    const result = getResult(value);
    const labels: Record<ConversationResult, string> = {
        resolvida: "Resolvida",
        parcial: "Parcial",
        nao_resolvida: "Não resolvida",
        pendente: "Pendente",
    };
    return labels[result];
}

function formatConfidence(value: unknown) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "Não informada";

    const percentage = numericValue <= 1 ? numericValue * 100 : numericValue;
    return `${Math.round(percentage)}%`;
}

function formatDateTime(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatConversationPeriod(
    startedAt: string,
    endedAt: string | null,
) {
    return endedAt
        ? `${formatDateTime(startedAt)} - ${formatDateTime(endedAt)}`
        : `${formatDateTime(startedAt)} · Em andamento`;
}

function formatTime(value: string) {
    return new Date(value).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDuration(startValue: string, endValue: string | null) {
    if (!endValue) return "Em andamento";
    const diff = new Date(endValue).getTime() - new Date(startValue).getTime();
    const minutes = Math.max(1, Math.round(diff / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}h${rest ? ` ${rest}min` : ""}`;
}
