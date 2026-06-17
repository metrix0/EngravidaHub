// apps/insights/src/lib/units/findOrCreateUnitByName.ts
import { supabase } from "@engravida/lib";

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

    const { data: existingUnits, error: findError } = await supabase
        .from("units")
        .select("id, name")
        .eq("active", true);

    if (findError) {
        throw findError;
    }

    const existingUnit = existingUnits?.find((unit) => {
        return normalizeUnitName(unit.name) === normalizeUnitName(unitName);
    });

    if (existingUnit) {
        return existingUnit;
    }

    const { data: createdUnit, error: createError } = await supabase
        .from("units")
        .insert({
            name: unitName,
            active: true,
        })
        .select("id, name")
        .single();

    if (createError) {
        throw createError;
    }

    return createdUnit;
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