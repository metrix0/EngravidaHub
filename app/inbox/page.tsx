// app/inbox/page.tsx
"use client";

import {useCallback, useEffect, useState} from "react";
import {
    Bot,
    CalendarCheck,
    ChevronLeft,
    ChevronRight,
    Clock,
    FileText,
    Filter,
    Funnel,
    MapPin,
    MessagesSquare,
    Paperclip, Pin,
    Search,
    Send,
    SlidersHorizontal,
    Smile, SquareArrowOutUpRight,
    UserRound,
} from "lucide-react";
import {FaFacebookF, FaInstagram, FaWhatsapp} from "react-icons/fa6";

import {Card, Pagination, Skeleton} from "@/components";
import {InitialsAvatar} from "@/components/conversations/InitialsAvatar";
import ClientPanel from "@/components/clientes/ClientPanel";
import { ChatMessageList } from "@/components/conversations/ChatMessageList";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import SchedulingPanel from "@/components/inbox/SchedulingPanel";
import SidePanel from "@/components/layout/SidePanel";

import {
    addClientNote,
    fetchInboxThread,
    fetchInboxThreads,
    sendInboxMessage,
    updateInboxThread,
} from "@/lib/inbox/inboxApi";
import {useInboxRealtime} from "@/lib/inbox/useInboxRealtime";
import {
    fetchCurrentAttendant,
    setCurrentAttendantOnline,
    type CurrentAttendant,
} from "@/lib/attendants/currentAttendantApi";
import type {
    InboxChannel,
    InboxStatus,
    InboxThreadDetail,
    InboxThreadListItem,
} from "@/types/inbox";

type Conversation = InboxThreadDetail;

const PAGE_SIZE = 10;

const scrollbarClass =
    "[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]";

