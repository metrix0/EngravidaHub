// app/inbox/page.tsx
"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
    Bot,
    Archive,
    CalendarCheck,
    ChevronLeft,
    ChevronRight,
    Clock,
    FileText,
    Filter,
    Funnel,
    MapPin,
    LoaderCircle,
    MessagesSquare,
    Paperclip, Pin,
    Search,
    Send,
    SlidersHorizontal,
    Smile,
    UserRound,
    X,
} from "lucide-react";
import {FaFacebookF, FaInstagram, FaWhatsapp} from "react-icons/fa6";

import {Card, Pagination, Skeleton} from "@/components";
import {InitialsAvatar} from "@/components/conversations/InitialsAvatar";
import {openClientProfile} from "@/components/clientes/PermanentClientProfilePanel";
import { ChatMessageList } from "@/components/conversations/ChatMessageList";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import SchedulingPanel from "@/components/inbox/SchedulingPanel";
import SidePanel from "@/components/layout/SidePanel";
import { supabase } from "@/lib/supabase/client";

import {
    addClientNote,
    fetchInboxThread,
    fetchInboxThreads,
    fetchPreviousInboxConversation,
    finalizeInboxThread,
    sendInboxMessage,
    updateInboxThread,
} from "@/lib/inbox/inboxApi";
import {
    claimNextInboxConversation,
    fetchInboxQueueCount,
} from "@/lib/inbox/queueApi";
import {useInboxRealtime} from "@/lib/inbox/useInboxRealtime";
import {
    fetchCurrentAttendant,
    setCurrentAttendantOnline,
    type CurrentAttendant,
} from "@/lib/attendants/currentAttendantApi";
import type {
    InboxChannel,
    InboxHistoryConversation,
    InboxItemType,
    InboxMessage,
    InboxStatus,
    InboxThreadDetail,
    InboxThreadListItem,
} from "@/types/inbox";

type Conversation = InboxThreadDetail;

const PAGE_SIZE = 10;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/3gpp",
    "audio/aac",
    "audio/amr",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
]);
const ATTACHMENT_ACCEPT = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/3gpp",
    "audio/aac",
    "audio/amr",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".csv",
].join(",");
const COMMON_EMOJIS = [
    "😀", "😂", "😊", "😍", "🥰", "😘", "😉", "🙂",
    "😅", "😢", "😭", "😔", "🤔", "🙌", "👏", "🙏",
    "👍", "👎", "❤️", "💙", "💚", "💛", "✨", "🎉",
    "✅", "❌", "📅", "⏰", "📍", "📎", "📞", "💬",
];

type PersistedSentMessage = {
    id: string;
    sender_type?: string | null;
    sender_name?: string | null;
    text?: string | null;
    sent_at?: string | null;
    sequence_index?: number | null;
};

type InboxSendResult = {
    ok: true;
    thread_id: string;
    reopened: boolean;
    message?: PersistedSentMessage | null;
};

type PreparedAttachment = {
    ok: true;
    bucket: string;
    path: string;
    token: string;
    thread_id: string;
};

const scrollbarClass =
    "[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]";

