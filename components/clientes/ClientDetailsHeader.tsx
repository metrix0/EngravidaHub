// components/clientes/ClientDetailsHeader.tsx
"use client";

import {
    Calendar,
    CalendarCheck,
    Clock,
    Filter,
    MapPin,
    Phone,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge, getBadgeLabel } from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";

export type ClientDetailsHeaderData = {
    name: string | null;
    phone: string | null;
    first_seen_at: string | null;
    last_interaction_at: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
    unit: {
        name: string | null;
    } | null;
    funnel: {
        name: string | null;
    } | null;
    stage: {
        name: string | null;
    } | null;
};

export default function ClientDetailsHeader({
    client,
}: {
    client: ClientDetailsHeaderData;
}) {
    const clientName = client.name ?? "Cliente sem nome";
    const source = getBadgeLabel(client.utm_source);

    return (
        <>
            <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                    <InitialsAvatar name={clientName} />

                    <div className="min-w-0">
                        <div
                            title={clientName}
                            className="truncate text-base font-bold text-slate-950"
                        >
                            {clientName}
                        </div>

                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                            <Phone size={15} />
                            <span>{formatPhone(client.phone)}</span>
                        </div>
                    </div>
                </div>

                {client.utm_campaign && (
                    <Badge value={client.utm_campaign} none="" />
                )}
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-3">
                <HeaderInfoItem
                    icon={<Calendar size={18} />}
                    label="Desde"
                    value={formatDate(client.first_seen_at) ?? "—"}
                />

                <HeaderInfoItem
                    icon={<MapPin size={18} />}
                    label="Unidade"
                    value={client.unit?.name ?? "—"}
                />

                <HeaderInfoItem
                    icon={<Filter size={18} />}
                    label="Funil"
                    value={client.funnel?.name ?? "—"}
                />

                <HeaderInfoItem
                    icon={<CalendarCheck size={18} />}
                    label="Estágio"
                    value={client.stage?.name ?? "—"}
                />

                <HeaderInfoItem
                    icon={<Clock size={18} />}
                    label="Última interação"
                    value={timeAgo(client.last_interaction_at)}
                />

                <HeaderInfoItem
                    icon={<Filter size={18} />}
                    label="Origem"
                    value={source}
                />
            </div>
        </>
    );
}

function HeaderInfoItem({
    icon,
    label,
    value,
}: {
    icon: ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="flex min-w-0 items-start gap-2">
            <div className="mt-0.5 text-slate-400">{icon}</div>

            <div className="min-w-0">
                <div className="text-slate-500">{label}</div>
                <div
                    title={value}
                    className="truncate font-semibold text-slate-700"
                >
                    {value}
                </div>
            </div>
        </div>
    );
}

function formatPhone(value: string | null) {
    const digits = String(value ?? "").replace(/\D/g, "");
    const normalized = digits.startsWith("55") ? digits.slice(2) : digits;

    if (normalized.length === 11) {
        return normalized.replace(
            /^(\d{2})(\d{5})(\d{4})$/,
            "($1) $2-$3",
        );
    }

    if (normalized.length === 10) {
        return normalized.replace(
            /^(\d{2})(\d{4})(\d{4})$/,
            "($1) $2-$3",
        );
    }

    return value?.trim() || "—";
}

function formatDate(value: string | null) {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "America/Sao_Paulo",
    }).format(date);
}

function timeAgo(value: string | null) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    const elapsed = Date.now() - date.getTime();
    const minutes = Math.max(0, Math.floor(elapsed / 60_000));

    if (minutes < 1) return "agora";
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} d`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} mês${months === 1 ? "" : "es"}`;

    const years = Math.floor(days / 365);
    return `${years} ano${years === 1 ? "" : "s"}`;
}