export default function InboxPage() {
    const [status, setStatus] = useState<InboxStatus>("open");
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    const [threads, setThreads] = useState<InboxThreadListItem[]>([]);
    const [totalThreads, setTotalThreads] = useState(0);
    const [selectedThread, setSelectedThread] = useState<InboxThreadDetail | null>(null);
    const [schedulingPanelOpen, setSchedulingPanelOpen] = useState(false);
    const [clientProfileId, setClientProfileId] = useState<string | null>(null);

    const [isLoadingThreads, setIsLoadingThreads] = useState(true);
    const [isLoadingSelectedThread, setIsLoadingSelectedThread] = useState(false);

    const [currentAttendant, setCurrentAttendant] =
        useState<CurrentAttendant | null>(null);
    const [isLoadingCurrentAttendant, setIsLoadingCurrentAttendant] = useState(true);
    const [isSettingOnline, setIsSettingOnline] = useState(false);

    const totalPages = Math.max(1, Math.ceil(totalThreads / PAGE_SIZE));

    const isNotLinkedToAttendant =
        !isLoadingCurrentAttendant && !currentAttendant;

    const isCurrentAttendantOffline =
        !isLoadingCurrentAttendant &&
        !!currentAttendant &&
        !currentAttendant.is_online;

    const canShowInbox =
        !isLoadingCurrentAttendant &&
        !!currentAttendant &&
        currentAttendant.is_online;

    const loadThreads = useCallback(async () => {
        setIsLoadingThreads(true);

        try {
            const response = await fetchInboxThreads({
                status,
                search,
                page: currentPage,
                pageSize: PAGE_SIZE,
            });

            setThreads(response.items);
            setTotalThreads(response.total);

            setSelectedId((currentSelectedId) => {
                if (currentSelectedId) {
                    return currentSelectedId;
                }

                return response.items[0]?.id ?? null;
            });
        } catch (error) {
            console.error("[inbox] failed to load threads", error);
            setThreads([]);
            setTotalThreads(0);
        } finally {
            setIsLoadingThreads(false);
        }
    }, [status, search, currentPage]);

    const loadSelectedThread = useCallback(async () => {
        if (!selectedId) {
            setSelectedThread(null);
            return;
        }

        setIsLoadingSelectedThread(true);

        try {
            const response = await fetchInboxThread(selectedId);
            setSelectedThread(response.item);
        } catch (error) {
            console.error("[inbox] failed to load selected thread", error);
            setSelectedThread(null);
        } finally {
            setIsLoadingSelectedThread(false);
        }
    }, [selectedId]);

    useEffect(() => {
        let isMounted = true;

        async function loadCurrentAttendant() {
            setIsLoadingCurrentAttendant(true);

            try {
                const response = await fetchCurrentAttendant();

                if (!isMounted) return;

                setCurrentAttendant(response.attendant);
            } catch (error) {
                console.error("[inbox] failed to load current attendant", error);

                if (!isMounted) return;

                setCurrentAttendant(null);
            } finally {
                if (!isMounted) return;

                setIsLoadingCurrentAttendant(false);
            }
        }

        loadCurrentAttendant();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!canShowInbox) return;

        loadThreads();
    }, [canShowInbox, loadThreads]);

    useEffect(() => {
        if (!canShowInbox) return;

        loadSelectedThread();
    }, [canShowInbox, loadSelectedThread]);

    useInboxRealtime({
        selectedThreadId: canShowInbox ? selectedId : null,
        selectedClientId: canShowInbox ? selectedThread?.client_id ?? null : null,
        onThreadChange: loadThreads,
        onSelectedThreadChange: loadSelectedThread,
    });

    function handleSelectThread(threadId: string) {
        setSelectedId(threadId);

        setThreads((currentThreads) =>
            currentThreads.map((thread) =>
                thread.id === threadId
                    ? {
                        ...thread,
                        unread: 0,
                    }
                    : thread
            )
        );
    }

    function handleStatusChange(nextStatus: InboxStatus) {
        setStatus(nextStatus);
        setCurrentPage(1);
    }

    async function handleStayOnline() {
        if (isSettingOnline) return;

        setIsSettingOnline(true);

        try {
            const response = await setCurrentAttendantOnline();

            setCurrentAttendant(response.attendant);
        } catch (error) {
            console.error("[inbox] failed to set attendant online", error);
        } finally {
            setIsSettingOnline(false);
        }
    }

    async function handleSendMessage(text: string) {
        if (!selectedId || !text.trim()) return;

        await sendInboxMessage({
            threadId: selectedId,
            text,
        });

        await Promise.all([loadThreads(), loadSelectedThread()]);
    }

    async function handleMoveStage(direction: "previous" | "next") {
        if (!selectedId) return;

        await updateInboxThread({
            threadId: selectedId,
            stageAction: direction,
        });

        await Promise.all([loadThreads(), loadSelectedThread()]);
    }

    async function handleAddNote(text: string) {
        if (!selectedId || !text.trim()) return;

        await addClientNote({
            threadId: selectedId,
            text,
        });

        await loadSelectedThread();
    }

    const isOpeningPage =
        canShowInbox && isLoadingThreads && threads.length === 0 && !selectedThread;

    const selectedListThread =
        threads.find((thread) => thread.id === selectedId) ?? null;

    const selectedThreadMatchesSelection =
        !!selectedThread && selectedThread.id === selectedId;

    const isClientLoading =
        canShowInbox &&
        !!selectedId &&
        (isLoadingSelectedThread || !selectedThreadMatchesSelection);

    const selectedClientId =
        selectedThreadMatchesSelection && selectedThread
            ? selectedThread.client_id
            : selectedListThread?.client_id ?? null;

    return (
        <main className="flex h-screen w-screen overflow-hidden bg-white text-slate-900">
            <SidePanel affectLayout={false} defaultExpanded={false}/>

            <section
                className="grid h-screen min-w-0 flex-1 grid-cols-[minmax(270px,22vw)_minmax(420px,1fr)_minmax(285px,22vw)] gap-3 px-3 py-3"
            >
                {isLoadingCurrentAttendant ? (
                    <>
                        <ConversationListSkeleton />
                        <ChatPanelSkeleton />
                        <CustomerPanelSkeleton />
                    </>
                ) : isNotLinkedToAttendant ? (
                    <InboxAccessState
                        title="Você não é atendente"
                        description="Seu usuário ainda não está vinculado a um atendente do CRM."
                    />
                ) : isCurrentAttendantOffline ? (
                    <InboxAccessState
                        title="Você está offline"
                        description="Fique online para receber e atender conversas no Inbox."
                        actionLabel={isSettingOnline ? "Entrando..." : "Ficar online"}
                        onAction={handleStayOnline}
                        disabled={isSettingOnline}
                    />
                ) : isOpeningPage ? (
                    <>
                        <ConversationListSkeleton />
                        <ChatPanelSkeleton />
                        <CustomerPanelSkeleton />
                    </>
                ) : (
                    <>
                        <ConversationListPanel
                            status={status}
                            onStatusChange={handleStatusChange}
                            search={search}
                            onSearchChange={(value) => {
                                setSearch(value);
                                setCurrentPage(1);
                            }}
                            conversations={threads}
                            totalConversations={totalThreads}
                            totalPages={totalPages}
                            currentPage={currentPage}
                            onPageChange={setCurrentPage}
                            selectedConversationId={selectedId ?? ""}
                            onSelectConversation={handleSelectThread}
                            isLoading={isLoadingThreads}
                        />

                        {selectedId ? (
                            <>
                                <ChatPanel
                                    conversation={selectedThreadMatchesSelection ? selectedThread : null}
                                    headerConversation={
                                        selectedThreadMatchesSelection ? selectedThread : selectedListThread
                                    }
                                    threadId={selectedId}
                                    onSendMessage={handleSendMessage}
                                    isLoading={isClientLoading}
                                />

                                <CustomerPanel
                                    conversation={selectedThreadMatchesSelection ? selectedThread : null}
                                    headerConversation={
                                        selectedThreadMatchesSelection ? selectedThread : selectedListThread
                                    }
                                    clientId={selectedClientId}
                                    onMoveStage={handleMoveStage}
                                    onAddNote={handleAddNote}
                                    onSchedule={() => setSchedulingPanelOpen(true)}
                                    onOpenClientProfile={() => {
                                        if (selectedClientId) {
                                            setClientProfileId(selectedClientId);
                                        }
                                    }}
                                />
                            </>
                        ) : (
                            <>
                                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                                    Selecione uma conversa
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white"/>
                            </>
                        )}
                    </>
                )}
            </section>

            <SchedulingPanel
                open={schedulingPanelOpen}
                threadId={selectedId}
                clientId={selectedClientId}
                onClose={() => setSchedulingPanelOpen(false)}
                onOpenClientProfile={(clientId) => {
                    setSchedulingPanelOpen(false);
                    setClientProfileId(clientId);
                }}
                client={
                    selectedThreadMatchesSelection && selectedThread
                        ? {
                            name: selectedThread.name,
                            phone: selectedThread.phone,
                            city: selectedThread.city,
                            channel: selectedThread.channel,
                        }
                        : selectedListThread
                            ? {
                                name: selectedListThread.name,
                                phone: selectedListThread.phone,
                                city: selectedListThread.city,
                                channel: selectedListThread.channel,
                            }
                            : null
                }
            />

            <ClientPanel
                clientId={clientProfileId}
                onClose={() => setClientProfileId(null)}
            />
        </main>
    );
}

