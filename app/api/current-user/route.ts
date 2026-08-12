// app/api/current-user/route.ts
import { NextResponse } from "next/server";

import { supabase as adminSupabase } from "@/lib";
import { getCurrentAuthUser } from "@/lib/auth/getCurrentAuthUser";
import {
    normalizeAllowedTabs,
    type CurrentUserUnitLock,
} from "@/lib/auth/userAccess";

type UserPermissionRow = {
    auth_user_id: string;
    preset: string;
    allowed_tabs: unknown;
    attendant_id: string | null;
    active: boolean;
};

type AttendantRow = {
    queue_id: string | null;
    active: boolean;
};

type QueueRow = {
    id: string;
    name: string;
};

type UnitRow = {
    id: string;
    name: string;
    city: string;
};

export async function GET() {
    const user = await getCurrentAuthUser();

    // Having no session is an expected application state, not an API failure.
    // Returning 200 prevents noisy 401 errors in the browser; the client guard
    // is responsible for redirecting unauthenticated users to /login.
    if (!user) {
        return NextResponse.json({
            ok: true,
            user: null,
            permission: null,
        });
    }

    const { data: permissionData, error: permissionError } = await adminSupabase
        .from("user_permissions")
        .select("auth_user_id, preset, allowed_tabs, attendant_id, active")
        .eq("auth_user_id", user.id)
        .maybeSingle();

    if (permissionError) {
        return NextResponse.json(
            {
                ok: false,
                error: permissionError.message,
            },
            { status: 500 },
        );
    }

    const permissionRow = permissionData as UserPermissionRow | null;
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const unitLock = permissionRow
        ? await resolveAttendantUnitLock(permissionRow)
        : null;

    return NextResponse.json({
        ok: true,
        user: {
            id: user.id,
            email: user.email ?? null,
            name:
                getMetadataString(metadata, "name") ??
                getMetadataString(metadata, "full_name") ??
                getMetadataString(metadata, "display_name") ??
                getMetadataString(metadata, "user_name") ??
                user.email?.split("@")[0] ??
                "Usuário",
        },
        permission: permissionRow
            ? {
                auth_user_id: permissionRow.auth_user_id,
                preset: permissionRow.preset,
                allowed_tabs: normalizeAllowedTabs(permissionRow.allowed_tabs),
                attendant_id: permissionRow.attendant_id,
                active: permissionRow.active,
                unit_lock: unitLock,
            }
            : null,
    });
}

async function resolveAttendantUnitLock(
    permission: UserPermissionRow,
): Promise<CurrentUserUnitLock | null> {
    if (
        !permission.active ||
        permission.preset !== "atendente" ||
        !permission.attendant_id
    ) {
        return null;
    }

    const [attendantResult, queuesResult, unitsResult] = await Promise.all([
        adminSupabase
            .from("attendants")
            .select("queue_id, active")
            .eq("id", permission.attendant_id)
            .maybeSingle(),
        adminSupabase
            .from("queues")
            .select("id, name")
            .eq("active", true),
        adminSupabase
            .from("units")
            .select("id, name, city")
            .eq("active", true),
    ]);

    if (attendantResult.error || queuesResult.error || unitsResult.error) {
        console.error("[current-user] unit lock lookup failed", {
            attendant: attendantResult.error?.message ?? null,
            queues: queuesResult.error?.message ?? null,
            units: unitsResult.error?.message ?? null,
        });
        return null;
    }

    const attendant = attendantResult.data as AttendantRow | null;
    if (!attendant?.active || !attendant.queue_id) return null;

    const queue = ((queuesResult.data ?? []) as QueueRow[]).find(
        (item) => item.id === attendant.queue_id,
    );
    if (!queue?.name.trim()) return null;

    const normalizedQueueName = normalizePlaceName(queue.name);
    const units = (unitsResult.data ?? []) as UnitRow[];

    const matchingUnit = [...units]
        .filter((unit) => unit.city?.trim())
        .sort((first, second) => second.city.length - first.city.length)
        .find((unit) =>
            normalizedQueueName.includes(normalizePlaceName(unit.city)),
        );

    if (!matchingUnit) return null;

    return {
        id: matchingUnit.id,
        name: matchingUnit.name,
        city: matchingUnit.city,
    };
}

function normalizePlaceName(value: string) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}

function getMetadataString(
    metadata: Record<string, unknown>,
    key: string,
) {
    const value = metadata[key];

    return typeof value === "string" && value.trim() ? value.trim() : null;
}
