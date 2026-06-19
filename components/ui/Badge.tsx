// components/ui/Badge.tsx
import type { HTMLAttributes } from "react";

export type ConversationResult =
    | "resolvida"
    | "parcial"
    | "nao_resolvida"
    | "pendente";

type BadgeDefinition = {
    values?: readonly string[];
    includes?: readonly string[];
    label?: string;
    useValueAsLabel?: boolean;
    className: string;
    none?: boolean;
};

type BadgeConfig = {
    label: string;
    className: string;
    none: boolean;
};

type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
    value: string | null | undefined;
    label?: string;
    none?: string | null;
};

const BASE_CLASS_NAME =
    "inline-flex max-w-full items-center truncate whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold";

const BADGE_DEFINITIONS: readonly BadgeDefinition[] = [
    {
        values: ["resolvida", "resolvido", "resolved"],
        label: "Resolvida",
        className: "bg-green-soft text-green",
    },
    {
        values: ["parcial", "partial"],
        label: "Parcial",
        className: "bg-orange-soft text-orange",
    },
    {
        values: [
            "nao_resolvida",
            "nao_resolvido",
            "nao resolvida",
            "nao resolvido",
            "unresolved",
        ],
        label: "Não resolvida",
        className: "bg-red-soft text-red",
    },
    {
        values: ["pendente", "pending"],
        label: "Pendente",
        className: "bg-orange text-orange",
    },
    {
        values: ["direct", "direto"],
        label: "Direct",
        className: "bg-soft-blue text-blue",
    },
    {
        values: ["meta_ads", "meta ads", "facebook", "fb"],
        useValueAsLabel: true,
        className: "bg-soft-blue text-blue",
    },
    {
        includes: ["instagram", "ig", "bio-instagram"],
        useValueAsLabel: true,
        className: "bg-soft-pink text-pink",
    },
    {
        includes: ["google", "google_ads", "google ads"],
        useValueAsLabel: true,
        className: "bg-amber-100/33 text-amber-600",
    },
    {
        values: ["whatsapp", "whats app"],
        label: "WhatsApp",
        className: "bg-soft-green text-green",
    },
    {
        values: ["home-site"],
        useValueAsLabel: true,
        className: "bg-soft-purple text-purple",
    },
    {
        values: ["organic", "organico", "organica"],
        label: "Orgânico",
        className: "bg-soft-purple text-purple",
    },
    {
        values: ["indicacao", "referral"],
        label: "Indicação",
        className: "bg-soft-orange text-orange",
    },
    {
        includes: ["novo", "agend"],
        useValueAsLabel: true,
        className: "bg-soft-blue text-blue",
    },
    {
        includes: ["tentando", "interessado"],
        useValueAsLabel: true,
        className: "bg-soft-orange text-orange",
    },
    {
        includes: ["realizad", "compareceu"],
        useValueAsLabel: true,
        className: "bg-soft-green text-green",
    },
    {
        includes: ["atendimento", "qualific", "avaliacao", "Avaliação"],
        useValueAsLabel: true,
        className: "bg-soft-purple text-purple",
    },
    {
        includes: ["perdid", "cancel", "desist"],
        useValueAsLabel: true,
        className: "bg-soft-red text-red",
    },
    {
        values: ["sem funil"],
        useValueAsLabel: true,
        className: "bg-slate-100 text-slate-500",
    },
];

export function Badge({
    value,
    label,
    none,
    className = "",
    title,
    ...props
}: BadgeProps) {
    const config = getBadgeConfig(value, label);
    const noneLabel = none === undefined ? "—" : none;

    if (config.none && noneLabel === null) {
        return null;
    }

    const displayLabel = config.none ? noneLabel : config.label;

    return (
        <span
            {...props}
            title={title ?? displayLabel}
            className={`${BASE_CLASS_NAME} ${config.className} ${className}`.trim()}
        >
            {displayLabel}
        </span>
    );
}

export function getBadgeLabel(
    value: string | null | undefined,
    label?: string,
) {
    return getBadgeConfig(value, label).label;
}

function getBadgeConfig(
    value: string | null | undefined,
    explicitLabel?: string,
): BadgeConfig {
    const rawValue = value?.trim() ?? "";
    const normalizedValue = normalize(rawValue);

    if (!normalizedValue) {
        return {
            label: explicitLabel ?? "—",
            className: "bg-slate-100 text-slate-500",
            none: true,
        };
    }

    const definition = BADGE_DEFINITIONS.find((item) => {
        if (item.values?.includes(normalizedValue)) {
            return true;
        }

        return item.includes?.some((part) => normalizedValue.includes(part)) ?? false;
    });

    if (!definition) {
        return {
            label: explicitLabel ?? rawValue,
            className: "bg-slate-100 text-slate-500",
            none: false,
        };
    }

    return {
        label:
            explicitLabel ??
            (definition.useValueAsLabel ? rawValue : definition.label ?? rawValue),
        className: definition.className,
        none: definition.none ?? false,
    };
}

function normalize(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
}

export const __uiDemo = {
    element: (
        <div className="flex flex-wrap items-center gap-3">
            <Badge value="resolvida" />
            <Badge value="parcial" />
            <Badge value="nao_resolvida" />
            <Badge value="meta_ads" />
            <Badge value="google" />
            <Badge value="Agendado" />
        </div>
    ),
    code: `<Badge value="resolvida" />`,
};
