import { createHmac, timingSafeEqual } from "node:crypto";

import { supabase } from "@/lib/supabase/client";

type HubMatch = {
    unitId: string;
    doctorId: string;
} | null;

export function verifyClinisysWebhook(rawBody: string, signature: string | null) {
    const secret = process.env.CLINISYS_WEBHOOK_SECRET?.trim();
    if (!secret) throw new Error("CLINISYS_WEBHOOK_SECRET não está configurado.");
    if (!signature) return false;

    const received = signature.trim().replace(/^sha256=/i, "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(received)) return false;

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(received, "hex");
    return (
        expectedBuffer.length === receivedBuffer.length &&
        timingSafeEqual(expectedBuffer, receivedBuffer)
    );
}

export async function resolveHubUnitDoctor(
    unitName: string,
    doctorName: string,
): Promise<HubMatch> {
    const [{ data: units, error: unitsError }, { data: doctors, error: doctorsError }] =
        await Promise.all([
            supabase
                .from("units")
                .select("id, name, city, state")
                .eq("active", true),
            supabase
                .from("doctors")
                .select("id, name, active"),
        ]);
    if (unitsError) throw unitsError;
    if (doctorsError) throw doctorsError;

    const targetUnit = normalize(unitName);
    const rankedUnits = (units ?? [])
        .map((unit) => ({
            id: unit.id,
            score: Math.max(
                matchScore(normalize(unit.name), targetUnit, 100),
                matchScore(normalize(unit.city ?? ""), targetUnit, 90),
            ),
        }))
        .filter((unit) => unit.score > 0)
        .sort((left, right) => right.score - left.score);
    const bestUnit = rankedUnits[0];
    if (
        !bestUnit ||
        (rankedUnits[1] &&
            rankedUnits[1].score === bestUnit.score &&
            rankedUnits[1].id !== bestUnit.id)
    ) {
        return null;
    }

    const targetDoctor = normalizePerson(doctorName);
    const rankedDoctors = (doctors ?? [])
        .map((doctor) => ({
            id: doctor.id,
            active: doctor.active,
            score: personMatchScore(normalizePerson(doctor.name), targetDoctor),
        }))
        .filter((doctor) => doctor.score > 0)
        .sort((left, right) => right.score - left.score);

    let doctorId: string;
    const bestDoctor = rankedDoctors[0];
    if (
        bestDoctor &&
        rankedDoctors[1] &&
        rankedDoctors[1].score === bestDoctor.score &&
        rankedDoctors[1].id !== bestDoctor.id
    ) {
        return null;
    }

    if (bestDoctor) {
        doctorId = bestDoctor.id;
        if (!bestDoctor.active) {
            const { error } = await supabase
                .from("doctors")
                .update({ active: true, updated_at: new Date().toISOString() })
                .eq("id", doctorId);
            if (error) throw error;
        }
    } else {
        const { data: created, error } = await supabase
            .from("doctors")
            .insert({
                name: doctorName.trim(),
                active: true,
            })
            .select("id")
            .single();
        if (error) throw error;
        doctorId = created.id;
    }

    const { error: linkError } = await supabase
        .from("doctor_units")
        .upsert(
            {
                doctor_id: doctorId,
                unit_id: bestUnit.id,
                active: true,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "doctor_id,unit_id" },
        );
    if (linkError) throw linkError;

    return { unitId: bestUnit.id, doctorId };
}

export function normalizeWebhookDate(value: string | null | undefined) {
    if (!value) return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    return null;
}

export function onlyDigits(value: string | null | undefined) {
    const digits = value?.replace(/\D/g, "") ?? "";
    return digits || null;
}

function matchScore(candidate: string, target: string, weight: number) {
    if (!candidate || !target) return 0;
    if (candidate === target) return weight;
    if (candidate.includes(target) || target.includes(candidate)) return Math.round(weight * 0.7);
    return 0;
}

function personMatchScore(candidate: string, target: string) {
    if (!candidate || !target) return 0;
    if (candidate === target) return 100;

    const candidateTokens = candidate.split(" ").filter((token) => token.length >= 3);
    const targetTokens = target.split(" ").filter((token) => token.length >= 3);
    if (!candidateTokens.length || !targetTokens.length) return 0;

    const targetSet = new Set(targetTokens);
    const shared = candidateTokens.filter((token) => targetSet.has(token)).length;
    const coverage = shared / Math.min(candidateTokens.length, targetTokens.length);
    if (shared >= 2 && coverage >= 0.66) return Math.round(coverage * 90);
    return candidate.includes(target) || target.includes(candidate) ? 70 : 0;
}

function normalizePerson(value: string) {
    return normalize(value).replace(/^(dr|dra|doutor|doutora)\s+/, "");
}

function normalize(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
