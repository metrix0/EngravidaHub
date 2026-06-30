// components/scheduling/SchedulingClientSummary.tsx
"use client";

import { ChevronRight, MapPin } from "lucide-react";

import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";

type SchedulingClientSummaryProps = {
    name: string;
    phone: string | null | undefined;
    city: string | null | undefined;
    onClick?: () => void;
};

export default function SchedulingClientSummary({
    name,
    phone,
    city,
    onClick,
}: SchedulingClientSummaryProps) {
    const content = (
        <>
            <div className="flex min-w-0 items-center gap-4">
                <InitialsAvatar name={name} />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-bold text-slate-950">
                        {name || "Cliente sem nome"}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                        {phone?.trim() || "Sem telefone"}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                        <MapPin size={13} className="shrink-0" />
                        <span className="truncate">{city?.trim() || "Sem cidade"}</span>
                    </div>
                </div>
            </div>
            {onClick ? (
                <ChevronRight size={18} className="shrink-0 text-slate-400" />
            ) : null}
        </>
    );

    if (!onClick) {
        return <div className="flex w-full items-center justify-between px-1 py-1">{content}</div>;
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className="flex w-full cursor-pointer items-center justify-between px-1 py-1 text-left transition-opacity hover:opacity-80"
            aria-label={`Abrir perfil de ${name || "cliente"}`}
        >
            {content}
        </button>
    );
}
