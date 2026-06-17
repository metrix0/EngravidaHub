// components/ui/DetailsSidePanel.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
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
    const [mounted, setMounted] = useState(open);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);

            const timer = window.setTimeout(() => setVisible(true), 20);
            return () => window.clearTimeout(timer);
        }

        setVisible(false);

        const timer = window.setTimeout(() => setMounted(false), 250);
        return () => window.clearTimeout(timer);
    }, [open]);

    if (!mounted) return null;

    function handleClose() {
        setVisible(false);

        window.setTimeout(() => {
            onClose();
        }, 250);
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
