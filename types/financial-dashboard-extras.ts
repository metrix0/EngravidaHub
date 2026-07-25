// types/financial-dashboard-extras.ts
export type FinancialUnitRow = {
    unit_id: string | null;
    unit_name: string;
    projection: number;
    total: number;
    internal_doctors: number;
    external_doctors: number;
    first_evaluation: number;
    ivf: number;
    egg_freezing_cycle: number;
    embryo_transfer: number;
    storage: number;
    exams: number;
    freezing: number;
    other: number;
};

export type ProcedureCategoryKey =
    | "first_evaluation"
    | "ivf"
    | "egg_freezing_cycle"
    | "embryo_transfer"
    | "storage"
    | "exams"
    | "freezing"
    | "other";

export type ProcedureCityRow = {
    unit_id: string | null;
    unit_name: string;
    total: number;
    first_evaluation: number;
    ivf: number;
    egg_freezing_cycle: number;
    embryo_transfer: number;
    storage: number;
    exams: number;
    freezing: number;
    other: number;
};

export type FinancialUnitSummaryData = {
    projection: number;
    rows: FinancialUnitRow[];
    total: FinancialUnitRow;
    procedures_by_city: ProcedureCityRow[];
};

export type RevenueMonthSeries = {
    month: string;
    month_label: string;
    authorized_invoices: number;
    evolution: {
        period: string;
        label: string;
        authorized_revenue: number;
        cancelled_amount: number;
        authorized_invoices: number;
    }[];
};

export type RevenueComparisonData = {
    current: RevenueMonthSeries;
    comparison: RevenueMonthSeries;
};
