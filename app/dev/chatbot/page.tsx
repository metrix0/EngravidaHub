// app/dev/chatbot/page.tsx
"use client";

import {
    Bot,
    CalendarClock,
    LoaderCircle,
    RotateCcw,
    Send,
    ShieldAlert,
    UserRound,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

type ChatbotOption = {
    id: string;
    label: string;
};

type SchedulingDebug = {
    active: boolean;
    step: string;
    creation_enabled: boolean;
    creation_blocked: boolean;
    unit_id: string | null;
    doctor_id: string | null;
    scheduling_date: string | null;
    scheduling_time: string | null;
    patient_name: string | null;
};

type ChatbotResponse = {
    ok: boolean;
    action: string;
    route: string;
    stage: string;
    reply: string;
    options: ChatbotOption[];
    ai_used: boolean;
    knowledge_ids: string[];
    scheduling?: SchedulingDebug;
    error?: string;
};

type ChatMessage = {
    id: string;
    role: "user" | "bot";
    text: string;
};

const INITIAL_MESSAGE = "__initial__";

export default function DevChatbotPage() {
    const [sessionId, setSessionId] = useState("");
    const [phone, setPhone] = useState("");
    const [stage, setStage] = useState("menu");
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [latestResponse, setLatestResponse] =
        useState<ChatbotResponse | null>(null);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const initializedRef = useRef(false);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        const id = crypto.randomUUID();
        setSessionId(id);
        void sendToChatbot(INITIAL_MESSAGE, {
            sessionId: id,
            stage: "menu",
            showUserMessage: false,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, sending]);

    async function sendToChatbot(
        message: string,
        options?: {
            sessionId?: string;
            stage?: string;
            displayText?: string;
            showUserMessage?: boolean;
        },
    ) {
        const activeSessionId = options?.sessionId ?? sessionId;
        if (!activeSessionId || sending) return;

        const showUserMessage = options?.showUserMessage ?? true;
        if (showUserMessage) {
            setMessages((current) => [
                ...current,
                {
                    id: crypto.randomUUID(),
                    role: "user",
                    text: options?.displayText ?? message,
                },
            ]);
        }

        setSending(true);
        setError(null);

        try {
            const response = await fetch("/api/dev/chatbot", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message,
                    stage: options?.stage ?? stage,
                    phone: phone.trim() || null,
                    session_id: activeSessionId,
                }),
            });
            const payload = (await response.json()) as ChatbotResponse;

            if (!response.ok || !payload.ok) {
                throw new Error(
                    payload.error ?? "Não foi possível executar o chatbot.",
                );
            }

            setStage(payload.stage);
            setLatestResponse(payload);
            setMessages((current) => [
                ...current,
                {
                    id: crypto.randomUUID(),
                    role: "bot",
                    text: payload.reply,
                },
            ]);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "Não foi possível executar o chatbot.",
            );
        } finally {
            setSending(false);
        }
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const message = input.trim();
        if (!message || sending) return;

        setInput("");
        await sendToChatbot(message);
    }

    async function resetChat() {
        if (sending) return;

        const oldSessionId = sessionId;
        const nextSessionId = crypto.randomUUID();

        setSending(true);
        setError(null);
        try {
            if (oldSessionId) {
                await fetch("/api/dev/chatbot", {
                    method: "DELETE",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ session_id: oldSessionId }),
                });
            }
        } finally {
            setSessionId(nextSessionId);
            setStage("menu");
            setMessages([]);
            setLatestResponse(null);
            setSending(false);
        }

        await sendToChatbot(INITIAL_MESSAGE, {
            sessionId: nextSessionId,
            stage: "menu",
            showUserMessage: false,
        });
    }

    return (
        <main className="h-screen overflow-y-auto bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
            <div className="mx-auto flex min-h-full max-w-6xl flex-col">
                <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand">
                            <ShieldAlert size={15} />
                            Ferramenta de desenvolvedor
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                            Teste do Chatbot
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                            Executa o mesmo fluxo usado pelo webhook do BLIP, incluindo
                            menus, IA e disponibilidade real do CliniSYS.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => void resetChat()}
                        disabled={sending}
                        className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <RotateCcw size={16} />
                        Reiniciar
                    </button>
                </header>

                <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                    <CalendarClock size={18} />
                    <strong>Modo de teste:</strong>
                    a consulta de horários usa o CliniSYS real, mas a criação do
                    agendamento está bloqueada no servidor.
                </div>

                <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <section className="flex min-h-[650px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                                Telefone simulado
                            </label>
                            <input
                                value={phone}
                                onChange={(event) => setPhone(event.target.value)}
                                placeholder="Ex.: 5511999999999"
                                className="mt-2 h-11 w-full max-w-sm rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand/60 focus:ring-4 focus:ring-brand/10"
                            />
                            <p className="mt-2 text-xs text-slate-400">
                                Opcional para testar o chat. Será usado como telefone
                                do paciente quando o agendamento real for habilitado.
                            </p>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 px-4 py-5 sm:px-6">
                            <div className="space-y-4">
                                {messages.map((message) => (
                                    <ChatBubble key={message.id} message={message} />
                                ))}

                                {sending ? (
                                    <div className="flex items-center gap-2 text-sm text-slate-400">
                                        <LoaderCircle
                                            size={16}
                                            className="animate-spin"
                                        />
                                        Chatbot respondendo...
                                    </div>
                                ) : null}

                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {latestResponse?.options?.length ? (
                            <div className="border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
                                <div className="flex flex-wrap gap-2">
                                    {latestResponse.options.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            disabled={sending}
                                            onClick={() =>
                                                void sendToChatbot(option.id, {
                                                    displayText: option.label,
                                                })
                                            }
                                            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-brand/40 hover:bg-brand-soft hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {error ? (
                            <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700 sm:px-6">
                                {error}
                            </div>
                        ) : null}

                        <form
                            onSubmit={handleSubmit}
                            className="flex gap-3 border-t border-slate-200 bg-white p-4 sm:p-5"
                        >
                            <textarea
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (
                                        event.key === "Enter" &&
                                        !event.shiftKey
                                    ) {
                                        event.preventDefault();
                                        event.currentTarget.form?.requestSubmit();
                                    }
                                }}
                                rows={1}
                                placeholder="Digite como se fosse o paciente..."
                                className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand/60 focus:ring-4 focus:ring-brand/10"
                            />
                            <button
                                type="submit"
                                disabled={!input.trim() || sending}
                                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-brand text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                                aria-label="Enviar mensagem"
                            >
                                {sending ? (
                                    <LoaderCircle
                                        size={18}
                                        className="animate-spin"
                                    />
                                ) : (
                                    <Send size={18} />
                                )}
                            </button>
                        </form>
                    </section>

                    <aside className="self-start rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h2 className="font-bold text-slate-950">Debug</h2>
                        <div className="mt-4 space-y-3 text-sm">
                            <DebugRow label="Stage" value={latestResponse?.stage ?? stage} />
                            <DebugRow
                                label="Rota"
                                value={latestResponse?.route ?? "—"}
                            />
                            <DebugRow
                                label="Ação"
                                value={latestResponse?.action ?? "—"}
                            />
                            <DebugRow
                                label="IA usada"
                                value={latestResponse?.ai_used ? "Sim" : "Não"}
                            />
                            <DebugRow
                                label="Knowledge IDs"
                                value={
                                    latestResponse?.knowledge_ids?.length
                                        ? latestResponse.knowledge_ids.join(", ")
                                        : "—"
                                }
                            />
                        </div>

                        <div className="my-5 border-t border-slate-100" />

                        <h3 className="text-sm font-bold text-slate-900">
                            Agendamento
                        </h3>
                        <div className="mt-3 space-y-3 text-sm">
                            <DebugRow
                                label="Fluxo ativo"
                                value={
                                    latestResponse?.scheduling?.active
                                        ? "Sim"
                                        : "Não"
                                }
                            />
                            <DebugRow
                                label="Etapa"
                                value={latestResponse?.scheduling?.step ?? "—"}
                            />
                            <DebugRow
                                label="Data"
                                value={
                                    latestResponse?.scheduling?.scheduling_date ??
                                    "—"
                                }
                            />
                            <DebugRow
                                label="Horário"
                                value={
                                    latestResponse?.scheduling?.scheduling_time ??
                                    "—"
                                }
                            />
                            <DebugRow
                                label="Paciente"
                                value={
                                    latestResponse?.scheduling?.patient_name ?? "—"
                                }
                            />
                            <DebugRow
                                label="Criação real"
                                value={
                                    latestResponse?.scheduling?.creation_enabled
                                        ? "Habilitada"
                                        : "Bloqueada"
                                }
                            />
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
}

function ChatBubble({ message }: { message: ChatMessage }) {
    const isBot = message.role === "bot";

    return (
        <div
            className={`flex items-end gap-2.5 ${isBot ? "justify-start" : "justify-end"}`}
        >
            {isBot ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Bot size={16} />
                </span>
            ) : null}

            <div
                className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                    isBot
                        ? "rounded-bl-md border border-slate-200 bg-white text-slate-700"
                        : "rounded-br-md bg-brand text-white"
                }`}
            >
                {message.text}
            </div>

            {!isBot ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                    <UserRound size={16} />
                </span>
            ) : null}
        </div>
    );
}

function DebugRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <span className="shrink-0 text-slate-400">{label}</span>
            <span className="min-w-0 break-words text-right font-semibold text-slate-700">
                {value}
            </span>
        </div>
    );
}
