// components/ui/KpiCard.tsx
import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import Card from "./Card";
import InfoTooltip from "./InfoTooltip";

type KpiCardColor = "brand" | "green" | "blue" | "orange" | "purple" | "pink";

type KpiCardProps = {
    icon: ReactNode;
    label: string;
    currentValue: number | null;
    previousValue?: number | null;
    suffix?: string;
    formatter?: (value: number) => string;
    color?: KpiCardColor;
    positiveDirection?: "up" | "down";
    tooltipText?: string | null;
    unavailableLabel?: string;
};

const colorClasses: Record<KpiCardColor, string> = {
    brand: "bg-brand-soft text-brand",
    green: "bg-green-soft text-green",
    blue: "bg-blue-soft text-blue",
    orange: "bg-orange-soft text-orange",
    purple: "bg-purple-soft text-purple",
    pink: "bg-pink-soft text-pink",
};

export default function KpiCard({
    icon,
    label,
    currentValue,
    previousValue = null,
    suffix = "",
    formatter,
    color = "brand",
    positiveDirection = "up",
    tooltipText = null,
    unavailableLabel = "—",
}: KpiCardProps) {
    const formattedValue =
        currentValue === null
            ? unavailableLabel
            : formatter
              ? formatter(currentValue)
              : `${currentValue}${suffix}`;

    const trend = getTrend({
        currentValue,
        previousValue,
        positiveDirection,
    });

    return (
        <Card className="h-full">
            <div className="flex h-full min-w-0 items-center gap-5">
                <div className="flex h-full items-center">
                    <div
                        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${colorClasses[color]}`}
                    >
                        {icon}
                    </div>
                </div>

                <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium leading-tight text-muted">
                        <span>{label}</span>
                        {tooltipText ? (
                            <>
                                {" "}
                                <InfoTooltip text={tooltipText} portal>
                                    <HelpCircle
                                        size={13}
                                        className="inline align-[-2px] text-slate-400"
                                    />
                                </InfoTooltip>
                            </>
                        ) : null}
                    </div>

                    <div className="mt-1 whitespace-nowrap text-3xl font-bold tracking-tight text-text">
                        {formattedValue}
                    </div>

                    {trend && (
                        <div
                            className={`mt-2 text-xs font-medium leading-tight ${
                                trend.isPositive ? "text-green" : "text-red"
                            }`}
                        >
                            {trend.label}
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
}

function getTrend({
    currentValue,
    previousValue,
    positiveDirection,
}: {
    currentValue: number | null;
    previousValue: number | null;
    positiveDirection: "up" | "down";
}) {
    if (
        currentValue === null ||
        previousValue === null ||
        previousValue === 0
    ) {
        return null;
    }

    const difference = currentValue - previousValue;
    if (difference === 0) return null;

    const percentageChange = (difference / previousValue) * 100;
    if (Math.abs(percentageChange) < 0.1) return null;

    const wentUp = difference > 0;
    const isPositive = positiveDirection === "up" ? wentUp : !wentUp;
    const arrow = wentUp ? "↑" : "↓";
    const formattedChange = Math.abs(percentageChange).toLocaleString("pt-BR", {
        minimumFractionDigits: Math.abs(percentageChange) < 1 ? 1 : 0,
        maximumFractionDigits: 1,
    });

    return {
        isPositive,
        label: `${arrow} ${formattedChange}% vs. período anterior`,
    };
}

export const __uiDemo = {
    element: (
        <KpiCard
            icon={<span>✓</span>}
            label="Resolução real"
            currentValue={78}
            previousValue={72}
            suffix="%"
            color="green"
        />
    ),
    code: `<KpiCard currentValue={78} previousValue={72} suffix="%" />`,
};
