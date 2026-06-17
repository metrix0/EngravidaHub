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

        for (const entity of requestedEntities) {
            if (entity === "units") {
                response.units = await getActiveEntityOptions("units");
            }

            if (entity === "attendants") {
                response.attendants = await getActiveEntityOptions("attendants");
            }

            if (entity === "services") {
                response.services = await getActiveEntityOptions("services");
            }

            if (entity === "tunnels") {
                response.tunnels = await getConversationTextOptions("tunnel");
            }

            if (entity === "origins") {
                response.origins = await getConversationTextOptions("origin");
            }
        }

        return NextResponse.json(response);
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

async function getConversationTextOptions(
    column: "tunnel" | "origin"
): Promise<FilterOption[]> {
    const { data, error } = await supabase
        .from("conversations")
        .select(column);

    if (error) throw error;

    return buildNullableTextOptions(
        (data ?? []).map((item) => item[column] as string | null)
    );
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

