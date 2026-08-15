// app/api/dashboard/filters/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib";
import type { FilterEntity, FilterOption, FiltersResponse } from "@/types";

type DashboardFilterEntity = FilterEntity | "tunnels" | "origins";

const allowedEntities: DashboardFilterEntity[] = [
    "units",
    "attendants",
    "services",
    "tunnels",
    "origins",
];

const NULL_FILTER_VALUE = "__NULL__";
const FILTER_CACHE_MS = 5 * 60 * 1_000;

type ConversationOptions = {
    tunnels: FilterOption[];
    origins: FilterOption[];
};

const filterCache = new Map<
    string,
    { value: FilterOption[] | ConversationOptions; expiresAt: number }
>();
const pendingFilters = new Map<
    string,
    Promise<FilterOption[] | ConversationOptions>
>();

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);

        const entitiesParam = searchParams.get("entities");

        const requestedEntities = entitiesParam
            ? entitiesParam
                .split(",")
                .map((entity) => entity.trim())
                .filter((entity): entity is DashboardFilterEntity =>
                    allowedEntities.includes(entity as DashboardFilterEntity)
                )
            : allowedEntities;

        const response: FiltersResponse = {};
        const entries = await Promise.all(
            requestedEntities.map(async (entity) => {
                if (entity === "tunnels" || entity === "origins") {
                    const options = (await readFilterCache(
                        "conversation-text-options",
                        getConversationTextOptions,
                    )) as ConversationOptions;

                    return [entity, options[entity]] as const;
                }

                const options = (await readFilterCache(entity, () =>
                    getActiveEntityOptions(entity),
                )) as FilterOption[];

                return [entity, options] as const;
            }),
        );

        for (const [entity, options] of entries) {
            response[entity] = options;
        }

        return NextResponse.json(response, {
            headers: {
                "Cache-Control": "private, max-age=60, stale-while-revalidate=240",
            },
        });
    } catch (error) {
        console.error("[/api/dashboard/filters] Failed to load filters", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load dashboard filters",
            },
            { status: 500 }
        );
    }
}

async function getActiveEntityOptions(
    table: "units" | "attendants" | "services"
): Promise<FilterOption[]> {
    const { data, error } = await supabase
        .from(table)
        .select("id, name")
        .eq("active", true)
        .order("name");

    if (error) throw error;

    return (
        data?.map((item) => ({
            label: item.name,
            value: item.id,
        })) ?? []
    );
}

async function getConversationTextOptions(): Promise<ConversationOptions> {
    const { data, error } = await supabase.rpc(
        "dashboard_conversation_filter_options_v1"
    );

    if (error) throw error;

    const rows = (data ?? []) as Array<{
        tunnel: string | null;
        origin: string | null;
    }>;

    return {
        tunnels: buildNullableTextOptions(rows.map((item) => item.tunnel)),
        origins: buildNullableTextOptions(rows.map((item) => item.origin)),
    };
}

async function readFilterCache<T extends FilterOption[] | ConversationOptions>(
    key: string,
    loader: () => Promise<T>,
): Promise<T> {
    const cached = filterCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value as T;
    }

    const pending = pendingFilters.get(key);
    if (pending) return pending as Promise<T>;

    const request = loader()
        .then((value) => {
            filterCache.set(key, {
                value,
                expiresAt: Date.now() + FILTER_CACHE_MS,
            });
            return value;
        })
        .catch((error) => {
            if (cached) return cached.value as T;
            throw error;
        })
        .finally(() => {
            pendingFilters.delete(key);
        });

    pendingFilters.set(key, request);
    return request;
}

function buildNullableTextOptions(values: Array<string | null>) {
    const hasNull = values.some((value) => !value || !String(value).trim());

    const definedOptions = Array.from(
        new Set(
            values
                .map((value) => String(value ?? "").trim())
                .filter(Boolean)
        )
    )
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({
            label: value,
            value,
        }));

    return [
        ...(hasNull
            ? [
                {
                    label: "Não definido",
                    value: NULL_FILTER_VALUE,
                },
            ]
            : []),
        ...definedOptions,
    ];
}
