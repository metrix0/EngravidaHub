"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { usePersonalDashboard } from "@/components/personal-dashboard/PersonalDashboardProvider";
import { getDashboardWidget } from "@/lib/personal-dashboard/registryExtended";

const GROUPED_SECTION_SELECTOR =
    "#dashboard-instagram, #dashboard-messenger, #dashboard-ligacoes";

export default function DashboardAddControl({
    widgetId,
    groupControl = false,
}: {
    widgetId: string;
    groupControl?: boolean;
}) {
    const {
        status,
        saving,
        ensureLoaded,
        addWidget,
        hasWidget,
    } = usePersonalDashboard();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [adding, setAdding] = useState(false);
    const [suppressed, setSuppressed] = useState(false);

    useLayoutEffect(() => {
        if (groupControl) {
            setSuppressed(false);
            return;
        }
        setSuppressed(
            Boolean(rootRef.current?.closest(GROUPED_SECTION_SELECTOR)),
        );
    }, [groupControl]);

    useEffect(() => {
        if (!suppressed) {
            void ensureLoaded().catch(() => undefined);
        }
    }, [ensureLoaded, suppressed]);

    if (suppressed) return null;

    const widget = getDashboardWidget(widgetId);
    const bottomAligned = widget?.kind === "chart";
    const added = hasWidget(widgetId);
    const disabled = status === "loading" || saving || adding || added;
    const label = added ? "Adicionado ao dashboard" : "Adicionar ao dashboard";

    return (
        <div
            ref={rootRef}
            data-dashboard-add-control="true"
            className={`group/dashboard-add absolute right-3 z-30 opacity-0 transition-opacity group-hover/dashboard-widget:opacity-100 group-focus-within/dashboard-widget:opacity-100 ${
                bottomAligned ? "bottom-3" : "top-3"
            }`}
        >
            <button
                type="button"
                aria-label={label}
                disabled={disabled}
                onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (disabled) return;
                    setAdding(true);
                    try {
                        await addWidget(widgetId);
                    } finally {
                        setAdding(false);
                    }
                }}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-brand/40 hover:bg-brand-soft hover:text-brand disabled:cursor-default disabled:opacity-70"
            >
                {added ? <Check size={15} /> : <Plus size={16} />}
            </button>
            <span
                className={`pointer-events-none absolute right-0 hidden whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg group-hover/dashboard-add:block ${
                    bottomAligned ? "bottom-10" : "top-10"
                }`}
            >
                {label}
            </span>
        </div>
    );
}
