// components/ui/Modal.tsx
"use client";

import {
    type CSSProperties,
    type MouseEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useState,
} from "react";
import { X } from "lucide-react";

type ModalProps = {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    onExitComplete?: () => void;
    width?: number | string;
    maxWidth?: number | string;
    height?: number | string;
    maxHeight?: number | string;
    closeOnOverlayClick?: boolean;
    closeOnEscape?: boolean;
    showCloseButton?: boolean;
    overlayClassName?: string;
    panelClassName?: string;
    zIndexClassName?: string;
    ariaLabelledBy?: string;
    ariaDescribedBy?: string;
};

const MODAL_EXIT_MS = 180;

export function Modal({
    open,
    onClose,
    children,
    onExitComplete,
    width = 920,
    maxWidth = "calc(100vw - 48px)",
    height = "82vh",
    maxHeight = "82vh",
    closeOnOverlayClick = true,
    closeOnEscape = true,
    showCloseButton = true,
    overlayClassName = "",
    panelClassName = "",
    zIndexClassName = "z-50",
    ariaLabelledBy,
    ariaDescribedBy,
}: ModalProps) {
    const [mounted, setMounted] = useState(open);
    const [isClosing, setIsClosing] = useState(false);
    const [renderedChildren, setRenderedChildren] = useState<ReactNode>(children);

    useEffect(() => {
        if (open) setRenderedChildren(children);
    }, [children, open]);

    useEffect(() => {
        if (open) {
            setMounted(true);
            setIsClosing(false);
            return;
        }

        if (!mounted) return;
        setIsClosing(true);

        const timeout = window.setTimeout(() => {
            setMounted(false);
            setIsClosing(false);
            onExitComplete?.();
        }, MODAL_EXIT_MS);

        return () => window.clearTimeout(timeout);
    }, [open, mounted, onExitComplete]);

    useEffect(() => {
        if (!mounted || !closeOnEscape) return;

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose();
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [mounted, closeOnEscape, onClose]);

    const handleOverlayClick = useCallback(
        (event: MouseEvent<HTMLDivElement>) => {
            if (!closeOnOverlayClick || event.target !== event.currentTarget) return;
            onClose();
        },
        [closeOnOverlayClick, onClose],
    );

    if (!mounted) return null;

    const panelStyle: CSSProperties = { width, maxWidth, height, maxHeight };

    return (
        <div
            onMouseDown={handleOverlayClick}
            className={[
                "fixed inset-0 flex items-center justify-center bg-slate-950/40 px-6 py-8",
                zIndexClassName,
                isClosing ? "animate-fade-out" : "animate-fade-in",
                overlayClassName,
            ].join(" ")}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                className={[
                    "relative flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl",
                    isClosing ? "animate-modal-pop-out" : "animate-modal-pop",
                    panelClassName,
                ].join(" ")}
                style={panelStyle}
            >
                {showCloseButton ? (
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-6 top-5 z-10 flex h-9 w-9 cursor-pointer shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-slate-100 hover:text-text"
                        aria-label="Fechar modal"
                    >
                        <X size={18} />
                    </button>
                ) : null}
                {renderedChildren}
            </div>
        </div>
    );
}
