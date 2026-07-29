// lib/units/findOrCreateUnitByName.ts
import { supabase } from "@/lib";
import { withSupabaseRetry } from "@/lib/supabase/retry";

type UnitForName = {
    id: string;
    name: string;
};

export async function findOrCreateUnitByName(
    name: string | null | undefined
): Promise<UnitForName | null> {
    const unitName = cleanUnitName(name);

    if (!unitName) {
        return null;
    }

    const { data: existingUnits, error: findError } = await withSupabaseRetry(
        () => supabase.from("units").select("id, name, active"),
        {
            attempts: 3,
            label: "unit lookup",
        },
    );

    if (findError) {
        throw findError;
    }

    const existingUnit = existingUnits?.find((unit) => {
        return normalizeUnitName(unit.name) === normalizeUnitName(unitName);
    });

    if (existingUnit) {
        return existingUnit.active
            ? { id: existingUnit.id, name: existingUnit.name }
            : null;
    }

    const { data: createdUnit, error: createError } = await supabase
        .from("units")
        .insert({
            name: unitName,
            active: true,
        })
        .select("id, name, active")
        .single();

    if (createError) {
        throw createError;
    }

    return {
        id: createdUnit.id,
        name: createdUnit.name,
    };
}

function cleanUnitName(value: string | null | undefined) {
    const cleaned = value?.trim().replace(/\s+/g, " ") ?? null;
    return cleaned || null;
}

function normalizeUnitName(value: string) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
}