export default function InboxPage() {
    const [status, setStatus] = useState<InboxStatus>("open");
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedItemType, setSelectedItemType] =
        useState<InboxItemType>("thread");
    const [currentPage, setCurrentPage] = useState(1);

    const [threads, setThreads] = useState<InboxThreadListItem[]>([]);
    const [totalThreads, setTotalThreads] = useState(0);
    const [selectedThread, setSelectedThread] = useState<InboxThreadDetail | null>(null);
    const [schedulingPanelOpen, setSchedulingPanelOpen] = useState(false);

    const [isLoadingThreads, setIsLoadingThreads] = useState(true);
    const [isLoadingSelectedThread, setIsLoadingSelectedThread] = useState(false);

    const [currentAttendant, setCurrentAttendant] =
        useState<CurrentAttendant | null>(null);
    const [isLoadingCurrentAttendant, setIsLoadingCurrentAttendant] = useState(true);
    const [isSettingOnline, setIsSettingOnline] = useState(false);

    const [queueCount, setQueueCount] = useState(0);
    const [isPullingConversation, setIsPullingConversation] = useState(false);
    const [isFinalizingConversation, setIsFinalizingConversation] = useState(false);

    const [historyConversations, setHistoryConversations] =
        useState<InboxHistoryConversation[]>([]);
    const [historyBefore, setHistoryBefore] = useState<string | null>(null);
    const [hasOlderConversations, setHasOlderConversations] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const historyLoadedRef = useRef(false);
    const forcedSelectionRef = useRef<{
        id: string;
        itemType: InboxItemType;
    } | null>(null);
    const selectedThreadRequestRef = useRef(0);
    const finalizingThreadIdRef = useRef<string | null>(null);

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

    const loadThreads = useCallback(async ({
        showLoading = true,
    }: {
        showLoading?: boolean;
    } = {}) => {
        if (showLoading) {
            setIsLoadingThreads(true);
        }

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
                const expectedItemType: InboxItemType =
                    status === "closed" ? "conversation" : "thread";
                const forcedSelection = forcedSelectionRef.current;

                if (
                    forcedSelection &&
                    forcedSelection.itemType === expectedItemType
                ) {
                    setSelectedItemType(forcedSelection.itemType);
                    return forcedSelection.id;
                }

                // The selected conversation belongs to the middle panel.
                // Changing the left-side tab must never replace it.
                if (currentSelectedId) {
                    return currentSelectedId;
                }

                // Select the first list item only when nothing is open yet.
                const nextItem = response.items[0] ?? null;

                setSelectedItemType(
                    nextItem?.item_type ?? expectedItemType,
                );

                return nextItem?.id ?? null;
            });
        } catch (error) {
            console.error("[inbox] failed to load threads", error);

            if (showLoading) {
                setThreads([]);
                setTotalThreads(0);
            }
        } finally {
            if (showLoading) {
                setIsLoadingThreads(false);
            }
        }
    }, [status, search, currentPage]);

    const loadQueueCount = useCallback(async () => {
        try {
            const response = await fetchInboxQueueCount();
            setQueueCount(response.count);
        } catch (error) {
            console.error("[inbox] failed to load queue count", error);
            setQueueCount(0);
        }
    }, []);

    const loadSelectedThread = useCallback(async () => {
        if (
            selectedItemType === "thread" &&
            selectedId !== null &&
            selectedId === finalizingThreadIdRef.current
        ) {
            return;
        }

        const requestId = ++selectedThreadRequestRef.current;

        if (!selectedId) {
            setSelectedThread(null);
            setIsLoadingSelectedThread(false);
            return;
        }

        setIsLoadingSelectedThread(true);

        try {
            const response = await fetchInboxThread(
                selectedId,
                selectedItemType,
            );

            if (requestId !== selectedThreadRequestRef.current) {
                return;
            }

            setSelectedThread(response.item);

            if (!historyLoadedRef.current) {
                setHistoryBefore(response.item.history_before);
                setHasOlderConversations(
                    response.item.has_older_conversations,
                );
            }
        } catch (error) {
            if (requestId !== selectedThreadRequestRef.current) {
                return;
            }

            console.error("[inbox] failed to load selected thread", error);
            setSelectedThread(null);
        } finally {
            if (requestId === selectedThreadRequestRef.current) {
                setIsLoadingSelectedThread(false);
            }
        }
    }, [selectedId, selectedItemType]);

    useEffect(() => {
        historyLoadedRef.current = false;
        setHistoryConversations([]);
        setHistoryBefore(null);
        setHasOlderConversations(false);
    }, [selectedId, selectedItemType]);

    useEffect(() => {
        let isMounted = true;

        async function loadCurrentAttendant() {
            setIsLoadingCurrentAttendant(true);

            try {
                const response = await fetchCurrentAttendant({ force: true });

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

        void Promise.all([loadThreads(), loadQueueCount()]);
    }, [canShowInbox, loadQueueCount, loadThreads]);

    useEffect(() => {
        if (!canShowInbox) return;

        loadSelectedThread();
    }, [canShowInbox, loadSelectedThread]);

    const handleRealtimeThreadChange = useCallback(() => {
        void Promise.all([
            loadThreads({ showLoading: false }),
            loadQueueCount(),
        ]);
    }, [loadQueueCount, loadThreads]);

    useInboxRealtime({
        selectedItemId: canShowInbox ? selectedId : null,
        selectedItemType,
        selectedThreadId: canShowInbox
            ? selectedThread?.thread_id ?? null
            : null,
        selectedClientId: canShowInbox
            ? selectedThread?.client_id ?? null
            : null,
        onThreadChange: handleRealtimeThreadChange,
        onSelectedThreadChange: loadSelectedThread,
    });

    function handleSelectThread(item: InboxThreadListItem) {
        forcedSelectionRef.current = null;
        selectedThreadRequestRef.current += 1;

        setSelectedId(item.id);
        setSelectedItemType(item.item_type);
        setSelectedThread(null);

        setThreads((currentThreads) =>
            currentThreads.map((thread) =>
                thread.id === item.id
                    ? {
                        ...thread,
                        unread: 0,
                    }
                    : thread,
            ),
        );
    }

    function handleStatusChange(nextStatus: InboxStatus) {
        if (nextStatus === status) return;

        forcedSelectionRef.current = null;
        setStatus(nextStatus);
        setCurrentPage(1);
    }

    async function handlePullConversation() {
        if (isPullingConversation || queueCount <= 0) return;

        setIsPullingConversation(true);

        try {
            const result = await claimNextInboxConversation();

            await loadQueueCount();

            if (!result.thread_id) {
                return;
            }

            forcedSelectionRef.current = {
                id: result.thread_id,
                itemType: "thread",
            };
            selectedThreadRequestRef.current += 1;

            setStatus("open");
            setSearch("");
            setCurrentPage(1);
            setSelectedId(result.thread_id);
            setSelectedItemType("thread");
            setSelectedThread(null);

            const [threadResponse, listResponse] = await Promise.all([
                fetchInboxThread(result.thread_id, "thread"),
                fetchInboxThreads({
                    status: "open",
                    search: "",
                    page: 1,
                    pageSize: PAGE_SIZE,
                }),
            ]);

            setSelectedThread(threadResponse.item);
            setThreads(listResponse.items);
            setTotalThreads(listResponse.total);
        } catch (error) {
            console.error("[inbox] failed to claim conversation", error);
        } finally {
            setIsPullingConversation(false);
        }
    }

    async function handleFinalizeConversation() {
        const threadId = selectedThread?.thread_id;

        if (
            !threadId ||
            selectedItemType !== "thread" ||
            isFinalizingConversation
        ) {
            return;
        }

        const selectedIndex = Math.max(
            0,
            threads.findIndex((thread) => thread.id === selectedId),
        );

        finalizingThreadIdRef.current = threadId;
        selectedThreadRequestRef.current += 1;
        setIsLoadingSelectedThread(false);
        setIsFinalizingConversation(true);

        try {
            const result = await finalizeInboxThread(threadId);

            // Keep the current Abertas/Fechadas tab and its current search.
            let targetPage = currentPage;

            let listResponse = await fetchInboxThreads({
                status,
                search,
                page: targetPage,
                pageSize: PAGE_SIZE,
            });

            // Closing the last item on a page can reduce the page count.
            const lastAvailablePage = Math.max(
                1,
                Math.ceil(listResponse.total / PAGE_SIZE),
            );

            if (targetPage > lastAvailablePage) {
                targetPage = lastAvailablePage;

                listResponse = await fetchInboxThreads({
                    status,
                    search,
                    page: targetPage,
                    pageSize: PAGE_SIZE,
                });
            }

            // Never automatically open the conversation that was just closed.
            const availableItems = listResponse.items.filter(
                (item) =>
                    item.id !== result.conversation_id &&
                    item.id !== threadId,
            );

            const nextItem =
                availableItems[
                    Math.min(
                        selectedIndex,
                        Math.max(availableItems.length - 1, 0),
                    )
                ] ??
                availableItems[0] ??
                null;

            selectedThreadRequestRef.current += 1;

            setThreads(listResponse.items);
            setTotalThreads(listResponse.total);
            setCurrentPage(targetPage);

            if (nextItem) {
                forcedSelectionRef.current = {
                    id: nextItem.id,
                    itemType: nextItem.item_type,
                };

                setSelectedId(nextItem.id);
                setSelectedItemType(nextItem.item_type);
                setSelectedThread(null);
            } else {
                forcedSelectionRef.current = null;

                setSelectedId(null);
                setSelectedThread(null);
                setSelectedItemType(
                    status === "closed" ? "conversation" : "thread",
                );
            }

            await loadQueueCount();
        } catch (error) {
            console.error("[inbox] failed to finalize conversation", error);
        } finally {
            if (finalizingThreadIdRef.current === threadId) {
                finalizingThreadIdRef.current = null;
            }

            setIsFinalizingConversation(false);
        }
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

    async function applySendResult(result: InboxSendResult) {
        if (result.reopened) {
            forcedSelectionRef.current = {
                id: result.thread_id,
                itemType: "thread",
            };
            selectedThreadRequestRef.current += 1;

            setStatus("open");
            setSearch("");
            setCurrentPage(1);
            setSelectedId(result.thread_id);
            setSelectedItemType("thread");
            setSelectedThread(null);

            const [threadResponse, listResponse] = await Promise.all([
                fetchInboxThread(result.thread_id, "thread"),
                fetchInboxThreads({
                    status: "open",
                    search: "",
                    page: 1,
                    pageSize: PAGE_SIZE,
                }),
            ]);

            setSelectedThread(threadResponse.item);
            setThreads(listResponse.items);
            setTotalThreads(listResponse.total);
            return;
        }

        const sentMessage = mapPersistedSentMessage(result.message);

        if (!sentMessage) {
            await loadSelectedThread();
            return;
        }

        const preview = getMessagePreview(sentMessage.text);

        setSelectedThread((currentThread) => {
            if (
                !currentThread ||
                currentThread.thread_id !== result.thread_id ||
                currentThread.messages.some((message) => message.id === sentMessage.id)
            ) {
                return currentThread;
            }

            return {
                ...currentThread,
                preview,
                time: "agora",
                lastContact: "agora",
                messages: [...currentThread.messages, sentMessage],
            };
        });

        setThreads((currentThreads) =>
            currentThreads.map((thread) =>
                thread.id === result.thread_id ||
                thread.thread_id === result.thread_id
                    ? {
                        ...thread,
                        preview,
                        time: "agora",
                        lastContact: "agora",
                        unread: 0,
                    }
                    : thread,
            ),
        );
    }

    async function handleSendMessage(text: string) {
        const itemId = selectedId;
        const itemType = selectedItemType;
        if (!itemId || !text.trim()) return;

        const result = await sendInboxMessage({
            itemId,
            itemType,
            text,
        });

        await applySendResult(result);
    }

    async function handleSendAttachment(file: File) {
        const itemId = selectedId;
        const itemType = selectedItemType;
        if (!itemId) return;

        const mimeType = getAttachmentMimeType(file);
        const validationError = validateAttachmentFile(file, mimeType);
        if (validationError) throw new Error(validationError);

        const prepareResponse = await fetch(
            `/api/inbox/threads/${encodeURIComponent(itemId)}/messages`,
            {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "prepare_attachment",
                    item_type: itemType,
                    file_name: file.name,
                    mime_type: mimeType,
                    size: file.size,
                }),
            },
        );
        const prepareJson = await prepareResponse.json();

        if (!prepareResponse.ok) {
            throw new Error(prepareJson.error ?? "Não foi possível preparar o anexo.");
        }

        const prepared = prepareJson as PreparedAttachment;
        const { error: uploadError } = await supabase.storage
            .from(prepared.bucket)
            .uploadToSignedUrl(prepared.path, prepared.token, file, {
                contentType: mimeType,
                upsert: false,
            });

        if (uploadError) {
            throw new Error(`Não foi possível enviar o arquivo: ${uploadError.message}`);
        }

        const sendResponse = await fetch(
            `/api/inbox/threads/${encodeURIComponent(itemId)}/messages`,
            {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "send_attachment",
                    item_type: itemType,
                    attachment: {
                        path: prepared.path,
                        name: file.name,
                        mime_type: mimeType,
                        size: file.size,
                    },
                }),
            },
        );
        const sendJson = await sendResponse.json();

        if (!sendResponse.ok) {
            throw new Error(sendJson.error ?? "Não foi possível enviar o anexo.");
        }

        await applySendResult(sendJson as InboxSendResult);
    }

    async function handleLoadPreviousConversation() {
        if (
            !selectedThread ||
            !historyBefore ||
            !hasOlderConversations ||
            isLoadingHistory
        ) {
            return;
        }

        setIsLoadingHistory(true);

        try {
            const response = await fetchPreviousInboxConversation({
                clientId: selectedThread.client_id,
                instagramUserId: selectedThread.instagram_user_id,
                before: historyBefore,
            });

            historyLoadedRef.current = true;

            if (!response.item) {
                setHasOlderConversations(false);
                return;
            }

            setHistoryConversations((current) => [
                response.item!,
                ...current,
            ]);
            setHistoryBefore(response.next_before);
            setHasOlderConversations(response.has_more);
        } catch (error) {
            console.error("[inbox] failed to load previous conversation", error);
        } finally {
            setIsLoadingHistory(false);
        }
    }

    async function handleMoveStage(direction: "previous" | "next") {
        const threadId = selectedThread?.thread_id;
        if (!threadId) return;

        await updateInboxThread({
            threadId,
            stageAction: direction,
        });

        await Promise.all([loadThreads(), loadSelectedThread()]);
    }

    async function handleAddNote(text: string) {
        const threadId = selectedThread?.thread_id;
        if (!threadId || !text.trim()) return;

        await addClientNote({
            threadId,
            text,
        });

        await loadSelectedThread();
    }

    const isOpeningPage =
        canShowInbox && isLoadingThreads && threads.length === 0 && !selectedThread;

    const selectedListThread =
        threads.find((thread) => thread.id === selectedId) ?? null;

    const selectedThreadMatchesSelection =
        !!selectedThread &&
        selectedThread.id === selectedId &&
        selectedThread.item_type === selectedItemType;

    const displayedMessages = useMemo<InboxMessage[]>(() => {
        return [
            ...historyConversations.flatMap((item) => item.messages),
            ...(selectedThreadMatchesSelection && selectedThread
                ? selectedThread.messages
                : []),
        ];
    }, [historyConversations, selectedThread, selectedThreadMatchesSelection]);

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
                            queueCount={queueCount}
                            isPullingConversation={isPullingConversation}
                            onPullConversation={handlePullConversation}
                            search={search}
                            onSearchChange={(value) => {
                                forcedSelectionRef.current = null;
                                setSearch(value);
                                setCurrentPage(1);
                            }}
                            conversations={threads}
                            totalConversations={totalThreads}
                            totalPages={totalPages}
                            currentPage={currentPage}
                            onPageChange={(page) => {
                                forcedSelectionRef.current = null;
                                selectedThreadRequestRef.current += 1;
                                setSelectedId(null);
                                setSelectedThread(null);
                                setCurrentPage(page);
                            }}
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
                                    clientId={selectedClientId}
                                    itemId={selectedId}
                                    itemType={selectedItemType}
                                    displayMessages={displayedMessages}
                                    onSendMessage={handleSendMessage}
                                    onSendAttachment={handleSendAttachment}
                                    onFinalizeConversation={handleFinalizeConversation}
                                    canFinalize={
                                        selectedItemType === "thread" &&
                                        selectedThreadMatchesSelection &&
                                        selectedThread?.status === "open"
                                    }
                                    isFinalizingConversation={isFinalizingConversation}
                                    onLoadPreviousConversation={handleLoadPreviousConversation}
                                    hasOlderConversations={hasOlderConversations}
                                    isLoadingHistory={isLoadingHistory}
                                    isLoading={isClientLoading}
                                    onOpenClientProfile={() => {
                                        if (selectedClientId) openClientProfile(selectedClientId);
                                    }}
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
                                        if (selectedClientId) openClientProfile(selectedClientId);
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
                threadId={
                    selectedThreadMatchesSelection
                        ? selectedThread?.thread_id ?? null
                        : selectedListThread?.thread_id ?? null
                }
                clientId={selectedClientId}
                onClose={() => setSchedulingPanelOpen(false)}
                onOpenClientProfile={(clientId) => {
                    setSchedulingPanelOpen(false);
                    openClientProfile(clientId);
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
        </main>
    );
}

