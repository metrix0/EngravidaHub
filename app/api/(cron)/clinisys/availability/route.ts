import { NextResponse } from "next/server";

import { listClinisysAgendas, listClinisysAvailabilityByAgenda, listClinisysProcedures } from "@/lib/clinisys/client";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Agenda = {
    external_id: string;
    procedures: unknown;
    unit_id: string | null;
    doctor_id: string | null;
    unit_name: string;
    doctor_name: string;
    slot_duration_minutes: number;
    working_hours: unknown;
    exceptions: unknown;
    updated_at?: string;
    mapping?: { unitId: string; doctorId: string };
    isNew?: boolean;
};
type DoctorLink = {
    unit_id: string;
    doctor_id: string;
    unit: { name: string; active: boolean } | Array<{ name: string; active: boolean }>;
    doctor: { name: string; active: boolean } | Array<{ name: string; active: boolean }>;
};
type Slot = { data?: string; inicio?: string; termino?: string };
type Procedure = { id?: unknown; name?: unknown };

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
        const { data, error } = await supabase
            .from("clinisys_agendas")
            .select("external_id, procedures, unit_id, doctor_id, unit_name, doctor_name, slot_duration_minutes, working_hours, exceptions, updated_at")
            .eq("active", true);
        if (error) throw error;
        const agendas = (data ?? []) as Agenda[];
        const saved = new Map(agendas.map(agenda => [agenda.external_id, agenda]));
        const [remote, linkResult] = await Promise.all([
            listClinisysAgendas(),
            supabase.from("doctor_units")
                .select("unit_id, doctor_id, unit:units!inner(name, active), doctor:doctors!inner(name, active)")
                .eq("active", true).eq("unit.active", true).eq("doctor.active", true),
        ]);
        if (linkResult.error) throw linkResult.error;
        const links = (linkResult.data ?? []) as DoctorLink[];
        let unmapped = 0;
        for (const item of remote) {
            const id = String(item.id ?? "").trim();
            if (!id || !String(item.medico_id ?? "").trim() ||
                (item.status && normalize(item.status) !== "ativa")) continue;
            const known = saved.get(id);
            if (known?.unit_id && known?.doctor_id) continue;
            const match = matchDoctor(item, links);
            if (!match) {
                unmapped++;
                console.warn("[clinisys-availability] unmapped doctor agenda", id, item.nome);
                continue;
            }
            if (known) {
                known.mapping = { unitId: match.unitId, doctorId: match.doctorId };
            } else {
                const agenda: Agenda = {
                    external_id: id,
                    procedures: [],
                    unit_id: match.unitId,
                    doctor_id: match.doctorId,
                    unit_name: match.unitName,
                    doctor_name: match.doctorName,
                    slot_duration_minutes: Number(item.duracao_agendamento) > 0
                        ? Number(item.duracao_agendamento) : 45,
                    working_hours: [],
                    exceptions: [],
                    isNew: true,
                };
                saved.set(id, agenda);
                agendas.push(agenda);
            }
        }
        const from = brazilDate();
        const to = new Date(Date.parse(`${from}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
        const results: Array<{ agenda: string; ok: boolean; error?: string }> = [];
        let discovered = 0;
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, agendas.length) }, async () => {
            while (cursor < agendas.length) {
                const agenda = agendas[cursor++];
                try {
                    let procedures = agenda.procedures;
                    let procedure = pickProcedure(procedures);
                    if (!procedure) {
                        procedures = await listClinisysProcedures(agenda.external_id);
                        procedure = pickProcedure(procedures);
                    }
                    if (!procedure) throw new Error("No registered procedures");
                    const slots = [];
                    for (let offset = 0; offset <= 30; offset += 15) {
                        const dateFrom = new Date(Date.parse(`${from}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
                        const dateTo = new Date(Date.parse(`${from}T12:00:00Z`) + Math.min(offset + 14, 30) * 86_400_000).toISOString().slice(0, 10);
                        slots.push(...await listClinisysAvailabilityByAgenda({
                            agendaId: agenda.external_id,
                            procedureId: procedure.id,
                            dateFrom, dateTo,
                        }));
                    }
                    const safeSlots = slots.filter(slot =>
                        typeof slot.data === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(slot.data) &&
                        typeof slot.inicio === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.inicio) &&
                        typeof slot.termino === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.termino)
                    );
                    const availability_snapshot = {
                        dateFrom: from, dateTo: to, syncedAt: new Date().toISOString(),
                        procedureId: procedure.id, slots: safeSlots,
                    };
                    // The list API provides free slots, not entire working shifts.
                    // Keep real webhook schedules; use precise available periods only
                    // for days not covered by recorded working hours.
                    const exceptions = availabilityExceptions(agenda, safeSlots, from, to);
                    if (agenda.isNew) {
                        const { error: writeError } = await supabase.from("clinisys_agendas").insert({
                            external_id: agenda.external_id,
                            unit_id: agenda.unit_id,
                            doctor_id: agenda.doctor_id,
                            unit_name: agenda.unit_name,
                            doctor_name: agenda.doctor_name,
                            timezone: "America/Sao_Paulo",
                            slot_duration_minutes: agenda.slot_duration_minutes,
                            working_hours: [],
                            exceptions: exceptions ?? [],
                            blocks: [],
                            procedures,
                            availability_snapshot,
                            active: true,
                            updated_at: new Date().toISOString(),
                        });
                        if (writeError?.code === "23505") {
                            // A schedule webhook may have inserted the agenda since discovery.
                            // Never overwrite its authoritative working hours or blocks.
                            const { error: retryError } = await supabase.from("clinisys_agendas")
                                .update({ availability_snapshot }).eq("external_id", agenda.external_id);
                            if (retryError) throw retryError;
                        } else {
                            if (writeError) throw writeError;
                            discovered++;
                        }
                    } else {
                        const update: Record<string, unknown> = { availability_snapshot };
                        if (agenda.mapping) {
                            update.unit_id = agenda.mapping.unitId;
                            update.doctor_id = agenda.mapping.doctorId;
                        }
                        if (procedures !== agenda.procedures) update.procedures = procedures;
                        if (exceptions) update.exceptions = exceptions;
                        let query = supabase.from("clinisys_agendas")
                            .update(update).eq("external_id", agenda.external_id);
                        // Skip if a webhook updated the source schedule mid-sync.
                        if (exceptions && agenda.updated_at) query = query.eq("updated_at", agenda.updated_at);
                        const { error: writeError } = await query;
                        if (writeError) throw writeError;
                    }
                    results.push({ agenda: agenda.external_id, ok: true });
                } catch (error) {
                    console.error("[clinisys-availability] sync failed", agenda.external_id, error);
                    results.push({ agenda: agenda.external_id, ok: false,
                        error: error instanceof Error ? error.message : "Unknown error" });
                }
            }
        }));
        const failures = results.filter(result => !result.ok);
        return NextResponse.json({
            ok: failures.length === 0,
            total: agendas.length,
            synced: results.length - failures.length,
            failed: failures.length,
            discovered,
            unmapped,
            ...(failures.length ? { errors: failures } : {}),
            dateFrom: from, dateTo: to,
        }, { status: failures.length ? 502 : 200 });
    } catch (error) {
        console.error("[clinisys-availability] failed", error);
        return NextResponse.json({ ok: false,
            error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
    }
}

function pickProcedure(value: unknown) {
    if (!Array.isArray(value)) return null;
    const items = (value as Procedure[]).flatMap(item =>
        typeof item?.id === "string" && typeof item.name === "string"
            ? [{ id: item.id, name: item.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() }]
            : [],
    );
    return items.find(item => /1.*avaliacao.*presencial/.test(item.name)) ??
        items.find(item => /1.*avaliacao/.test(item.name)) ??
        items[0] ?? null;
}

function brazilDate() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    }).formatToParts(new Date());
    const value = (part: Intl.DateTimeFormatPartTypes) =>
        parts.find(item => item.type === part)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
}

