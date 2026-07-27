// types/media-budget-by-city.ts
export type MediaBudgetByCityRow = {
    key: string;
    unit_id: string | null;
    city: string;
    monthly_budget: number;
    spend: number;
    google_spend: number;
    meta_spend: number;
    remaining: number;
    daily_budget: number | null;
    projection: number;
    pace_percentage: number | null;
    schedules: number;
    cost_per_schedule: number | null;
    matched_campaigns: number;
};

export type MediaBudgetByCityResponse = {
    reference_month: string;
    period_start: string;
    period_end: string;
    as_of_date: string;
    days_in_month: number;
    elapsed_days: number;
    remaining_days: number;
    rows: MediaBudgetByCityRow[];
    audit: {
        total_spend: number;
        matched_spend: number;
        unmatched_spend: number;
        matched_campaigns: number;
        unmatched_campaigns: number;
    };
};
