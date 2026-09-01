// app/assistente/page.tsx
"use client";

import {
    Copy,
    Download,
    LoaderCircle,
    MessageSquarePlus,
    PanelLeftClose,
    PanelLeftOpen,
    RotateCcw,
    Send,
    Square,
    Sparkles,
    ThumbsDown,
    ThumbsUp,
    Trash2,
} from "lucide-react";
import {
    type FormEvent,
    type KeyboardEvent,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { Skeleton } from "@/components";
import AssistantClientCard from "@/components/assistant/AssistantClientCard";
import AssistantConversationCard from "@/components/assistant/AssistantConversationCard";
import AssistantMarkdown from "@/components/assistant/AssistantMarkdown";
import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import { openClientProfile } from "@/components/clientes/PermanentClientProfilePanel";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import {
    type CurrentAttendant,
    fetchCurrentAttendant,
    getCachedCurrentAttendant,
} from "@/lib/attendants/currentAttendantApi";
import { formatSystemUserName } from "@/lib/users/formatSystemUserName";
import type {
    AssistantCard,
    AssistantChatMessage,
    AssistantChatSession,
    AssistantChatStreamEvent,
    AssistantFeedbackReason,
} from "@/types/assistant";

const MAX_STORED_SESSIONS = 30;

const SUGGESTIONS = [
    "A Dra. Leila Lamas está ocupada amanhã?",
    "Sheila dos Santos Oliveira Ferreira tem algo agendado?",
    "Compare faturamento, ticket e cancelamentos por unidade nos últimos 30 dias.",
    "Compare a conversão das unidades nos últimos 30 dias.",
];

const FEEDBACK_REASONS: Array<{
    value: AssistantFeedbackReason;
    label: string;
}> = [
    { value: "wrong_data", label: "Dados incorretos" },
    { value: "wrong_interpretation", label: "Interpretação" },
    { value: "incomplete", label: "Incompleta" },
    { value: "slow", label: "Lenta" },
    { value: "other", label: "Outro" },
];

export default function AssistentePage() {
    const { currentUser } = useCurrentUser();
    const currentUserId = currentUser?.user?.id ?? null;
    const cachedAttendant = getCachedCurrentAttendant(currentUserId);
    const [currentAttendant, setCurrentAttendant] =
        useState<CurrentAttendant | null>(
            () => cachedAttendant?.attendant ?? null,
        );
    const [sessions, setSessions] = useState<AssistantChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [streamStatus, setStreamStatus] = useState<string | null>(null);
    const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
    const [lastFailedMessageId, setLastFailedMessageId] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let mounted = true;

        async function loadCurrentAttendant(force = false) {
            if (!currentUserId) {
                if (mounted) setCurrentAttendant(null);
                return;
            }

            const cached = getCachedCurrentAttendant(currentUserId);

            if (cached && mounted) {
                setCurrentAttendant(cached.attendant);
            }

            try {
                const response = await fetchCurrentAttendant({
                    force,
                    userId: currentUserId,
                });

                if (mounted) {
                    setCurrentAttendant(response.attendant);
                }
            } catch (attendantError) {
                console.error(
                    "[assistente] failed to load current attendant",
                    attendantError,
                );
            }
        }

        function refreshAttendant() {
            void loadCurrentAttendant(true);
        }

        void loadCurrentAttendant(true);

        window.addEventListener(
            "attendant-status-changed",
            refreshAttendant,
        );
        window.addEventListener(
            "current-user-permissions-changed",
            refreshAttendant,
        );

        return () => {
            mounted = false;
            window.removeEventListener(
                "attendant-status-changed",
                refreshAttendant,
            );
            window.removeEventListener(
                "current-user-permissions-changed",
                refreshAttendant,
            );
        };
    }, [currentUserId]);

    useEffect(() => {
        return () => abortControllerRef.current?.abort();
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function loadHistory() {
            setHistoryLoading(true);

            try {
                const response = await fetch("/api/assistente/history", {
                    cache: "no-store",
                    credentials: "include",
                });
                const payload = await response.json();

                if (!response.ok || !payload?.ok) {
                    throw new Error(
                        payload?.error ?? "Não foi possível carregar o histórico.",
                    );
                }

                if (cancelled) return;

                const restored = Array.isArray(payload.sessions)
                    ? payload.sessions.slice(0, MAX_STORED_SESSIONS)
                    : [];

                setSessions(restored);
                setActiveSessionId(restored[0]?.id ?? null);
            } catch (historyError) {
                console.error(
                    "[assistente] failed to load database history",
                    historyError,
                );

                if (!cancelled) {
                    setError(
                        historyError instanceof Error
                            ? historyError.message
                            : "Não foi possível carregar o histórico.",
                    );
                }
            } finally {
                if (!cancelled) setHistoryLoading(false);
            }
        }

        void loadHistory();

        return () => {
            cancelled = true;
        };
    }, []);

    const activeSession = useMemo(
        () =>
            sessions.find((session) => session.id === activeSessionId) ??
            null,
        [activeSessionId, sessions],
    );
    const profileName = formatSystemUserName(
        currentAttendant?.name ??
            currentUser?.user?.name ??
            currentUser?.user?.email,
    );

    useEffect(() => {
        bottomRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "end",
        });
    }, [activeSession?.messages, loading]);

    function createNewChat() {
        abortControllerRef.current?.abort();
        setActiveSessionId(null);
        setInput("");
        setError(null);
        setStreamStatus(null);
        setLastFailedPrompt(null);
        setLastFailedMessageId(null);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
    }

    async function deleteSession(sessionId: string) {
        try {
            const response = await fetch("/api/assistente/history", {
                method: "DELETE",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: sessionId }),
            });
            const payload = await response.json();

            if (!response.ok || !payload?.ok) {
                throw new Error(
                    payload?.error ?? "Não foi possível excluir o chat.",
                );
            }

            setSessions((current) => {
                const next = current.filter(
                    (session) => session.id !== sessionId,
                );

                if (activeSessionId === sessionId) {
                    setActiveSessionId(next[0]?.id ?? null);
                }

                return next;
            });
        } catch (deleteError) {
            setError(
                deleteError instanceof Error
                    ? deleteError.message
                    : "Não foi possível excluir o chat.",
            );
        }
    }

    function submitSuggestion(value: string) {
        void sendMessage(value);
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        await sendMessage(input);
    }

    async function sendMessage(rawContent: string, retryMessageId?: string) {
        const content = rawContent.trim();
        if (!content || loading) return;

        setLoading(true);
        setError(null);
        setStreamStatus("Entendendo a pergunta...");
        setLastFailedPrompt(null);
        setLastFailedMessageId(null);
        setInput("");
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const now = new Date().toISOString();
        let session = activeSession;
        const retryMessage = retryMessageId
            ? session?.messages.find(
                  (message) =>
                      message.id === retryMessageId && message.role === "user",
              )
            : null;
        const userMessage: AssistantChatMessage = retryMessage ?? {
            id: crypto.randomUUID(),
            role: "user",
            content,
            created_at: now,
        };

        if (!session) {
            session = {
                id: crypto.randomUUID(),
                title: titleFromMessage(content),
                messages: [],
                created_at: now,
                updated_at: now,
            };

            setActiveSessionId(session.id);
        }

        const messagesWithUser = retryMessage
            ? session.messages
            : [...session.messages, userMessage];

        const sessionWithUser = {
            ...session,
            messages: messagesWithUser,
            updated_at: now,
        };

        upsertSession(sessionWithUser);

        try {
            if (!retryMessage) {
                await persistMessage(sessionWithUser, userMessage);
            }

            const response = await fetch("/api/assistente/chat", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    session_id: sessionWithUser.id,
                    messages: messagesWithUser.map((message) => ({
                        role: message.role,
                        content: message.content,
                    })),
                }),
                signal: abortController.signal,
            });
            const streamedMessage = await readAssistantStream(
                response,
                (event) => {
                    if (event.type === "status") {
                        setStreamStatus(event.status);
                    }
                },
            );

            const assistantMessage: AssistantChatMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: streamedMessage.content,
                cards: streamedMessage.cards,
                feedback: null,
                feedback_reason: null,
                run_id: streamedMessage.run_id,
                created_at: new Date().toISOString(),
            };

            const sessionWithAssistant: AssistantChatSession = {
                ...sessionWithUser,
                messages: [
                    ...messagesWithUser,
                    assistantMessage,
                ],
                updated_at: assistantMessage.created_at,
            };

            await persistMessage(
                sessionWithAssistant,
                assistantMessage,
            );
            upsertSession(sessionWithAssistant);
        } catch (sendError) {
            console.error("[assistente] failed to send message", sendError);
            const interrupted =
                abortController.signal.aborted ||
                (sendError instanceof DOMException &&
                    sendError.name === "AbortError");
            setError(
                interrupted
                    ? "Solicitação interrompida."
                    : sendError instanceof Error
                    ? sendError.message
                    : "Não foi possível consultar o assistente.",
            );
            setLastFailedPrompt(content);
            setLastFailedMessageId(userMessage.id);
        } finally {
            if (abortControllerRef.current === abortController) {
                abortControllerRef.current = null;
            }
            setStreamStatus(null);
            setLoading(false);
            window.setTimeout(() => textareaRef.current?.focus(), 0);
        }
    }

    function stopRequest() {
        abortControllerRef.current?.abort();
    }

    async function persistMessage(
        session: AssistantChatSession,
        message: AssistantChatMessage,
    ) {
        const response = await fetch("/api/assistente/history", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session, message }),
        });
        const payload = await response.json();

        if (!response.ok || !payload?.ok) {
            throw new Error(
                payload?.error ?? "Não foi possível salvar o chat.",
            );
        }
    }

    function upsertSession(session: AssistantChatSession) {
        setSessions((current) => {
            const withoutCurrent = current.filter(
                (item) => item.id !== session.id,
            );

            return [session, ...withoutCurrent].slice(
                0,
                MAX_STORED_SESSIONS,
            );
        });
    }

    async function setMessageFeedback(
        messageId: string,
        rating: "up" | "down" | null,
        reason: AssistantFeedbackReason | null = null,
    ) {
        const previousMessage = sessions
            .flatMap((session) => session.messages)
            .find((message) => message.id === messageId);

        setSessions((current) =>
            current.map((session) => ({
                ...session,
                messages: session.messages.map((message) =>
                    message.id === messageId
                        ? {
                              ...message,
                              feedback: rating,
                              feedback_reason:
                                  rating === "down" ? reason : null,
                          }
                        : message,
                ),
            })),
        );

        try {
            const response = await fetch("/api/assistente/feedback", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message_id: messageId,
                    rating,
                    reason: rating === "down" ? reason : null,
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok) {
                throw new Error(
                    payload?.error ?? "Não foi possível salvar a avaliação.",
                );
            }
        } catch (feedbackError) {
            setSessions((current) =>
                current.map((session) => ({
                    ...session,
                    messages: session.messages.map((message) =>
                        message.id === messageId
                            ? {
                                  ...message,
                                  feedback: previousMessage?.feedback ?? null,
                                  feedback_reason:
                                      previousMessage?.feedback_reason ?? null,
                              }
                            : message,
                    ),
                })),
            );
            setError(
                feedbackError instanceof Error
                    ? feedbackError.message
                    : "Não foi possível salvar a avaliação.",
            );
        }
    }

    function handleInputKeyDown(
        event: KeyboardEvent<HTMLTextAreaElement>,
    ) {
        if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();
            void sendMessage(input);
        }
    }

    return (
        <main className="flex h-full min-h-0 w-full overflow-hidden bg-white text-slate-900">
            <section className="flex min-w-0 flex-1 overflow-hidden">
                <div className="relative flex min-w-0 flex-1 overflow-hidden bg-white">
                    {historyOpen ? (
                        <button type="button" aria-label="Fechar histórico" onClick={() => setHistoryOpen(false)} className="absolute inset-0 z-20 bg-slate-950/20 md:hidden" />
                    ) : null}
                    <aside
                        className={`absolute inset-y-0 left-0 z-30 shrink-0 overflow-hidden border-r border-border bg-card shadow-xl transition-[width] duration-300 md:relative md:z-auto md:shadow-none ${
                            historyOpen ? "w-[280px] max-w-[86vw]" : "w-0 border-r-0"
                        }`}
                    >
                        <div className="flex h-full w-[280px] flex-col px-3 pb-3 pt-5">
                            <button
                                type="button"
                                onClick={createNewChat}
                                className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90"
                            >
                                <MessageSquarePlus size={17} />
                                Novo chat
                            </button>

                            <div className="mt-5 px-2 text-xs font-bold uppercase tracking-[0.16em] text-muted">
                                Histórico
                            </div>

                            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                                {historyLoading ? (
                                    <HistorySkeleton />
                                ) : sessions.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center text-xs leading-5 text-muted">
                                        Nenhum chat salvo ainda.
                                    </div>
                                ) : (
                                    sessions.map((session) => (
                                        <SessionButton
                                            key={session.id}
                                            session={session}
                                            active={
                                                session.id ===
                                                activeSessionId
                                            }
                                            onOpen={() =>
                                                setActiveSessionId(
                                                    session.id,
                                                )
                                            }
                                            onDelete={() =>
                                                void deleteSession(session.id)
                                            }
                                        />
                                    ))
                                )}
                            </div>

                            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-100/70 p-3 text-xs leading-5 text-slate-500">
                                <div className="flex items-center gap-2 font-bold text-slate-600">
                                    <Sparkles size={14} />
                                    Dados internos
                                </div>
                                <p className="mt-1">
                                    Consulta clientes, agenda, conversas e
                                    análises em modo somente leitura. Confirme
                                    informações críticas.
                                </p>
                            </div>
                        </div>
                    </aside>

                    <section className="relative flex min-w-0 flex-1 flex-col">
                        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4 sm:px-6">
                            <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setHistoryOpen((value) => !value)
                                    }
                                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                    title={
                                        historyOpen
                                            ? "Ocultar histórico"
                                            : "Mostrar histórico"
                                    }
                                >
                                    {historyOpen ? (
                                        <PanelLeftClose size={19} />
                                    ) : (
                                        <PanelLeftOpen size={19} />
                                    )}
                                </button>

                                {historyLoading ? (
                                    <Skeleton className="h-5 w-56 rounded-md" />
                                ) : (
                                    <h1
                                        className="min-w-0 flex-1 truncate text-sm font-bold text-slate-950 sm:text-base"
                                        title={getSessionDisplayTitle(
                                            activeSession,
                                        )}
                                    >
                                        {getSessionDisplayTitle(activeSession)}
                                    </h1>
                                )}
                            </div>

                            {activeSession && (
                                <button
                                    type="button"
                                    onClick={createNewChat}
                                    className="ml-4 hidden shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 sm:flex"
                                >
                                    <MessageSquarePlus size={15} />
                                    Novo
                                </button>
                            )}
                        </header>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {historyLoading ? (
                                <MainChatSkeleton />
                            ) : !activeSession ||
                            activeSession.messages.length === 0 ? (
                                <EmptyAssistant
                                    name={profileName || null}
                                    onSuggestion={submitSuggestion}
                                />
                            ) : (
                                <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
                                    <div className="space-y-8">
                                        {activeSession.messages.map(
                                            (message) => (
                                                <ChatMessage
                                                    key={message.id}
                                                    message={message}
                                                    onOpenClient={openClientProfile}
                                                    onFeedback={setMessageFeedback}
                                                    userName={profileName}
                                                />
                                            ),
                                        )}

                                        {loading && (
                                            <AssistantThinking
                                                status={streamStatus}
                                            />
                                        )}
                                        {error && (
                                            <div className="ml-12 flex items-center justify-between gap-3 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-medium text-red">
                                                <span>{error}</span>
                                                {lastFailedPrompt && !loading && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void sendMessage(
                                                                lastFailedPrompt,
                                                                lastFailedMessageId ?? undefined,
                                                            )
                                                        }
                                                        className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold transition hover:bg-white/60"
                                                    >
                                                        <RotateCcw size={13} />
                                                        Tentar novamente
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        <div ref={bottomRef} />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="shrink-0 border-t border-slate-100 bg-white px-4 pb-4 pt-1.5 sm:px-8 sm:pb-6">
                            <form
                                onSubmit={handleSubmit}
                                className="mx-auto w-full max-w-4xl"
                            >
                                <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_12px_40px_-22px_rgba(15,23,42,0.38)] transition focus-within:border-brand/40 focus-within:ring-4 focus-within:ring-brand/5">
                                    <textarea
                                        ref={textareaRef}
                                        value={input}
                                        onChange={(event) =>
                                            setInput(event.target.value)
                                        }
                                        onKeyDown={handleInputKeyDown}
                                        rows={1}
                                        maxLength={8000}
                                        placeholder="Pergunte sobre clientes, agenda, conversas ou resultados..."
                                        className="max-h-40 min-h-10 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                                    />

                                    <div className="flex items-center justify-end gap-3 px-2 pb-1">
                                        {loading ? (
                                            <button
                                                type="button"
                                                onClick={stopRequest}
                                                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-700"
                                                title="Parar resposta"
                                                aria-label="Parar resposta"
                                            >
                                                <Square size={14} fill="currentColor" />
                                            </button>
                                        ) : (
                                            <button
                                                type="submit"
                                                disabled={!input.trim()}
                                                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                                            >
                                                <Send size={17} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </form>
                        </div>
                    </section>
                </div>
            </section>
        </main>
    );
}

async function readAssistantStream(
    response: Response,
    onEvent: (event: AssistantChatStreamEvent) => void,
) {
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
            payload?.error ?? "Não foi possível consultar o assistente.",
        );
    }

    if (!response.body) {
        throw new Error("A resposta do assistente veio vazia.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalMessage:
        | Extract<AssistantChatStreamEvent, { type: "message" }>["message"]
        | null = null;

    const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as AssistantChatStreamEvent;
        onEvent(event);

        if (event.type === "error") throw new Error(event.error);
        if (event.type === "message") finalMessage = event.message;
    };

    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) consumeLine(line);
        if (done) break;
    }

    if (buffer.trim()) consumeLine(buffer);
    if (!finalMessage) {
        throw new Error("O assistente encerrou sem enviar uma resposta.");
    }

    return finalMessage;
}