function ConversationListPanel({
                                   status,
                                   onStatusChange,
                                   queueCount,
                                   isPullingConversation,
                                   onPullConversation,
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
    queueCount: number;
    isPullingConversation: boolean;
    onPullConversation: () => void;
    search: string;
    onSearchChange: (value: string) => void;
    conversations: InboxThreadListItem[];
    totalConversations: number;
    totalPages: number;
    currentPage: number;
    onPageChange: (page: number) => void;
    selectedConversationId: string;
    onSelectConversation: (item: InboxThreadListItem) => void;
    isLoading: boolean;
}) {
    return (
        <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="mb-4 shrink-0">
                <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                    Inbox
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                    Atendimento omnichannel em tempo real
                </p>
            </div>

            <div className="mb-4 shrink-0 rounded-xl p-1">
                <div className="flex items-center justify-left gap-3">
                    <button
                        type="button"
                        onClick={onPullConversation}
                        disabled={queueCount <= 0 || isPullingConversation}
                        className="flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none"
                    >
                        {isPullingConversation ? "Puxando..." : "Puxar conversa"}
                    </button>
                    <div className="min-w-0">
                        <div className="text-sm text-slate-500">
                            {queueCount} na fila
                        </div>
                    </div>


                </div>
            </div>

            <div className="mb-4 grid h-10 shrink-0 grid-cols-2 rounded-xl border border-slate-200 bg-white p-1">
                <InboxStatusButton
                    active={status === "open"}
                    onClick={() => onStatusChange("open")}
                >
                    Abertas
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
                            onClick={() => onSelectConversation(conversation)}
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
                       clientId,
                       itemId,
                       itemType,
                       displayMessages,
                       onSendMessage,
                       onSendAttachment,
                       onFinalizeConversation,
                       canFinalize,
                       isFinalizingConversation,
                       onLoadPreviousConversation,
                       hasOlderConversations,
                       isLoadingHistory,
                       isLoading,
                       onOpenClientProfile,
                   }: {
    conversation: Conversation | null;
    headerConversation: Pick<Conversation, "name" | "channel"> | Pick<InboxThreadListItem, "name" | "channel"> | null;
    clientId: string | null;
    itemId: string | null;
    itemType: InboxItemType;
    displayMessages: InboxMessage[];
    onSendMessage: (text: string) => Promise<void>;
    onSendAttachment: (file: File) => Promise<void>;
    onFinalizeConversation: () => Promise<void>;
    canFinalize: boolean;
    isFinalizingConversation: boolean;
    onLoadPreviousConversation: () => Promise<void>;
    hasOlderConversations: boolean;
    isLoadingHistory: boolean;
    isLoading: boolean;
    onOpenClientProfile: () => void;
}) {
    const [messageText, setMessageText] = useState("");
    const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const headerName = headerConversation?.name ?? "Carregando conversa";
    const headerChannel = headerConversation?.channel ?? "WhatsApp";

    useEffect(() => {
        setMessageText("");
        setSelectedAttachment(null);
        setEmojiPickerOpen(false);
        setSendError(null);
    }, [itemId, itemType]);

    function insertEmoji(emoji: string) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? messageText.length;
        const selectionEnd = textarea?.selectionEnd ?? selectionStart;
        const nextText =
            messageText.slice(0, selectionStart) +
            emoji +
            messageText.slice(selectionEnd);

        setMessageText(nextText);
        setSendError(null);

        window.requestAnimationFrame(() => {
            const nextPosition = selectionStart + emoji.length;
            textarea?.focus();
            textarea?.setSelectionRange(nextPosition, nextPosition);
        });
    }

    function selectAttachment(file: File | null) {
        if (!file) return;

        const mimeType = getAttachmentMimeType(file);
        const validationError = validateAttachmentFile(file, mimeType);

        if (validationError) {
            setSelectedAttachment(null);
            setSendError(validationError);
            return;
        }

        setSelectedAttachment(file);
        setSendError(null);
    }

    async function handleSubmit() {
        const text = messageText.trim();
        const attachment = selectedAttachment;

        if (
            !conversation ||
            !conversation.can_reply ||
            (!text && !attachment) ||
            isSending
        ) {
            return;
        }

        setIsSending(true);
        setSendError(null);

        try {
            if (text) {
                await onSendMessage(text);
                setMessageText("");
            }

            if (attachment) {
                await onSendAttachment(attachment);
                setSelectedAttachment(null);
            }
        } catch (error) {
            setSendError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível enviar a mensagem.",
            );
        } finally {
            setIsSending(false);
        }
    }

    return (
        <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-0">
            <div
                className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-5 pb-3">
                <button
                    type="button"
                    disabled={!clientId}
                    onClick={onOpenClientProfile}
                    title={clientId ? `Abrir perfil de ${headerName}` : undefined}
                    className={`flex min-w-0 items-center gap-4 text-left ${
                        clientId
                            ? "cursor-pointer transition-opacity hover:opacity-80"
                            : "cursor-default"
                    }`}
                >
                    <div className="shrink-0">
                        <InitialsAvatar name={headerName}/>
                    </div>

                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <div
                                title={headerName}
                                className="truncate whitespace-nowrap text-xl font-bold text-slate-950"
                            >
                                {headerName}
                            </div>
                            <ChannelBadge channel={headerChannel} />
                        </div>
                    </div>
                </button>

                <div className="flex shrink-0 items-center gap-3">
                    <span
                        className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold ${
                            conversation?.status === "closed"
                                ? "bg-slate-100 text-slate-600"
                                : "bg-green-soft text-green"
                        }`}
                    >
                        {conversation?.status === "closed"
                            ? "Fechada"
                            : "Em atendimento"}
                    </span>

                    <span className="whitespace-nowrap rounded-xl bg-brand-soft px-3 py-2 text-xs font-bold text-brand">
                        FIV
                    </span>

                    <button
                        type="button"
                        disabled={!itemId}
                        title="Fixar conversa"
                        onClick={() => {
                            if (!itemId) return;
                            openFloatingConversation({type: itemType, id: itemId});
                        }}
                        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Pin size={18} className={"rotate-45 "}/>
                    </button>

                    {itemType === "thread" && (
                        <button
                            type="button"
                            disabled={!canFinalize || !itemId || isFinalizingConversation}
                            title="Finalizar conversa"
                            onClick={() => void onFinalizeConversation()}
                            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-red/30 hover:bg-red-soft hover:text-red disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isFinalizingConversation ? (
                                <LoaderCircle size={18} className="animate-spin"/>
                            ) : (
                                <Archive size={18}/>
                            )}
                        </button>
                    )}
                </div>
            </div>

            <ChatMessageList
                messages={displayMessages}
                isLoading={isLoading && !conversation}
                skeleton={<ChatMessagesSkeleton />}
                emptyMessage="Nenhuma mensagem nesta conversa."
                scrollbarClassName={scrollbarClass}
                topContent={
                    hasOlderConversations ? (
                        <div className="flex justify-center">
                            <button
                                type="button"
                                onClick={() => void onLoadPreviousConversation()}
                                disabled={isLoadingHistory}
                                className="flex h-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isLoadingHistory
                                    ? "Carregando..."
                                    : "Carregar conversa anterior"}
                            </button>
                        </div>
                    ) : null
                }
            />

            <div className="shrink-0 border-t border-slate-100 p-1 px-2 pb-0">
                {sendError ? (
                    <div className="mb-2 rounded-xl bg-red-soft px-3 py-2 text-xs font-semibold text-red">
                        {sendError}
                    </div>
                ) : null}

                {selectedAttachment ? (
                    <div className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <Paperclip size={16} className="shrink-0 text-slate-500" />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-700">
                                {selectedAttachment.name}
                            </div>
                            <div className="text-xs text-slate-400">
                                {formatAttachmentSize(selectedAttachment.size)}
                            </div>
                        </div>
                        <button
                            type="button"
                            title="Remover anexo"
                            disabled={isSending}
                            onClick={() => setSelectedAttachment(null)}
                            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <X size={16} />
                        </button>
                    </div>
                ) : null}

                <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={messageText}
                        disabled={!conversation || !conversation.can_reply || isSending}
                        onChange={(event) => {
                            setMessageText(event.target.value);
                            setSendError(null);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void handleSubmit();
                            }
                        }}
                        placeholder={
                            conversation && !conversation.can_reply
                                ? "Janela de 24h encerrada"
                                : "Responder como atendente..."
                        }
                        className="max-h-28 min-h-[34px] min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-slate-400"
                        onInput={(event) => {
                            const target = event.currentTarget;
                            target.style.height = "auto";
                            target.style.height = `${target.scrollHeight}px`;
                        }}
                    />

                    <div className="flex shrink-0 items-center gap-1 pb-1">
                        <div className="relative">
                            <button
                                type="button"
                                title="Emoji"
                                disabled={!conversation || !conversation.can_reply || isSending}
                                onClick={() => setEmojiPickerOpen((current) => !current)}
                                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Smile size={18}/>
                            </button>

                            {emojiPickerOpen ? (
                                <div className="absolute bottom-11 right-0 z-30 w-[272px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                                    <div className="mb-2 flex items-center justify-between px-1">
                                        <span className="text-xs font-bold text-slate-500">
                                            Emojis
                                        </span>
                                        <button
                                            type="button"
                                            title="Fechar emojis"
                                            onClick={() => setEmojiPickerOpen(false)}
                                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                                        >
                                            <X size={15}/>
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-8 gap-1">
                                        {COMMON_EMOJIS.map((emoji) => (
                                            <button
                                                key={emoji}
                                                type="button"
                                                onClick={() => insertEmoji(emoji)}
                                                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-lg transition hover:bg-slate-100"
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <button
                            type="button"
                            title="Template"
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                        >
                            <FileText size={18}/>
                        </button>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={ATTACHMENT_ACCEPT}
                            className="hidden"
                            onChange={(event) => {
                                selectAttachment(event.target.files?.[0] ?? null);
                                event.currentTarget.value = "";
                            }}
                        />
                        <button
                            type="button"
                            title="Anexo"
                            disabled={!conversation || !conversation.can_reply || isSending}
                            onClick={() => {
                                fileInputRef.current?.click();
                            }}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Paperclip size={18}/>
                        </button>

                        <button
                            type="button"
                            title="Enviar"
                            disabled={
                                isSending ||
                                (!messageText.trim() && !selectedAttachment) ||
                                !conversation ||
                                !conversation.can_reply
                            }
                            onClick={() => void handleSubmit()}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-brand text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSending ? (
                                <LoaderCircle size={17} className="animate-spin" />
                            ) : (
                                <Send size={17}/>
                            )}
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
            <h2 className="mb-4 text-lg font-bold text-slate-950">
                {headerChannel === "Instagram"
                    ? "Usuário do Instagram"
                    : "Cliente"}
            </h2>

            <button
                type="button"
                onClick={onOpenClientProfile}
                disabled={!clientId}
                className={`mb-5 flex w-full items-center justify-between px-1 py-2 text-left ${
                    clientId
                        ? "cursor-pointer transition-opacity hover:opacity-80"
                        : "cursor-default"
                }`}>
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
                                    {headerChannel === "Instagram"
                                        ? conversation.instagram_username
                                            ? `@${conversation.instagram_username.replace(/^@+/, "")}`
                                            : "Instagram"
                                        : conversation.phone ?? "Sem telefone"}
                                </div>

                                <div className="flex gap-3">
                                    <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                                        <MapPin size={13}/>
                                        <span className="truncate">{conversation.unit_name ?? "Sem unidade"}</span>
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

                {clientId ? (
                    <ChevronRight
                        size={18}
                        className="shrink-0 text-slate-400"
                    />
                ) : null}
            </button>

            {conversation ? (
                clientId ? (
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
                                    {isSavingNote ? (
                                        <LoaderCircle size={16} className="animate-spin"/>
                                    ) : (
                                        <Send size={16}/>
                                    )}
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
                ) : null
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
            <div className="mb-4 shrink-0">
                <Skeleton className="h-9 w-28 rounded-lg" />
                <Skeleton className="mt-3 h-4 w-56 rounded-lg" />
            </div>

            <div className="mb-4 flex h-10 shrink-0 items-center gap-3 px-1">
                <Skeleton className="h-10 w-[140px] rounded-xl" />
                <Skeleton className="h-4 w-16 rounded-lg" />
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

function getAttachmentMimeType(file: File) {
    if (file.type) return file.type.toLowerCase();

    const extension = file.name.split(".").pop()?.toLowerCase();
    const mimeByExtension: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
        mp4: "video/mp4",
        "3gp": "video/3gpp",
        aac: "audio/aac",
        amr: "audio/amr",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        ogg: "audio/ogg",
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ppt: "application/vnd.ms-powerpoint",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        txt: "text/plain",
        csv: "text/csv",
    };

    return extension ? mimeByExtension[extension] ?? "" : "";
}

function validateAttachmentFile(file: File, mimeType: string) {
    if (!mimeType || !SUPPORTED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
        return "Este tipo de arquivo não é compatível com este canal.";
    }

    if (file.size <= 0) return "O anexo está vazio.";
    if (file.size > MAX_ATTACHMENT_BYTES) {
        return "O anexo deve ter no máximo 16 MB.";
    }

    return null;
}

function formatAttachmentSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChatPanelSkeleton() {
    return (
        <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-0">
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-5 pb-3">
                <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="h-11 w-11 rounded-full" />

                    <div className="min-w-0">
                        <Skeleton className="h-6 w-40 rounded-lg" />
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                    <Skeleton className="h-9 w-28 rounded-xl" />
                    <Skeleton className="h-9 w-16 rounded-xl" />
                    <Skeleton className="h-11 w-11 rounded-xl" />
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

function mapPersistedSentMessage(
    message: PersistedSentMessage | null | undefined,
): InboxMessage | null {
    if (!message?.id) return null;

    const sentAt = message.sent_at ?? new Date().toISOString();
    const senderType =
        message.sender_type === "client" ||
        message.sender_type === "bot" ||
        message.sender_type === "system"
            ? message.sender_type
            : "attendant";

    return {
        id: message.id,
        from: senderType === "client" ? "client" : "attendant",
        sender_type: senderType,
        sender_name: message.sender_name ?? null,
        text: message.text ?? "",
        time: new Intl.DateTimeFormat("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(sentAt)),
        sent_at: sentAt,
        sequence_index: message.sequence_index ?? null,
    };
}

function getMessagePreview(text: string) {
    const legacyAttachmentMarker = "\n::engravida-attachment::";
    const markerIndex = text.indexOf(legacyAttachmentMarker);
    const withoutLegacyMetadata =
        markerIndex >= 0 ? text.slice(0, markerIndex) : text;

    return withoutLegacyMetadata
        .replace(/[\u{E0020}-\u{E007F}]/gu, "")
        .trim();
}

function getInitials(name: string) {
    const words = name.trim().split(/\s+/);

    return words
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase())
        .join("");
}
