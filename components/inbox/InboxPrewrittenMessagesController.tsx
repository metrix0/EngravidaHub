// components/inbox/InboxPrewrittenMessagesController.tsx
"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import {createPortal} from "react-dom";
import {LoaderCircle, PencilLine, Send} from "lucide-react";
import {usePathname} from "next/navigation";

export type PrewrittenMessage = {
    id: string;
    command: string;
    text: string;
};

// Hardcoded for now. Add new messages to this array using the same structure.
export const PREWRITTEN_MESSAGES: PrewrittenMessage[] = [
    {
        id: "avaliacao",
        command: "/avaliação",
        text: "Olá, gostaria de fazer a avaliação...",
    },
];

type ComposerElements = {
    container: HTMLElement;
    textarea: HTMLTextAreaElement;
    shortcutButton: HTMLButtonElement;
};

type MenuPosition = {
    left: number;
    bottom: number;
    width: number;
};

export default function InboxPrewrittenMessagesController({
    messageListRef,
}: {
    messageListRef: RefObject<HTMLDivElement | null>;
}) {
    const pathname = usePathname();
    const isInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");

    const [composer, setComposer] = useState<ComposerElements | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [position, setPosition] = useState<MenuPosition | null>(null);

    const popupRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<ComposerElements | null>(null);

    const filteredMessages = useMemo(() => {
        const trimmedQuery = query.trim();

        if (!trimmedQuery.startsWith("/")) {
            return PREWRITTEN_MESSAGES;
        }

        const normalizedQuery = normalize(trimmedQuery);

        return PREWRITTEN_MESSAGES.filter((message) => {
            return (
                normalize(message.command).startsWith(normalizedQuery) ||
                normalize(message.text).includes(normalizedQuery.slice(1))
            );
        });
    }, [query]);

    const sendImmediately = useCallback(async (message: PrewrittenMessage) => {
        const currentComposer = composerRef.current;

        if (
            !currentComposer ||
            currentComposer.textarea.disabled ||
            sendingMessageId
        ) {
            return;
        }

        setSendingMessageId(message.id);
        setSendError(null);
        setComposerValue(currentComposer.textarea, message.text);
        setQuery(message.text);

        const sent = await clickSendWhenReady(currentComposer.container);

        if (sent) {
            setIsOpen(false);
        } else {
            setSendError(
                "A mensagem foi aplicada, mas não foi possível acionar o envio automaticamente.",
            );
            currentComposer.textarea.focus();
        }

        setSendingMessageId(null);
    }, [sendingMessageId]);

    useEffect(() => {
        if (!isInbox) {
            composerRef.current = null;
            setComposer(null);
            setIsOpen(false);
            return;
        }

        const messageList = messageListRef.current;
        const container = messageList?.parentElement;

        if (!container) return;

        function syncComposer() {
            const textarea = container!.querySelector<HTMLTextAreaElement>(
                'textarea[placeholder="Responder como atendente..."], textarea[placeholder="Janela de 24h encerrada"]',
            );
            const shortcutButton = container!.querySelector<HTMLButtonElement>(
                'button[title="Template"], button[title="Mensagens prontas"]',
            );

            if (!textarea || !shortcutButton) {
                composerRef.current = null;
                setComposer(null);
                return;
            }

            const nextComposer = {
                container: container!,
                textarea,
                shortcutButton,
            };

            composerRef.current = nextComposer;
            setComposer((current) => {
                if (
                    current?.container === nextComposer.container &&
                    current.textarea === nextComposer.textarea &&
                    current.shortcutButton === nextComposer.shortcutButton
                ) {
                    return current;
                }

                return nextComposer;
            });
            setQuery(textarea.value);
        }

        syncComposer();

        const observer = new MutationObserver(syncComposer);
        observer.observe(container, {
            attributes: true,
            attributeFilter: ["disabled", "placeholder", "title"],
            childList: true,
            subtree: true,
        });

        return () => observer.disconnect();
    }, [isInbox, messageListRef]);

    useEffect(() => {
        if (!composer) return;

        const {shortcutButton, textarea} = composer;
        const originalTitle = shortcutButton.title;
        const originalAriaLabel = shortcutButton.getAttribute("aria-label");

        shortcutButton.title = "Mensagens prontas";
        shortcutButton.setAttribute("aria-label", "Abrir mensagens prontas");

        function handleShortcutClick(event: MouseEvent) {
            event.preventDefault();
            event.stopPropagation();
            setQuery(textarea.value);
            setSendError(null);
            setIsOpen((current) => !current);
        }

        function handleTextareaInput() {
            const value = textarea.value;
            setQuery(value);

            if (isSlashQuery(value)) {
                setSendError(null);
                setIsOpen(true);
            }
        }

        function handleTextareaKeyDown(event: KeyboardEvent) {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

            const message = resolvePrewrittenMessage(textarea.value);
            if (!message) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            void sendImmediately(message);
        }

        shortcutButton.addEventListener("click", handleShortcutClick, true);
        textarea.addEventListener("input", handleTextareaInput);
        textarea.addEventListener("keydown", handleTextareaKeyDown, true);

        return () => {
            shortcutButton.removeEventListener("click", handleShortcutClick, true);
            textarea.removeEventListener("input", handleTextareaInput);
            textarea.removeEventListener("keydown", handleTextareaKeyDown, true);

            if (shortcutButton.title === "Mensagens prontas") {
                shortcutButton.title = originalTitle;
            }

            if (originalAriaLabel === null) {
                shortcutButton.removeAttribute("aria-label");
            } else {
                shortcutButton.setAttribute("aria-label", originalAriaLabel);
            }
        };
    }, [composer, sendImmediately]);

    useEffect(() => {
        if (!composer) return;

        composer.shortcutButton.setAttribute("aria-expanded", String(isOpen));

        return () => composer.shortcutButton.removeAttribute("aria-expanded");
    }, [composer, isOpen]);

    useEffect(() => {
        if (!isOpen || !composer) {
            setPosition(null);
            return;
        }

        function updatePosition() {
            const rect = composer!.shortcutButton.getBoundingClientRect();
            const width = Math.min(440, Math.max(280, window.innerWidth - 32));
            const left = Math.min(
                Math.max(16, rect.right - width),
                Math.max(16, window.innerWidth - width - 16),
            );

            setPosition({
                left,
                bottom: Math.max(16, window.innerHeight - rect.top + 8),
                width,
            });
        }

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [composer, isOpen]);

    useEffect(() => {
        if (!isOpen || !composer) return;

        function handlePointerDown(event: MouseEvent) {
            const target = event.target as Node;

            if (
                popupRef.current?.contains(target) ||
                composer!.shortcutButton.contains(target)
            ) {
                return;
            }

            setIsOpen(false);
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setIsOpen(false);
        }

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [composer, isOpen]);

    function applyMessage(message: PrewrittenMessage) {
        const currentComposer = composerRef.current;
        if (!currentComposer || currentComposer.textarea.disabled) return;

        setComposerValue(currentComposer.textarea, message.text);
        setQuery(message.text);
        setSendError(null);
        setIsOpen(false);
        currentComposer.textarea.focus();
    }

    if (!isInbox || !composer || !isOpen || !position) return null;

    const menu = (
        <div
            ref={popupRef}
            role="dialog"
            aria-label="Mensagens prontas"
            className="fixed z-[100] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            style={{
                left: position.left,
                bottom: position.bottom,
                width: position.width,
            }}
        >
            <div className="max-h-[min(320px,60vh)] overflow-y-auto p-2 [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin]">
                {filteredMessages.length > 0 ? (
                    <div className="space-y-2">
                        {filteredMessages.map((message) => {
                            const isSending = sendingMessageId === message.id;
                            const disabled = composer.textarea.disabled || !!sendingMessageId;

                            return (
                                <div
                                    key={message.id}
                                    className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 p-2 transition-colors hover:border-slate-300"
                                >
                                    <p
                                        title={message.text}
                                        className="min-w-0 flex-1 truncate text-sm text-slate-600"
                                    >
                                        {message.text}
                                    </p>

                                    <code className="inline-flex shrink-0 rounded-md bg-brand-soft px-2 py-1 text-xs font-bold text-brand">
                                        {message.command}
                                    </code>

                                    <button
                                        type="button"
                                        title="Aplicar no campo"
                                        aria-label="Aplicar mensagem no campo"
                                        disabled={disabled}
                                        onClick={() => applyMessage(message)}
                                        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <PencilLine size={14}/>
                                    </button>

                                    <button
                                        type="button"
                                        title="Enviar imediatamente"
                                        aria-label="Enviar mensagem imediatamente"
                                        disabled={disabled}
                                        onClick={() => void sendImmediately(message)}
                                        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-brand text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSending ? (
                                            <LoaderCircle size={14} className="animate-spin"/>
                                        ) : (
                                            <Send size={14}/>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-400">
                        Nenhum comando encontrado.
                    </div>
                )}

                {sendError ? (
                    <div className="mx-1 mt-2 rounded-lg bg-red-soft px-3 py-2 text-xs font-semibold text-red">
                        {sendError}
                    </div>
                ) : null}
            </div>
        </div>
    );

    return createPortal(menu, document.body);
}

export function resolvePrewrittenMessage(value: string) {
    const normalizedValue = normalize(value);

    return PREWRITTEN_MESSAGES.find(
        (message) => normalize(message.command) === normalizedValue,
    );
}

function isSlashQuery(value: string) {
    const trimmed = value.trim();
    return trimmed.startsWith("/") && !trimmed.includes("\n");
}

function normalize(value: string) {
    return value
        .trim()
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function setComposerValue(textarea: HTMLTextAreaElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
    )?.set;

    if (valueSetter) {
        valueSetter.call(textarea, value);
    } else {
        textarea.value = value;
    }

    textarea.dispatchEvent(new Event("input", {bubbles: true}));
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function clickSendWhenReady(container: HTMLElement) {
    return new Promise<boolean>((resolve) => {
        let attempts = 0;
        const maximumAttempts = 18;

        function attemptSend() {
            const sendButton = container.querySelector<HTMLButtonElement>(
                'button[title="Enviar"]',
            );

            if (sendButton && !sendButton.disabled) {
                sendButton.click();
                resolve(true);
                return;
            }

            attempts += 1;

            if (attempts >= maximumAttempts) {
                resolve(false);
                return;
            }

            window.requestAnimationFrame(attemptSend);
        }

        window.requestAnimationFrame(attemptSend);
    });
}