function ConversationListPanel({
                                   status,
                                   onStatusChange,
                                   search,
                                   onSearchChange,
                                   conversations,
                                   totalConversations,
                                   totalPages,
                                   currentPage,
                                   onPageChange,
                                   selectedConversationId,
                                   onSelectConversation,
                                   isLoading,
                               }: {
    status: InboxStatus;
    onStatusChange: (status: InboxStatus) => void;
    search: string;
    onSearchChange: (value: string) => void;
    conversations: InboxThreadListItem[];
    totalConversations: number;
    totalPages: number;
    currentPage: number;
    onPageChange: (page: number) => void;
    selectedConversationId: string;
    onSelectConversation: (id: string) => void;
    isLoading: boolean;
}) {
    return (
        <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="mb-5 shrink-0">
                <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                    Inbox
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                    Atendimento omnichannel em tempo real
                </p>
            </div>

            <div className="mb-4 grid h-10 shrink-0 grid-cols-3 rounded-xl border border-slate-200 bg-white p-1">
                <InboxStatusButton
                    active={status === "open"}
                    onClick={() => onStatusChange("open")}
                >
                    Abertas
                </InboxStatusButton>

                <InboxStatusButton
                    active={status === "pending"}
                    onClick={() => onStatusChange("pending")}
                >
                    Pendentes
                </InboxStatusButton>

                <InboxStatusButton
                    active={status === "closed"}
                    onClick={() => onStatusChange("closed")}
                >
                    Fechadas
                </InboxStatusButton>
            </div>

            <div className="mb-4 flex shrink-0 gap-3">
                <div
                    className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 shadow-sm">
                    <Search size={18} className="shrink-0 text-slate-400"/>

                    <input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="Buscar conversas..."
                        className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                    />
                </div>

                <button
                    type="button"
                    className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                    <SlidersHorizontal size={18}/>
                </button>
            </div>

            <div
                className={`min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 ${scrollbarClass}`}
            >
                {isLoading && <ConversationItemsSkeleton />}

                {!isLoading &&
                    conversations.map((conversation) => (
                        <ConversationListItem
                            key={conversation.id}
                            conversation={conversation}
                            active={conversation.id === selectedConversationId}
                            onClick={() => onSelectConversation(conversation.id)}
                        />
                    ))}

                {!isLoading && conversations.length === 0 && (
                    <div
                        className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                        Nenhuma conversa encontrada.
                    </div>
                )}

                {!isLoading && totalConversations > 0 && (
                    <div className="space-y-4 py-3">
                        <div className="flex items-center justify-between px-2 text-sm text-slate-500">
                            <span>
                                Mostrando{" "}
                                {Math.min(
                                    (currentPage - 1) * PAGE_SIZE + 1,
                                    totalConversations
                                )}
                                –{Math.min(currentPage * PAGE_SIZE, totalConversations)}{" "}
                                de {totalConversations} conversas
                            </span>
                        </div>

                        <Pagination
                            totalPages={totalPages}
                            currentPage={currentPage}
                            onPageChange={onPageChange}
                        />
                    </div>
                )}
            </div>
        </section>
    );
}

