import { supabase } from "@/lib/supabase/client";
import { executiveRpcParams, type DashboardDateRange, type DashboardFilters } from "@/lib/dashboard/metrics";
import type { TunnelRoiData } from "@/types/tunnel-performance";

export async function loadTunnelPerformance(
    range: Pick<DashboardDateRange, "startAt" | "endAt">,
    filters: DashboardFilters,
    signal: AbortSignal,
    invoiceCategories: string[] | null = null,
): Promise<TunnelRoiData | null> {
    const { data, error } = await supabase.rpc("dashboard_tunnel_performance_v1", {
        ...executiveRpcParams(range, filters),
        p_invoice_categories: invoiceCategories,
    }).abortSignal(signal);

    if (error) {
        if (!signal.aborted) console.warn("[dashboard/tunnels] data unavailable", error.code);
        return null;
    }

    return data && Array.isArray(data.tunnels) ? groupProblemAndTreatmentRoi(data) : null;
}

function groupProblemAndTreatmentRoi(data: TunnelRoiData): TunnelRoiData {
    const [first, second] = data.tunnels.filter(
        ({ tunnel }) => tunnel === "Problemas" || tunnel === "Tratamentos",
    );
    if (!first) return data;

    const combined = { ...first, tunnel: "Problemas e Tratamentos" };
    if (second) {
        combined.paid_clients += second.paid_clients;
        combined.authorized_clients += second.authorized_clients;
        combined.attributed_revenue = Number((first.attributed_revenue + second.attributed_revenue).toFixed(2));
        combined.investment = Number((first.investment + second.investment).toFixed(2));
        combined.investment_share = data.total_spend > 0
            ? Number((100 * combined.investment / data.total_spend).toFixed(1))
            : null;
        combined.roi_percent = combined.investment > 0
            ? Number((100 * (combined.attributed_revenue - combined.investment) / combined.investment).toFixed(1))
            : null;
        const campaigns = new Map<string, typeof first.campaigns[number]>();
        for (const campaign of [...first.campaigns, ...second.campaigns]) {
            const key = JSON.stringify([campaign.platform, campaign.account_id, campaign.campaign_id]);
            const previous = campaigns.get(key);
            campaigns.set(key, previous
                ? { ...previous, spend: Number((previous.spend + campaign.spend).toFixed(2)) }
                : campaign);
        }
        combined.campaigns = [...campaigns.values()].sort((a, b) => b.spend - a.spend);
    }

    return {
        ...data,
        tunnels: data.tunnels
            .filter((row) => row !== second)
            .map((row) => row === first ? combined : row),
    };
}
