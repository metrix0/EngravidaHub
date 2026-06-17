// src/components/ui/PercentageBar.tsx
type PercentageBarProps = {
    value: number;
    color?: "brand" | "green" | "blue" | "orange" | "purple";
};

export default function PercentageBar({
                                          value,
                                          color = "purple",
                                      }: PercentageBarProps) {
    return (
        <div className="h-2 rounded-full bg-slate-100">
            <div
                className="h-2 rounded-full"
                style={{
                    width: `${Math.min(value, 100)}%`,
                    backgroundColor: getColor(color),
                }}
            />
        </div>
    );
}

function getColor(color: PercentageBarProps["color"]) {
    if (color === "brand") return "var(--color-brand)";
    if (color === "green") return "var(--color-green)";
    if (color === "blue") return "var(--color-blue)";
    if (color === "orange") return "var(--color-orange)";
    return "var(--color-purple)";
}

export const __uiDemo = {
    element: <PercentageBar value={18} color="purple" />,
    code: '<PercentageBar value={18} color="purple" />',
};