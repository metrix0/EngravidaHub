"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { usePersonalDashboard } from "@/components/personal-dashboard/PersonalDashboardProvider";

export default function DashboardAddControl({ widgetId }: { widgetId: string }) {
    const {
        status,
        saving,
        ensureLoaded,
        addWidget,
        hasWidget,
    } = usePersonalDashboard();
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        void ensureLoaded().catch(() => undefined);
    }, [ensureLoaded]);

    const added = hasWidget(widgetId);
    const disabled = status === "loading" || saving || adding || added;
    const label = added ? "Adicionado ao dashboard" : "Adicionar ao dashboard";

    return (
        <div className="group/dashboard-add absolute right-3 top-3 z-30 opacity-0 transition-opacity group-hover/dashboard-widget:opacity-100 group-focus-within/dashboard-widget:opacity-100">
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
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-brand/40 hover:bg-brand-soft hover:text-brand disabled:cursor-default disabled:opacity-70"
            >
                {added ? <Check size={15} /> : <Plus size={16} />}
            </button>
            <span className="pointer-events-none absolute right-0 top-10 hidden whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg group-hover/dashboard-add:block">
                {label}
            </span>
        </div>
    );
}