function ConversationListItem({
                                  conversation,
                                  active,
                                  onClick,
                              }: {
    conversation: InboxThreadListItem;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`grid w-full cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                active
                    ? "border-brand bg-brand-soft/50 shadow-sm"
                    : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
        >
            <InitialsAvatar name={conversation.name}/>

            <div className="min-w-0">
                <div
                    title={conversation.name}
                    className="truncate font-bold text-slate-950"
                >
                    {conversation.name}
                </div>

                <div
                    title={conversation.preview}
                    className="mt-1 truncate text-sm text-slate-500"
                >
                    {conversation.preview}
                </div>

                <div className="mt-2">
                    <ChannelBadge channel={conversation.channel}/>
                </div>
            </div>

            <div className="flex h-full shrink-0 flex-col items-end justify-between">
                <span
                    className={`whitespace-nowrap text-xs font-medium ${
                        active ? "text-brand" : "text-slate-500"
                    }`}
                >
                    {conversation.time}
                </span>

                {conversation.unread ? (
                    <span
                        className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-2 text-xs font-bold text-white">
                        {conversation.unread}
                    </span>
                ) : (
                    <span/>
                )}
            </div>
        </button>
    );
}

function ChatPanel({
                       conversation,
                       headerConversation,
                       threadId,
                       onSendMessage,
                       isLoading,
                   }: {
    conversation: Conversation | null;
    headerConversation: Pick<Conversation, "name" | "channel"> | Pick<InboxThreadListItem, "name" | "channel"> | null;
    threadId: string | null;
    onSendMessage: (text: string) => Promise<void>;
    isLoading: boolean;
}) {
    const [messageText, setMessageText] = useState("");
    const [isSending, setIsSending] = useState(false);

    const headerName = headerConversation?.name ?? "Carregando conversa";
    const headerChannel = headerConversation?.channel ?? "-";

    async function handleSubmit() {
        const text = messageText.trim();

        if (!conversation || !text || isSending) return;

        setIsSending(true);

        try {
            setMessageText("");
            await onSendMessage(text);
        } finally {
            setIsSending(false);
        }
    }

    return (
        <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-0">
            <div
                className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-5 pb-3">
                <div className="flex min-w-0 items-center gap-4">
                    <div className="shrink-0">
                        <InitialsAvatar name={headerName}/>
                    </div>

                    <div className="min-w-0">
                        <div
                            title={headerName}
                            className="truncate whitespace-nowrap text-xl font-bold text-slate-950"
                        >
                            {headerName}
                        </div>

                        <div
                            className="mt-1 flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-sm text-slate-500">
                            <span className="shrink-0">{headerChannel}</span>
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green"/>
                            <span className="shrink-0">
                                {isLoading ? "Atualizando..." : "Online agora"}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                    <span className="whitespace-nowrap rounded-xl bg-green-soft px-3 py-2 text-xs font-bold text-green">
                        Em atendimento
                    </span>

                    <span className="whitespace-nowrap rounded-xl bg-brand-soft px-3 py-2 text-xs font-bold text-brand">
                        FIV
                    </span>

                    <button
                        type="button"
                        disabled={!threadId}
                        title="Fixar conversa"
                        onClick={() => {
                            if (!threadId) return;
                            openFloatingConversation({type: "thread", id: threadId});
                        }}
                        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Pin size={18} className={"rotate-45 "}/>
                    </button>
                </div>
            </div>

            <ChatMessageList
                messages={conversation?.messages ?? []}
                isLoading={isLoading && !conversation}
                skeleton={<ChatMessagesSkeleton />}
                emptyMessage="Nenhuma mensagem nesta conversa."
                scrollbarClassName={scrollbarClass}
            />

            <div className="shrink-0 border-t border-slate-100 p-1 px-2 pb-0">
                <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <textarea
                        rows={1}
                        value={messageText}
                        disabled={!conversation}
                        onChange={(event) => setMessageText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                handleSubmit();
                            }
                        }}
                        placeholder="Responder como atendente..."
                        className="max-h-28 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-slate-400"
                        onInput={(event) => {
                            const target = event.currentTarget;

                            target.style.height = "auto";
                            target.style.height = `${target.scrollHeight}px`;
                        }}
                    />

                    <div className="flex shrink-0 items-center gap-1 pb-1">
                        <button
                            type="button"
                            title="Emoji"
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                        >
                            <Smile size={18}/>
                        </button>

                        <button
                            type="button"
                            title="Template"
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                        >
                            <FileText size={18}/>
                        </button>

                        <button
                            type="button"
                            title="Anexo"
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                        >
                            <Paperclip size={18}/>
                        </button>

                        <button
                            type="button"
                            title="Enviar"
                            disabled={isSending || !messageText.trim() || !conversation}
                            onClick={handleSubmit}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-brand text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Send size={17}/>
                        </button>
                    </div>
                </div>
            </div>
        </Card>
    );
}

function CustomerPanel({
                           conversation,
                           headerConversation,
                           clientId,
                           onMoveStage,
                           onAddNote,
                           onSchedule,
                           onOpenClientProfile,
                       }: {
    conversation: Conversation | null;
    headerConversation: Pick<Conversation, "name" | "channel"> | Pick<InboxThreadListItem, "name" | "channel"> | null;
    clientId: string | null;
    onMoveStage: (direction: "previous" | "next") => Promise<void>;
    onAddNote: (text: string) => Promise<void>;
    onSchedule: () => void;
    onOpenClientProfile: () => void;
}) {
    const [noteText, setNoteText] = useState("");
    const [isSavingNote, setIsSavingNote] = useState(false);

    const headerName = headerConversation?.name ?? "Carregando cliente";
    const headerChannel = headerConversation?.channel ?? "WhatsApp";

    async function handleAddNote() {
        const text = noteText.trim();

        if (!conversation || !text || isSavingNote) return;

        setIsSavingNote(true);

        try {
            setNoteText("");
            await onAddNote(text);
        } finally {
            setIsSavingNote(false);
        }
    }

    return (
        <aside
            className={`h-full min-h-0 min-w-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${scrollbarClass}`}
        >
            <h2 className="mb-4 text-lg font-bold text-slate-950">Cliente</h2>

            <button
                type="button"
                onClick={onOpenClientProfile}
                disabled={!clientId}
                className="mb-5 flex w-full cursor-pointer items-center justify-between px-1 py-2 text-left transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-60">
                <div className="flex min-w-0 items-center gap-4">
                    <InitialsAvatar name={headerName}/>

                    <div className="min-w-0">
                        <div
                            title={headerName}
                            className="truncate font-bold text-slate-950"
                        >
                            {headerName}
                        </div>

                        {conversation ? (
                            <>
                                <div className="mt-1 text-sm text-slate-500">
                                    {conversation.phone ?? "Sem telefone"}
                                </div>

                                <div className="flex gap-3">
                                    <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                                        <MapPin size={13}/>
                                        <span className="truncate">{conversation.city ?? "Sem cidade"}</span>
                                    </div>
                                    <div className="mt-2">
                                        <ChannelBadge channel={headerChannel}/>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <Skeleton className="mt-2 h-4 w-36 rounded-lg" />
                                <Skeleton className="mt-2 h-4 w-28 rounded-lg" />
                            </>
                        )}

                    </div>
                </div>

                <ChevronRight size={18} className="shrink-0 text-slate-400"/>
            </button>

            {conversation ? (
                <>
                    <button
                        type="button"
                        onClick={onSchedule}
                        className="mb-5 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90"
                    >
                        <CalendarCheck size={17}/>
                        Agendar
                    </button>

                    <PanelBlock>
                        <div className="group/funnel relative px-1 py-2">
                            <div
                                className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/funnel:pointer-events-auto group-hover/funnel:opacity-100">
                                <button
                                    type="button"
                                    title="Retroceder"
                                    onClick={() => onMoveStage("previous")}
                                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-50 hover:text-slate-900"
                                >
                                    <ChevronLeft size={16}/>
                                </button>

                                <button
                                    type="button"
                                    title="Avançar"
                                    onClick={() => onMoveStage("next")}
                                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-50 hover:text-slate-900"
                                >
                                    <ChevronRight size={16}/>
                                </button>
                            </div>

                            <div className="flex min-w-0 items-center gap-3">
                                <div
                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                                    <Funnel size={18}/>
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div
                                        title={conversation.funnel}
                                        className="text-sm font-bold text-slate-950"
                                    >
                                        {conversation.funnel}
                                    </div>

                                    <div
                                        title={conversation.funnelStage}
                                        className="mt-1 text-sm text-slate-500"
                                    >
                                        {conversation.funnelStage}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </PanelBlock>

                    <PanelBlock title="Notas internas">
                        <div className="rounded-2xl border border-slate-200 p-4">
                            {conversation.notes.length > 0 ? (
                                <div className="space-y-3">
                                    {conversation.notes.map((note) => (
                                        <div key={note.id} className="flex gap-3">
                                            <div
                                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-soft text-xs font-bold text-purple">
                                                {getInitials(note.author)}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div
                                                        title={note.author}
                                                        className="truncate text-xs font-bold text-slate-800"
                                                    >
                                                        {note.author}
                                                    </div>

                                                    <div className="shrink-0 text-xs text-slate-400">
                                                        {note.time}
                                                    </div>
                                                </div>

                                                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                                                    {note.text}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-400">
                                    Nenhuma nota interna.
                                </p>
                            )}

                            <div className="mt-4 flex gap-2">
                                <input
                                    value={noteText}
                                    onChange={(event) => setNoteText(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            handleAddNote();
                                        }
                                    }}
                                    placeholder="Adicionar nota..."
                                    className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400"
                                />

                                <button
                                    type="button"
                                    disabled={isSavingNote || !noteText.trim()}
                                    onClick={handleAddNote}
                                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Send size={16}/>
                                </button>
                            </div>
                        </div>
                    </PanelBlock>

                    <PanelBlock title="Dados CRM">
                        <div className="space-y-3 rounded-2xl border border-slate-200 p-4 text-sm">
                            <CrmDataRow icon={<Bot size={16}/>} label="Origem:" value={conversation.origin}/>
                            <CrmDataRow icon={<Filter size={16}/>} label="Campanha:" value={conversation.campaign}/>
                            <CrmDataRow icon={<Clock size={16}/>} label="Último contato:" value={conversation.lastContact}/>
                            <CrmDataRow icon={<UserRound size={16}/>} label="Último responsável:" value={conversation.responsible}/>
                        </div>
                    </PanelBlock>
                </>
            ) : (
                <CustomerPanelBodySkeleton />
            )}
        </aside>
    );
}

function InboxAccessState({
                              title,
                              description,
                              actionLabel,
                              onAction,
                              disabled,
                          }: {
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    disabled?: boolean;
}) {
    return (
        <div className="col-span-3 flex h-full items-center justify-center">
            <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                    <MessagesSquare size={24}/>
                </div>

                <h1 className="text-xl font-bold text-slate-950">
                    {title}
                </h1>

                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                    {description}
                </p>

                {actionLabel && onAction && (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={onAction}
                        className="mt-6 h-11 rounded-xl cursor-pointer bg-brand px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {actionLabel}
                    </button>
                )}
            </div>
        </div>
    );
}

function ConversationListSkeleton() {
    return (
        <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="mb-5 shrink-0">
                <Skeleton className="h-9 w-28 rounded-lg" />
                <Skeleton className="mt-3 h-4 w-56 rounded-lg" />
            </div>

            <Skeleton className="mb-4 h-10 w-full shrink-0 rounded-xl" />

            <div className="mb-4 flex shrink-0 gap-3">
                <Skeleton className="h-11 min-w-0 flex-1 rounded-xl" />
                <Skeleton className="h-11 w-11 rounded-xl" />
            </div>

            <ConversationItemsSkeleton />
        </section>
    );
}

function ConversationItemsSkeleton() {
    return (
        <div className={`min-h-0 flex-1 space-y-3 overflow-hidden pr-1 ${scrollbarClass}`}>
            {Array.from({length: 8}).map((_, index) => (
                <div
                    key={index}
                    className="grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"
                >
                    <Skeleton className="h-11 w-11 rounded-full" />

                    <div className="min-w-0">
                        <Skeleton className="h-4 w-32 rounded-lg" />
                        <Skeleton className="mt-2 h-4 w-full rounded-lg" />
                        <Skeleton className="mt-3 h-6 w-24 rounded-lg" />
                    </div>

                    <div className="flex h-full shrink-0 flex-col items-end justify-between">
                        <Skeleton className="h-3 w-10 rounded-lg" />
                        <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function ChatPanelSkeleton() {
    return (
        <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-0">
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-5 pb-3">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="h-11 w-11 rounded-full" />

                    <div className="min-w-0">
                        <Skeleton className="h-6 w-40 rounded-lg" />
                        <Skeleton className="mt-2 h-4 w-52 rounded-lg" />
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                    <Skeleton className="h-9 w-28 rounded-xl" />
                    <Skeleton className="h-9 w-16 rounded-xl" />
                    <Skeleton className="h-11 w-11 rounded-xl" />
                </div>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-hidden bg-slate-50/40 px-5 py-5">
                <div className="flex items-center justify-center gap-4">
                    <Skeleton className="h-px w-44 rounded-lg" />
                    <Skeleton className="h-6 w-16 rounded-lg" />
                    <Skeleton className="h-px w-44 rounded-lg" />
                </div>

                <div className="space-y-6">
                    <Skeleton className="h-20 w-[min(72%,520px)] rounded-2xl" />
                    <Skeleton className="ml-auto h-24 w-[min(72%,520px)] rounded-2xl" />
                    <Skeleton className="h-16 w-[min(62%,460px)] rounded-2xl" />
                    <Skeleton className="ml-auto h-20 w-[min(68%,500px)] rounded-2xl" />
                </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 p-1 px-2 pb-0">
                <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <Skeleton className="h-10 min-w-0 flex-1 rounded-lg" />

                    <div className="flex shrink-0 items-center gap-1 pb-1">
                        <Skeleton className="h-9 w-9 rounded-lg" />
                        <Skeleton className="h-9 w-9 rounded-lg" />
                        <Skeleton className="h-9 w-9 rounded-lg" />
                        <Skeleton className="h-9 w-9 rounded-lg" />
                    </div>
                </div>
            </div>
        </Card>
    );
}

function ChatMessagesSkeleton() {
    return (
        <div className="space-y-6">
            <Skeleton className="h-20 w-[min(72%,520px)] rounded-2xl" />
            <Skeleton className="ml-auto h-24 w-[min(72%,520px)] rounded-2xl" />
            <Skeleton className="h-16 w-[min(62%,460px)] rounded-2xl" />
            <Skeleton className="ml-auto h-20 w-[min(68%,500px)] rounded-2xl" />
        </div>
    );
}

function CustomerPanelSkeleton() {
    return (
        <aside
            className={`h-full min-h-0 min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${scrollbarClass}`}
        >
            <Skeleton className="mb-4 h-6 w-20 rounded-lg" />

            <div className="mb-5 flex w-full items-center justify-between rounded-2xl border border-slate-200 p-4">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="h-11 w-11 rounded-full" />

                    <div className="min-w-0">
                        <Skeleton className="h-4 w-32 rounded-lg" />
                        <Skeleton className="mt-2 h-4 w-36 rounded-lg" />
                        <Skeleton className="mt-2 h-4 w-28 rounded-lg" />
                        <Skeleton className="mt-3 h-6 w-24 rounded-lg" />
                    </div>
                </div>

                <Skeleton className="h-5 w-5 rounded-lg" />
            </div>

            <CustomerPanelBodySkeleton />
        </aside>
    );
}

function CustomerPanelBodySkeleton() {
    return (
        <>
            <div className="mb-4 rounded-2xl border border-slate-200 p-4">
                <div className="flex min-w-0 items-center gap-3">
                    <Skeleton className="h-11 w-11 rounded-full" />

                    <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-28 rounded-lg" />
                        <Skeleton className="mt-2 h-4 w-40 rounded-lg" />
                    </div>
                </div>
            </div>

            <div className="mb-4">
                <Skeleton className="mb-2.5 h-5 w-32 rounded-lg" />

                <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="space-y-3">
                        <div className="flex gap-3">
                            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                            <div className="min-w-0 flex-1">
                                <Skeleton className="h-3 w-32 rounded-lg" />
                                <Skeleton className="mt-2 h-4 w-full rounded-lg" />
                                <Skeleton className="mt-1 h-4 w-2/3 rounded-lg" />
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                        <Skeleton className="h-10 min-w-0 flex-1 rounded-xl" />
                        <Skeleton className="h-10 w-10 rounded-xl" />
                    </div>
                </div>
            </div>

            <div>
                <Skeleton className="mb-2.5 h-5 w-24 rounded-lg" />

                <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                    <Skeleton className="h-4 w-full rounded-lg" />
                    <Skeleton className="h-4 w-11/12 rounded-lg" />
                    <Skeleton className="h-4 w-10/12 rounded-lg" />
                    <Skeleton className="h-4 w-full rounded-lg" />
                </div>
            </div>
        </>
    );
}

function InboxStatusButton({
                               active,
                               onClick,
                               children,
                           }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`cursor-pointer rounded-lg text-xs font-bold transition-colors ${
                active
                    ? "bg-brand text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
        >
            {children}
        </button>
    );
}

function ChannelBadge({channel}: { channel: InboxChannel }) {
    const className =
        channel === "WhatsApp"
            ? "bg-green-soft text-green"
            : channel === "Instagram"
                ? "bg-pink-soft text-pink"
                : "bg-blue-soft text-blue";

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${className}`}
        >
            <ChannelIcon channel={channel}/>
        </span>
    );
}

function ChannelIcon({channel}: { channel: InboxChannel }) {
    if (channel === "WhatsApp") {
        return <FaWhatsapp size={14}/>;
    }

    if (channel === "Instagram") {
        return <FaInstagram size={14}/>;
    }

    return <FaFacebookF size={13}/>;
}

function PanelBlock({
                        title,
                        children,
                    }: {
    title?: string | null;
    children: React.ReactNode;
}) {
    return (
        <div className="mb-6">
            {title && (
                <h3 className="mb-2.5 text-base font-bold text-slate-950">{title}</h3>
            )}

            {children}
        </div>
    );
}

function CrmDataRow({
                        icon,
                        label,
                        value,
                    }: {
    icon: React.ReactNode;
    label: string;
    value: string | null;
}) {
    return (
        <div className="grid grid-cols-[22px_1fr_1.25fr] items-center gap-2">
            <div className="text-slate-400">{icon}</div>
            <div className="text-slate-500">{label}</div>
            <div title={value ?? "-"} className="truncate font-bold text-slate-700">
                {value ?? "-"}
            </div>
        </div>
    );
}

function getInitials(name: string) {
    const words = name.trim().split(/\s+/);

    return words
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase())
        .join("");
}
