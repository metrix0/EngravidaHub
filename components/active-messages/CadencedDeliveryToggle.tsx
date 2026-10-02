// components/active-messages/CadencedDeliveryToggle.tsx
"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";

import InfoTooltip from "@/components/ui/InfoTooltip";

export function CadencedDeliveryToggle({
    checked,
    disabled = false,
    onChange,
    children,
    className = "",
}: {
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={className}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-700">
                        Envio cadenciado
                    </span>
                    <InfoTooltip text="Distribui os envios ao longo dos dias, entre 11h e 14h.">
                        <Info size={14} className="text-slate-400" />
                    </InfoTooltip>
                </div>

                <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label="Envio cadenciado"
                    disabled={disabled}
                    onClick={() => onChange(!checked)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                        checked ? "bg-brand" : "bg-slate-200"
                    }`}
                >
                    <span
                        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                            checked
                                ? "translate-x-5"
                                : "translate-x-0.5"
                        }`}
                    />
                </button>
            </div>

            <div
                aria-hidden={!checked}
                className={`grid transition-all duration-300 ease-out ${
                    checked
                        ? "mt-4 grid-rows-[1fr] opacity-100"
                        : "pointer-events-none mt-0 grid-rows-[0fr] opacity-0"
                }`}
            >
                <div className="overflow-hidden">{children}</div>
            </div>
        </div>
    );
}
