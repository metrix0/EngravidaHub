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
    audit: {
        invoices_in_period: number;
        authorized_invoices: number;
        invoices_with_client: number;
        last_synced_at: string | null;
    };
};
