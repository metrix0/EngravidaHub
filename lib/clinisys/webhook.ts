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
    const { data, error } = await supabase
        .from("doctor_units")
        .select(`
            unit_id,
            doctor_id,
            unit:units!inner(id, name, city, state),
            doctor:doctors!inner(id, name, active)
        `)
        .eq("active", true)
        .eq("doctor.active", true);
    if (error) throw error;

    const targetDoctor = normalizePerson(doctorName);
    const targetUnit = normalize(unitName);
    const ranked = (data ?? []).flatMap((row) => {
        const doctor = relationOne(row.doctor);
        const unit = relationOne(row.unit);
        if (!doctor || !unit) return [];
        const doctorScore = matchScore(normalizePerson(doctor.name), targetDoctor, 100);
        if (doctorScore === 0) return [];
        const unitScores = [
            matchScore(normalize(unit.name), targetUnit, 50),
            matchScore(normalize(unit.city ?? ""), targetUnit, 40),
            matchScore(normalize(unit.state ?? ""), targetUnit, 30),
        ];
        return [{
            unitId: row.unit_id,
            doctorId: row.doctor_id,
            score: doctorScore + Math.max(...unitScores),
        }];
    });
    if (!ranked.length) return null;
    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best.score < 100) return null;
    if (ranked[1] && ranked[1].score === best.score &&
        (ranked[1].unitId !== best.unitId || ranked[1].doctorId !== best.doctorId)) {
        return null;
    }
    return { unitId: best.unitId, doctorId: best.doctorId };
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
