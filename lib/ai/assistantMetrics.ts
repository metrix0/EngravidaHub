// lib/ai/assistantMetrics.ts
export const DASHBOARD_FIRST_HUMAN_RESPONSE_LIMIT_SECONDS = 7_200;

export function summarizeFirstHumanResponseTimes(
    values: Array<number | null | undefined>,
) {
    const observedValues = values.filter(
        (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
    );
    const includedValues = observedValues.filter(
        (value) =>
            value <= DASHBOARD_FIRST_HUMAN_RESPONSE_LIMIT_SECONDS,
    );

    return {
        average_first_human_response_seconds: roundedAverage(includedValues),
        raw_average_first_human_response_seconds:
            roundedAverage(observedValues),
        median_first_human_response_seconds: percentile(observedValues, 0.5),
        p90_first_human_response_seconds: percentile(observedValues, 0.9),
        first_human_response_observed: observedValues.length,
        first_human_response_included_in_average: includedValues.length,
        first_human_response_excluded_over_2h:
            observedValues.length - includedValues.length,
        normalization_rule:
            "A média segue o Dashboard: inclui somente respostas humanas observadas de até 2 horas (7.200 segundos). Mediana e P90 usam todos os valores observados.",
    };
}

function roundedAverage(values: number[]) {
    if (values.length === 0) return null;
    return Math.round(
        values.reduce((total, value) => total + value, 0) /
            values.length,
    );
}

function percentile(values: number[], quantile: number) {
    if (values.length === 0) return null;

    const sorted = [...values].sort((first, second) => first - second);
    const position = (sorted.length - 1) * quantile;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sorted[lowerIndex];
    const upper = sorted[upperIndex];

    return Math.round(lower + (upper - lower) * (position - lowerIndex));
}
