export type TunnelRoiData = {
    available: boolean;
    currency_code: string;
    total_spend: number;
    tunnels: {
        tunnel: string;
        paid_clients: number;
        authorized_clients: number;
        attributed_revenue: number;
        investment: number;
        investment_share: number | null;
        roi_percent: number | null;
        campaigns: {
            platform: "google_ads" | "meta_ads";
            account_id: string;
            campaign_id: string;
            campaign_name: string;
            spend: number;
        }[];
    }[];
};

export type TunnelFinanceRow = Pick<
    TunnelRoiData["tunnels"][number],
    "tunnel" | "investment" | "attributed_revenue"
>;