function normalize(value: string) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function personTokens(value: string) {
    return normalize(value).replace(/^(dr|dra|doutor|doutora)\s+/, "")
        .split(" ").filter(token => token.length >= 3);
}

function one<T>(value: T | T[]) {
    return Array.isArray(value) ? value[0] ?? null : value;
}

function matchDoctor(
    remote: { unidade_nome?: string; medico_nome?: string; nome?: string },
    links: DoctorLink[],
) {
    const unitName = normalize(remote.unidade_nome ?? "");
    const doctorName = remote.medico_nome?.trim() ||
        (remote.nome ?? "").replace(/^[^-]+-\s*/, "");
    const tokens = personTokens(doctorName);
    if (!unitName || tokens.length < 2) return null;
    const matches = links.flatMap(link => {
        const unit = one(link.unit), doctor = one(link.doctor);
        if (!unit?.active || !doctor?.active || normalize(unit.name) !== unitName) return [];
        const knownTokens = personTokens(doctor.name);
        const shared = tokens.filter(token => knownTokens.includes(token)).length;
        if (shared < 2 || shared !== Math.min(tokens.length, knownTokens.length)) return [];
        return [{ unitId: link.unit_id, doctorId: link.doctor_id,
            unitName: unit.name, doctorName: doctor.name }];
    });
    return matches.length === 1 ? matches[0] : null;
}

function availabilityExceptions(agenda: Agenda, slots: Slot[], from: string, to: string) {
    const current = Array.isArray(agenda.exceptions)
        ? agenda.exceptions as Array<{ id?: string }> : [];
    const prefix = `clinisys-availability:${agenda.external_id}:`;
    const retained = current.filter(item => !String(item?.id ?? "").startsWith(prefix));
    const periods = new Map<string, Map<string, { startsAt: string; endsAt: string }>>();
    for (const slot of slots) {
        if (!slot.data || !slot.inicio || !slot.termino || slot.inicio >= slot.termino) continue;
        const date = `${slot.data.slice(6)}-${slot.data.slice(3, 5)}-${slot.data.slice(0, 2)}`;
        if (date < from || date > to || hasWorkingHours(agenda.working_hours, date)) continue;
        const day = periods.get(date) ?? new Map();
        day.set(`${slot.inicio}-${slot.termino}`, { startsAt: slot.inicio, endsAt: slot.termino });
        periods.set(date, day);
    }
    const generated = [...periods].map(([date, values]) => ({
        id: `${prefix}${date}`, date, available: true,
        periods: [...values.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }));
    return generated.length || retained.length !== current.length
        ? [...retained, ...generated] : null;
}

function hasWorkingHours(value: unknown, date: string) {
    if (!Array.isArray(value)) return false;
    const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    return value.some(item =>
        Array.isArray(item?.daysOfWeek) && item.daysOfWeek.includes(day) &&
        typeof item.validFrom === "string" && item.validFrom <= date &&
        (!item.validUntil || item.validUntil >= date)
    );
}
