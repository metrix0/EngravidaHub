// lib/ads/mediaBudgetByCity.ts
export type MediaBudgetCityConfig = {
    key: string;
    city: string;
    monthlyBudget: number;
    aliases: string[];
};

// Monthly budgets supplied in the reference management table.
export const MEDIA_BUDGET_CITIES: MediaBudgetCityConfig[] = [
    {
        key: "sao_paulo",
        city: "São Paulo",
        monthlyBudget: 70_000,
        aliases: ["sao paulo", "sp"],
    },
    {
        key: "rio_de_janeiro",
        city: "Rio de Janeiro",
        monthlyBudget: 45_000,
        aliases: ["rio de janeiro", "rj"],
    },
    {
        key: "salvador",
        city: "Salvador",
        monthlyBudget: 35_000,
        aliases: ["salvador", "ssa"],
    },
    {
        key: "brasilia",
        city: "Brasília",
        monthlyBudget: 35_000,
        aliases: ["brasilia", "bsb"],
    },
    {
        key: "juiz_de_fora",
        city: "Juiz de Fora",
        monthlyBudget: 30_000,
        aliases: ["juiz de fora", "jf", "jdf"],
    },
    {
        key: "belo_horizonte",
        city: "Belo Horizonte",
        monthlyBudget: 30_000,
        aliases: ["belo horizonte", "bh"],
    },
    {
        key: "manaus",
        city: "Manaus",
        monthlyBudget: 25_000,
        aliases: ["manaus", "mao"],
    },
    {
        key: "vitoria",
        city: "Vitória",
        monthlyBudget: 30_000,
        aliases: ["vitoria", "vix"],
    },
    {
        key: "bauru",
        city: "Bauru",
        monthlyBudget: 20_000,
        aliases: ["bauru", "bau"],
    },
    {
        key: "campinas",
        city: "Campinas",
        monthlyBudget: 10_000,
        aliases: ["campinas", "cpq"],
    },
];

export function matchMediaBudgetCity(
    campaignName: string | null | undefined,
): MediaBudgetCityConfig | null {
    const normalizedCampaign = normalizeCampaignMatchText(campaignName);
    if (!normalizedCampaign) return null;

    const paddedCampaign = ` ${normalizedCampaign} `;

    for (const city of MEDIA_BUDGET_CITIES) {
        for (const alias of city.aliases) {
            const normalizedAlias = normalizeCampaignMatchText(alias);
            if (!normalizedAlias) continue;

            if (paddedCampaign.includes(` ${normalizedAlias} `)) {
                return city;
            }
        }
    }

    return null;
}

export function normalizeCampaignMatchText(
    value: string | null | undefined,
) {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
