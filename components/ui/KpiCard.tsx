// components/ui/KpiCard.tsx
import type { ReactNode } from "react";
import Card from "./Card";

type KpiCardColor = "brand" | "green" | "blue" | "orange" | "purple" | "pink";

type KpiCardProps = {
    icon: ReactNode;
    label: string;

    currentValue: number;
    previousValue?: number | null;

    suffix?: string;
    formatter?: (value: number) => string;

    color?: KpiCardColor;
    positiveDirection?: "up" | "down";
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
                                }: KpiCardProps) {
    const formattedValue = formatter
        ? formatter(currentValue)
        : `${currentValue}${suffix}`;

    const trend = getTrend({
        currentValue,
        previousValue,
        positiveDirection,
    });

    return (
        <Card className="h-full">
            <div className="flex min-w-0 items-center gap-5 h-full">
                <div className={"h-full flex items-center "}>
                <div
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${colorClasses[color]}`}
                >
                    {icon}
                </div>
                </div>

                <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium leading-tight text-muted">
                        {label}
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
    currentValue: number;
    previousValue: number | null;
    positiveDirection: "up" | "down";
}) {
    if (previousValue === null || previousValue === 0) return null;

    const difference = currentValue - previousValue;

    if (difference === 0) return null;

    const percentageChange = (difference / previousValue) * 100;

    if (Math.abs(percentageChange) < 0.1) return null;

    const wentUp = difference > 0;
    const isPositive = positiveDirection === "up" ? wentUp : !wentUp;

    const arrow = wentUp ? "↑" : "↓";

    const formattedChange = Math.abs(percentageChange).toLocaleString("pt-BR", {
        minimumFractionDigits: percentageChange < 1 ? 1 : 0,
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
    code: `<KpiCard
  icon={<span>✓</span>}
  label="Resolução real"
  currentValue={78}
  previousValue={72}
  suffix="%"
  color="green"
/>`,
};
