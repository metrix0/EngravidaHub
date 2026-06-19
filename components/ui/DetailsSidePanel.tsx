// components/ui/DetailsSidePanel.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

type DetailsSidePanelProps = {
    open: boolean;
    title: ReactNode;
    onClose: () => void;
    children: ReactNode;
    headerContent?: ReactNode;
    widthClassName?: string;
    zIndexClassName?: string;
    bodyClassName?: string;
    headerClassName?: string;
};

type DetailsSidePanelStateEvent = CustomEvent<{
    id: string;
    open: boolean;
}>;

type DetailsSidePanelOpenedEvent = CustomEvent<{
    id: string;
}>;

const DETAILS_SIDE_PANEL_STATE_EVENT = "engravida:details-side-panel-state";
const DETAILS_SIDE_PANEL_OPENED_EVENT = "engravida:details-side-panel-opened";

export function DetailsSidePanel({
    open,
    title,
    onClose,
    children,
    headerContent,
    widthClassName = "w-[460px]",
    zIndexClassName = "z-50",
    bodyClassName = "min-h-0 flex-1 overflow-y-auto px-5 py-5",
    headerClassName = "border-b border-slate-100 px-6 py-5",
}: DetailsSidePanelProps) {
    const panelIdRef = useRef(
        `details-panel-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const closingFromPeerRef = useRef(false);
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            window.dispatchEvent(
                new CustomEvent(DETAILS_SIDE_PANEL_OPENED_EVENT, {
                    detail: { id: panelIdRef.current },
                }),
            );

            const timer = window.setTimeout(() => setVisible(true), 20);
            return () => window.clearTimeout(timer);
        }

        setVisible(false);

        const timer = window.setTimeout(() => setMounted(false), 50);
        return () => window.clearTimeout(timer);
    }, [open]);

    useEffect(() => {
        function handleOtherPanelOpened(event: Event) {
            const detail = (event as DetailsSidePanelOpenedEvent).detail;

            if (!detail || detail.id === panelIdRef.current || !mounted) return;

            closingFromPeerRef.current = true;
            handleClose();
        }

        window.addEventListener(DETAILS_SIDE_PANEL_OPENED_EVENT, handleOtherPanelOpened);

        return () => {
            window.removeEventListener(DETAILS_SIDE_PANEL_OPENED_EVENT, handleOtherPanelOpened);
        };
    }, [mounted]);

    useEffect(() => {
        if (!mounted) return;

        window.dispatchEvent(
            new CustomEvent(DETAILS_SIDE_PANEL_STATE_EVENT, {
                detail: { id: panelIdRef.current, open: true },
            }),
        );

        return () => {
            window.dispatchEvent(
                new CustomEvent(DETAILS_SIDE_PANEL_STATE_EVENT, {
                    detail: { id: panelIdRef.current, open: false },
                }),
            );
        };
    }, [mounted]);

    if (!mounted) return null;

    function handleClose() {
        setVisible(false);

        window.setTimeout(() => {
            onClose();
            closingFromPeerRef.current = false;
        }, closingFromPeerRef.current ? 180 : 250);
    }

    return (
        <div className={`fixed inset-0 ${zIndexClassName} pointer-events-none`}>
            <aside
                className={`pointer-events-auto absolute right-0 top-0 flex h-full max-w-[calc(100vw-64px)] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out ${widthClassName} ${
                    visible ? "translate-x-0" : "translate-x-full"
                }`}
            >
                <div className="flex h-full min-h-0 flex-col">
                    <div className={headerClassName}>
                        <div className={headerContent ? "mb-6 flex items-center justify-between" : "flex items-center justify-between"}>
                            <h2 className="min-w-0 truncate text-xl font-bold text-slate-950">
                                {title}
                            </h2>

                            <button
                                type="button"
                                onClick={handleClose}
                                className="ml-4 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {headerContent}
                    </div>

                    <div className={bodyClassName}>{children}</div>
                </div>
            </aside>
        </div>
    );
}

export { DETAILS_SIDE_PANEL_STATE_EVENT, DETAILS_SIDE_PANEL_OPENED_EVENT };
