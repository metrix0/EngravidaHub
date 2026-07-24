// types/monthly-management.ts
export type MonthlyFinancialUnitRow = {
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

export type MonthlyScheduleUnitRow = {
    unit_name: string;
    appointments: number;
    reschedulings: number;
    rescheduling_rate: number | null;
    unique_appointments: number;
    pending: number;
    showed_up: number;
    showed_up_rate: number | null;
    projection: number;
    rescheduled: number;
    rescheduled_rate: number | null;
    cancelled: number;
    cancelled_rate: number | null;
    no_show: number;
    no_show_rate: number | null;
};

export type MonthlyManagementData = {
    month: string;
    month_label: string;
    generated_at: string;
    days_elapsed: number;
    days_in_month: number;
    financial: {
        projection: number;
        current_total: number;
        rows: MonthlyFinancialUnitRow[];
        total: MonthlyFinancialUnitRow;
    };
    schedules: {
        rows: MonthlyScheduleUnitRow[];
        total: MonthlyScheduleUnitRow;
    };
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
