// src/components/ui/PercentageValue.tsx
type PercentageValueProps = {
    value: number;
    greenFrom?: number;
    orangeFrom?: number;
    suffix?: string;
};

export default function PercentageValue({
                                            value,
                                            greenFrom = 70,
                                            orangeFrom = 40,
                                            suffix = "%",
                                        }: PercentageValueProps) {
    const color = getPercentageColor(value, greenFrom, orangeFrom);

    return (
        <span className="font-bold" style={{ color }}>
      {value}
            {suffix}
    </span>
    );
}

function getPercentageColor(
    value: number,
    greenFrom: number,
    orangeFrom: number
) {
    if (value >= greenFrom) return "var(--color-green)";
    if (value >= orangeFrom) return "var(--color-orange)";
    return "var(--color-brand)";
}

export const __uiDemo = {
    element: <PercentageValue value={78} greenFrom={70} orangeFrom={40} />,
    code: '<PercentageValue value={78} greenFrom={70} orangeFrom={40} />',
};