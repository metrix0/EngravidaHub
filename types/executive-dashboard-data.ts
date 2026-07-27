// types/executive-dashboard-data.ts
export type ExecutiveKpis = {
    conversations_analyzed: number;

    real_resolution_rate: number | null;
    resolution_observed: number;
    resolution_coverage_rate: number | null;

    clear_satisfaction_rate: number | null;
    satisfaction_observed: number;
    satisfaction_coverage_rate: number | null;

    scheduling_rate: number | null;
    scheduling_eligible: number;

    average_first_human_response_seconds: number | null;
    raw_average_first_human_response_seconds: number | null;
    median_first_human_response_seconds: number | null;
    p90_first_human_response_seconds: number | null;
    first_human_response_observed: number;
    first_human_response_eligible: number;
    first_human_response_included_in_average: number;
    first_human_response_excluded_over_2h: number;
    first_human_response_coverage_rate: number | null;
};

export type ExecutiveDashboardData = {
    filters: {
        days: number;
        start_date: string | null;
        end_date: string | null;
        unit_ids: string[];
        service_ids: string[];
        tunnel_values: string[];
        origin_values: string[];
        attendant_ids: string[];
    };

    response_anchor_breakdown: {
        bot_handoff_to_attendant: number;
        pending_client_to_attendant: number;
    };

    kpis: ExecutiveKpis;
    previous_kpis: ExecutiveKpis;

    daily_evolution: {
        date: string;
        date_iso?: string;
        conversations: number;
        resolution_rate: number | null;
        resolution_observed: number;
        satisfaction_rate: number | null;
        satisfaction_observed: number;
    }[];

    schedule_summary: {
        total: number;
        unique_total: number;
        cancelled: number;
        showed_up: number;
        no_show: number;
        rescheduled: number;
        pending: number;
        unknown: number;
    };

    schedule_evolution: {
        date: string;
        date_iso: string;
        total: number;
        cancelled: number;
        showed_up: number;
        no_show: number;
        rescheduled: number;
        unique_total: number;
        unique_cancelled: number;
        unique_showed_up: number;
        unique_no_show: number;
        unique_rescheduled: number;
    }[];

    schedule_creation_evolution: {
        date: string;
        date_iso: string;
        total: number;
    }[];

    schedules_by_unit: {
        unit_name: string;
        count: number;
        percentage: number | null;
        no_show: number;
        outcomes_observed: number;
        no_show_rate: number | null;
    }[];

    schedule_unit_table: {
        rows: {
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
        }[];
        total: {
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
    };

    attendance_score: {
        overall_score: number | null;
        resolution_score: number | null;
        satisfaction_score: number | null;
        response_speed_score: number | null;
        attendant_quality_score: number | null;
    };

    dropoff_moments: {
        moment: string;
        label: string;
        count: number;
        percentage: number | null;
    }[];

    conversation_goals: {
        goal: string;
        label: string;
        count: number;
        percentage: number | null;
    }[];

    by_unit: {
        unit_id: string | null;
        unit_name: string;
        conversations: number;
        resolution_rate: number | null;
        resolution_observed: number;
        satisfaction_rate: number | null;
        satisfaction_observed: number;
        scheduling_rate: number | null;
        scheduling_eligible: number;
        appointments_count: number;
        no_show_rate: number | null;
        no_show: number;
        outcomes_observed: number;
    }[];
};
