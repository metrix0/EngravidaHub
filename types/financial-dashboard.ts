// types/financial-dashboard.ts
import type { FilterOption } from "./filters";

export type FinancialKpis = {
    authorized_revenue: number;
    authorized_invoices: number;
    average_ticket: number | null;
    billed_patients: number;
    cancelled_amount: number;
    cancellation_rate: number | null;
};

export type PaidMediaKpis = {
    spend: number;
    attributed_revenue: number | null;
    return_on_spend: number | null;
    schedules: number | null;
    billed_patients: number | null;
    cost_per_schedule: number | null;
    cost_per_billed_patient: number | null;
    impressions: number;
    clicks: number;
    click_through_rate: number | null;
    cost_per_click: number | null;
    reported_conversions: number;
    cost_per_reported_conversion: number | null;
};

export type FinancialDashboardData = {
    filters: {
        start_date: string | null;
        end_date: string | null;
        unit_ids: string[];
        categories: string[];
    };
    available_filters: {
        categories: FilterOption[];
    };
    kpis: FinancialKpis;
    previous_kpis: FinancialKpis;
    evolution: {
        period: string;
        label: string;
        authorized_revenue: number;
        cancelled_amount: number;
        authorized_invoices: number;
        average_ticket: number | null;
    }[];
    by_status: {
        status: "authorized" | "cancelled" | "pending" | "denied" | "other";
        label: string;
        invoices: number;
        amount: number;
        percentage: number | null;
    }[];
    by_category: {
        category: string;
        label: string;
        invoices: number;
        revenue: number;
        average_ticket: number | null;
        percentage: number | null;
    }[];
    by_unit: {
        unit_id: string | null;
        unit_name: string;
        invoices: number;
        revenue: number;
        average_ticket: number | null;
        patients: number;
        cancellation_rate: number | null;
        schedules: number;
    }[];
    by_doctor: {
        doctor_name: string;
        invoices: number;
        revenue: number;
        average_ticket: number | null;
        percentage: number | null;
    }[];
    crm: {
        linked_invoices: number;
        linked_revenue: number;
        linked_revenue_coverage: number | null;
        attributed_revenue: number;
        attribution_coverage: number | null;
        scheduled_clients: number;
        billed_scheduled_clients: number;
        schedule_to_billing_rate: number | null;
        by_origin: {
            origin: string;
            invoices: number;
            revenue: number;
            percentage: number | null;
        }[];
    };
    ads: {
        has_data: boolean;
        comparison_available: boolean;
        kpis: PaidMediaKpis;
        previous_kpis: PaidMediaKpis;
        evolution: {
            period: string;
            label: string;
            spend: number;
            google_spend: number;
            meta_spend: number;
            attributed_revenue: number | null;
        }[];
        by_platform: {
            platform: "google_ads" | "meta_ads";
            label: string;
            spend: number;
            attributed_revenue: number | null;
            return_on_spend: number | null;
            impressions: number;
            clicks: number;
            click_through_rate: number | null;
            cost_per_click: number | null;
            reported_conversions: number;
            cost_per_reported_conversion: number | null;
            schedules: number | null;
            billed_patients: number | null;
            cost_per_schedule: number | null;
            cost_per_billed_patient: number | null;
        }[];
        top_campaigns: {
            platform: "google_ads" | "meta_ads";
            platform_label: string;
            account_id: string;
            account_name: string;
            campaign_id: string;
            campaign_name: string;
            spend: number;
            impressions: number;
            clicks: number;
            click_through_rate: number | null;
            cost_per_click: number | null;
            reported_conversions: number;
            cost_per_reported_conversion: number | null;
        }[];
        by_city: {
            key: string;
            unit_id: string | null;
            city: string;
            monthly_budget: number;
            spend: number;
            google_spend: number;
            meta_spend: number;
            average_daily_spend: number;
            monthly_projection: number;
            remaining_to_budget: number;
            pace_percentage: number | null;
            schedules: number;
            cost_per_schedule: number | null;
            paid_schedules: number;
            cost_per_paid_schedule: number | null;
            attributed_revenue: number;
            attributed_patients: number;
            real_roas: number | null;
            matched_campaigns: number;
            matched_campaign_names: string[];
        }[];
        unmatched_city_spend: number;
        last_synced_at: string | null;
    };
    audit: {
        invoices_in_period: number;
        authorized_invoices: number;
        invoices_with_client: number;
        last_synced_at: string | null;
    };
};
