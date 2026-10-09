import { NextResponse } from "next/server";

import { listClinisysAvailabilityByAgenda } from "@/lib/clinisys/client";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Agenda = { external_id: string; procedures: unknown };
type Procedure = { id?: unknown; name?: unknown };

export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
        const { data, error } = await supabase
            .from("clinisys_agendas")
            .select("external_id, procedures")
            .eq("active", true);
        if (error) throw error;
        const agendas = (data ?? []) as Agenda[];
        const from = brazilDate();
        const to = new Date(Date.parse(`${from}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
        const results: Array<{ agenda: string; ok: boolean; error?: string }> = [];
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, agendas.length) }, async () => {
            while (cursor < agendas.length) {
                const agenda = agendas[cursor++];
                try {
                    const procedure = pickProcedure(agenda.procedures);
                    if (!procedure) throw new Error("No registered procedures");
                    const slots = await listClinisysAvailabilityByAgenda({
                        agendaId: agenda.external_id,
                        procedureId: procedure.id,
                        dateFrom: from,
                        dateTo: to,
                    });
                    const safeSlots = slots.filter(slot =>
                        typeof slot.data === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(slot.data) &&
                        typeof slot.inicio === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.inicio) &&
                        typeof slot.termino === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.termino)
                    );
                    const { error: writeError } = await supabase.from("clinisys_agendas")
                        .update({
                            availability_snapshot: {
                                dateFrom: from, dateTo: to, syncedAt: new Date().toISOString(),
                                procedureId: procedure.id, slots: safeSlots,
                            },
                        }).eq("external_id", agenda.external_id);
                    if (writeError) throw writeError;
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