function HistorySkeleton() {
    return (
        <div className="space-y-2 px-1 py-1">
            {Array.from({ length: 6 }).map((_, index) => (
                <div
                    key={index}
                    className="rounded-xl px-3 py-3"
                >
                    <Skeleton
                        className={`h-3.5 rounded-md ${
                            index % 3 === 0
                                ? "w-4/5"
                                : index % 3 === 1
                                  ? "w-3/5"
                                  : "w-11/12"
                        }`}
                    />
                    <Skeleton className="mt-2 h-2.5 w-16 rounded-md" />
                </div>
            ))}
        </div>
    );
}

function MainChatSkeleton() {
    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
            <div className="space-y-9">
                <div className="flex items-start gap-3">
                    <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                    <div className="w-full max-w-[680px] space-y-3 pt-1">
                        <Skeleton className="h-4 w-3/4 rounded-md" />
                        <Skeleton className="h-4 w-full rounded-md" />
                        <Skeleton className="h-4 w-5/6 rounded-md" />
                        <Skeleton className="h-24 w-full rounded-2xl" />
                    </div>
                </div>

                <div className="flex items-start justify-end gap-3">
                    <Skeleton className="h-14 w-72 rounded-2xl rounded-tr-md" />
                    <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                </div>

                <div className="flex items-start gap-3">
                    <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                    <div className="w-full max-w-[620px] space-y-3 pt-1">
                        <Skeleton className="h-4 w-2/3 rounded-md" />
                        <Skeleton className="h-4 w-full rounded-md" />
                        <Skeleton className="h-4 w-4/5 rounded-md" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function EmptyAssistant({
    name,
    onSuggestion,
}: {
    name: string | null;
    onSuggestion: (value: string) => void;
}) {
    return (
        <div className="flex min-h-full items-start justify-center px-5 pb-12 pt-20 sm:pt-24">
            <div className="w-full max-w-3xl text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-soft text-purple shadow-sm">
                    <Sparkles size={25} />
                </span>

                <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                    {name ? `Olá, ${name}` : "Como posso ajudar?"}
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">
                    Pergunte sobre clientes, médicos, agendamentos,
                    conversas, unidades e indicadores do Engravida Hub.
                </p>

                <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
                    {SUGGESTIONS.map((suggestion) => (
                        <button
                            key={suggestion}
                            type="button"
                            onClick={() => onSuggestion(suggestion)}
                            className="cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-medium leading-6 text-slate-700 shadow-sm transition hover:border-purple/25 hover:bg-purple-soft/30 hover:text-slate-950"
                        >
                            {suggestion}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SessionButton({
    session,
    active,
    onOpen,
    onDelete,
}: {
    session: AssistantChatSession;
    active: boolean;
    onOpen: () => void;
    onDelete: () => void;
}) {
    return (
        <div
            className={`group flex items-center rounded-xl transition ${
                active
                    ? "bg-selection"
                    : "hover:bg-selection/80"
            }`}
        >
            <button
                type="button"
                onClick={onOpen}
                className="min-w-0 flex-1 cursor-pointer px-3 py-3 text-left"
            >
                <div
                    className={`truncate text-sm font-semibold transition-colors ${
                        active
                            ? "text-text"
                            : "text-muted group-hover:text-text"
                    }`}
                >
                    {session.title}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                    {formatSessionDate(session.updated_at)}
                </div>
            </button>

            <button
                type="button"
                onClick={onDelete}
                className="mr-2 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 opacity-0 transition hover:bg-red-soft hover:text-red group-hover:opacity-100"
                title="Excluir conversa"
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
}

function ChatMessage({
    message,
    onOpenClient,
    onFeedback,
    userName,
}: {
    message: AssistantChatMessage;
    onOpenClient: (clientId: string) => void;
    onFeedback: (
        messageId: string,
        rating: "up" | "down" | null,
        reason?: AssistantFeedbackReason | null,
    ) => Promise<void>;
    userName: string;
}) {
    const assistant = message.role === "assistant";
    const [copied, setCopied] = useState(false);
    const [showFeedbackReasons, setShowFeedbackReasons] = useState(false);

    async function copyMessage() {
        await navigator.clipboard.writeText(message.content);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
    }

    return (
        <article
            className={`flex gap-3 ${
                assistant ? "items-start" : "items-start justify-end"
            }`}
        >
            {assistant && (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-soft text-purple">
                    <Sparkles size={17} />
                </span>
            )}

            <div
                className={`min-w-0 ${
                    assistant ? "w-full max-w-[760px]" : "max-w-[82%]"
                }`}
            >
                {assistant ? (
                    <AssistantMarkdown content={message.content} />
                ) : (
                    <div className="whitespace-pre-wrap rounded-2xl rounded-tr-md bg-brand px-4 py-3 text-sm leading-6 text-white shadow-sm">
                        {message.content}
                    </div>
                )}

                {assistant &&
                    message.cards &&
                    message.cards.length > 0 && (
                        <div className="mt-4 grid gap-3">
                            {message.cards.map((card) => (
                                <AssistantCardRenderer
                                    key={`${card.type}:${card.data.id}`}
                                    card={card}
                                    onOpenClient={onOpenClient}
                                />
                            ))}
                        </div>
                    )}

                {assistant && (
                    <div className="mt-3 flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() =>
                                void onFeedback(
                                    message.id,
                                    message.feedback === "up" ? null : "up",
                                )
                            }
                            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition ${
                                message.feedback === "up"
                                    ? "bg-purple-soft text-purple"
                                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            }`}
                            title="Resposta útil"
                            aria-label="Resposta útil"
                        >
                            <ThumbsUp size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (message.feedback === "down") {
                                    setShowFeedbackReasons(false);
                                    void onFeedback(message.id, null);
                                    return;
                                }

                                setShowFeedbackReasons(true);
                            }}
                            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition ${
                                message.feedback === "down"
                                    ? "bg-red-soft text-red"
                                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            }`}
                            title="Resposta não útil"
                            aria-label="Resposta não útil"
                        >
                            <ThumbsDown size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => void copyMessage()}
                            className="flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            title="Copiar resposta"
                            aria-label="Copiar resposta"
                        >
                            <Copy size={14} />
                            {copied && (
                                <span className="text-[11px] font-semibold">
                                    Copiado
                                </span>
                            )}
                        </button>
                    </div>
                )}

                {assistant && showFeedbackReasons && (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {FEEDBACK_REASONS.map((reason) => (
                            <button
                                key={reason.value}
                                type="button"
                                onClick={() => {
                                    setShowFeedbackReasons(false);
                                    void onFeedback(
                                        message.id,
                                        "down",
                                        reason.value,
                                    );
                                }}
                                className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-red/30 hover:bg-red-soft hover:text-red"
                            >
                                {reason.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {!assistant && <InitialsAvatar name={userName} />}
        </article>
    );
}

function AssistantCardRenderer({
    card,
    onOpenClient,
}: {
    card: AssistantCard;
    onOpenClient: (clientId: string) => void;
}) {
    if (card.type === "client") {
        return (
            <AssistantClientCard
                client={card.data}
                onOpen={() => onOpenClient(card.data.id)}
            />
        );
    }


    if (card.type === "export") {
        return (
            <a
                href={`/api/assistente/exports/${card.data.id}`}
                download={card.data.file_name}
                className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-purple/30 hover:bg-purple-soft/20"
            >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-soft text-purple">
                    <Download size={18} />
                </span>
                <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-slate-900">
                        {card.data.file_name}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                        {card.data.row_count.toLocaleString("pt-BR")} linhas ·
                        baixar CSV
                    </span>
                </span>
            </a>
        );
    }

    return (
        <AssistantConversationCard
            conversation={card.data}
            onOpenClient={onOpenClient}
        />
    );
}

function AssistantThinking({ status }: { status?: string | null }) {
    const [statusIndex, setStatusIndex] = useState(0);
    const statuses = [
        "Entendendo a pergunta...",
        "Consultando os dados do Hub...",
        "Cruzando os resultados...",
        "Preparando a resposta...",
    ];

    useEffect(() => {
        const intervals = [2_500, 5_500, 9_000];
        const timers = intervals.map((delay, index) =>
            window.setTimeout(() => setStatusIndex(index + 1), delay),
        );
        return () => timers.forEach(window.clearTimeout);
    }, []);

    return (
        <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-soft text-purple">
                <Sparkles size={17} />
            </span>
            <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
                <LoaderCircle size={16} className="animate-spin" />
                {status ?? statuses[statusIndex]}
            </div>
        </div>
    );
}

function titleFromMessage(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

function getSessionDisplayTitle(session: AssistantChatSession | null) {
    if (!session) return "Assistente IA";

    const firstUserMessage = session.messages.find(
        (message) => message.role === "user",
    )?.content;
    const title = (firstUserMessage ?? session.title)
        .replace(/\s+/g, " ")
        .trim();

    return title || "Assistente IA";
}


function formatSessionDate(value: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}
