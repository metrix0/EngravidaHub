// components/scheduling/SchedulingClientSummary.tsx
"use client";

import { ChevronRight, MapPin, X } from "lucide-react";

import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";

type SchedulingClientSummaryProps = {
    name: string;
    phone: string | null | undefined;
    city: string | null | undefined;
    onClick?: () => void;
    onClear?: () => void;
};

export default function SchedulingClientSummary({
    name,
    phone,
    city,
    onClick,
    onClear,
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

    if (onClear) {
        return (
            <div className="flex w-full items-center px-1 py-1">
                {onClick ? (
                    <button
                        type="button"
                        onClick={onClick}
                        className="min-w-0 flex-1 cursor-pointer text-left transition-opacity hover:opacity-80"
                        aria-label={`Abrir perfil de ${name || "cliente"}`}
                    >
                        <div className="flex min-w-0 items-center gap-4">
                            <InitialsAvatar name={name} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-bold text-slate-950">{name || "Cliente sem nome"}</div>
                                <div className="mt-1 text-sm text-slate-500">{phone?.trim() || "Sem telefone"}</div>
                                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                                    <MapPin size={13} className="shrink-0" />
                                    <span className="truncate">{city?.trim() || "Sem cidade"}</span>
                                </div>
                            </div>
                        </div>
                    </button>
                ) : (
                    <div className="min-w-0 flex-1">{content}</div>
                )}
                <button
                    type="button"
                    onClick={onClear}
                    className="ml-2 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Remover cliente selecionado"
                >
                    <X size={16} />
                </button>
                {onClick ? (
                    <button
                        type="button"
                        onClick={onClick}
                        className="flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center text-slate-400 transition hover:text-slate-700"
                        aria-label={`Abrir perfil de ${name || "cliente"}`}
                    >
                        <ChevronRight size={18} />
                    </button>
                ) : null}
            </div>
        );
    }

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
