import { NextResponse } from "next/server";

import { supabase as adminSupabase } from "@/lib";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import {
    filterDashboardWidgetIds,
    getDashboardPreset,
} from "@/lib/personal-dashboard/registryExtended";

type DashboardRow = {
    user_id: string;
    widget_ids: string[] | null;
    preset: string | null;
    version: number | null;
    updated_at: string | null;
};

type UpdateBody = {
    widget_ids?: unknown;
    version?: unknown;
};

export async function GET() {
    const access = await getServerTabAccess("dashboard");
    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    const { data, error } = await adminSupabase
        .from("user_dashboards")
        .select("user_id, widget_ids, preset, version, updated_at")
        .eq("user_id", access.user.id)
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const current = data as DashboardRow | null;
    const currentIds = filterDashboardWidgetIds(
        current?.widget_ids ?? [],
        access.permission.allowed_tabs,
    );

    if (currentIds.length > 0) {
        return NextResponse.json({
            widget_ids: currentIds,
            preset: current?.preset ?? access.permission.preset,
            version: current?.version ?? 1,
        });
    }

    const presetIds = getDashboardPreset(
        access.permission.preset,
        access.permission.allowed_tabs,
    );
    const nextVersion = Math.max(1, (current?.version ?? 0) + 1);

    const { error: upsertError } = await adminSupabase
        .from("user_dashboards")
        .upsert(
            {
                user_id: access.user.id,
                widget_ids: presetIds,
                preset: access.permission.preset,
                version: nextVersion,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
        );

    if (upsertError) {
        return NextResponse.json(
            { error: upsertError.message },
            { status: 500 },
        );
    }

    return NextResponse.json({
        widget_ids: presetIds,
        preset: access.permission.preset,
        version: nextVersion,
    });
}

export async function PUT(request: Request) {
    const access = await getServerTabAccess("dashboard");
    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    let body: UpdateBody;
    try {
        body = (await request.json()) as UpdateBody;
    } catch {
        return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    if (!Array.isArray(body.widget_ids)) {
        return NextResponse.json(
            { error: "widget_ids deve ser uma lista" },
            { status: 400 },
        );
    }

    const requestedIds = body.widget_ids.filter(
        (value): value is string => typeof value === "string",
    );
    const widgetIds = filterDashboardWidgetIds(
        requestedIds,
        access.permission.allowed_tabs,
    );
    const expectedVersion =
        typeof body.version === "number" && Number.isInteger(body.version)
            ? body.version
            : 0;

    const { data, error } = await adminSupabase
        .from("user_dashboards")
        .select("user_id, widget_ids, preset, version, updated_at")
        .eq("user_id", access.user.id)
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const current = data as DashboardRow | null;
    const currentVersion = current?.version ?? 0;

    if (currentVersion !== expectedVersion) {
        return NextResponse.json(
            {
                error: "Dashboard atualizado em outra sessão",
                widget_ids: filterDashboardWidgetIds(
                    current?.widget_ids ?? [],
                    access.permission.allowed_tabs,
                ),
                preset: current?.preset ?? access.permission.preset,
                version: currentVersion,
            },
            { status: 409 },
        );
    }

    const nextVersion = currentVersion + 1;
    const { error: upsertError } = await adminSupabase
        .from("user_dashboards")
        .upsert(
            {
                user_id: access.user.id,
                widget_ids: widgetIds,
                preset: access.permission.preset,
                version: nextVersion,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
        );

    if (upsertError) {
        return NextResponse.json(
            { error: upsertError.message },
            { status: 500 },
        );
    }

    return NextResponse.json({
        widget_ids: widgetIds,
        preset: access.permission.preset,
        version: nextVersion,
    });
}
