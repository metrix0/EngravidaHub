import { NextResponse } from "next/server";

import {
    ActiveMessageBatchError,
    sendActiveMessageBatch,
} from "@/lib/active-messages/sendActiveMessageBatch";
import { getActiveMessageTemplate } from "@/lib/active-messages/templates";
import {
    DEFAULT_ACTIVE_MESSAGE_TEMPLATE_SENDER,
    parseActiveMessageTemplateSender,
} from "@/lib/active-messages/templateSenders";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const CADENCE_HOURS = [11, 12, 13, 14] as const;

type CadenceRow = {
    id: string;
    template_id: string;
    template_name: string;
    client_ids: string[];
    dynamic_values: Record<string, string> | null;
    template_sender: string;
    filters: Record<string, unknown> | null;
    messages_per_day: number;
    next_index: number;
    sent_count: number;
    failed_count: number;
    status: "scheduled" | "running" | "completed" | "failed";
    last_slot_key: string | null;
    created_by: string | null;
    created_by_name: string | null;
    started_at: string | null;
};

export async function GET() {
    const slot = getCurrentCadenceSlot();

    if (!slot) {
        return NextResponse.json({
            ok: true,
            skipped: true,
            reason: "outside_cadence_window",
        });
    }

    const { data, error } = await supabase
        .from("active_message_cadences")
        .select(
            "id, template_id, template_name, client_ids, dynamic_values, template_sender, filters, messages_per_day, next_index, sent_count, failed_count, status, last_slot_key, created_by, created_by_name, started_at",
        )
        .in("status", ["scheduled", "running"])
        .order("created_at", { ascending: true });

    if (error) {
        console.error("[mensagem-ativa-cadence] load failed", error);
        return NextResponse.json(
            { ok: false, error: "Não foi possível carregar os envios cadenciados" },
            { status: 500 },
        );
    }

    const results = [];

    for (const cadence of (data ?? []) as CadenceRow[]) {
        results.push(await processCadenceSlot(cadence, slot));
    }

    return NextResponse.json({
        ok: results.every((result) => result.ok),
        slot: slot.key,
        results,
    });
}

async function processCadenceSlot(
    cadence: CadenceRow,
    slot: { key: string; index: number },
) {
    const total = cadence.client_ids.length;

    if (cadence.next_index >= total) {
        await markCompleted(cadence.id);
        return { ok: true, cadence_id: cadence.id, skipped: true, reason: "completed" };
    }

    if (cadence.last_slot_key === slot.key) {
        return { ok: true, cadence_id: cadence.id, skipped: true, reason: "already_processed" };
    }

    const quota = getSlotQuota(cadence.messages_per_day, slot.index);

    if (quota <= 0) {
        return { ok: true, cadence_id: cadence.id, skipped: true, reason: "zero_quota" };
    }

    const claimQuery = supabase
        .from("active_message_cadences")
        .update({
            last_slot_key: slot.key,
            status: "running",
            started_at: cadence.started_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("id", cadence.id);

    const { data: claimed, error: claimError } = cadence.last_slot_key
        ? await claimQuery
              .eq("last_slot_key", cadence.last_slot_key)
              .select("id")
              .maybeSingle()
        : await claimQuery
              .is("last_slot_key", null)
              .select("id")
              .maybeSingle();

    if (claimError) {
        console.error("[mensagem-ativa-cadence] claim failed", {
            cadence_id: cadence.id,
            error: claimError,
        });
        return { ok: false, cadence_id: cadence.id, error: claimError.message };
    }

    if (!claimed) {
        return { ok: true, cadence_id: cadence.id, skipped: true, reason: "already_claimed" };
    }

    const chunk = cadence.client_ids.slice(
        cadence.next_index,
        cadence.next_index + quota,
    );

    if (chunk.length === 0) {
        await markCompleted(cadence.id);
        return { ok: true, cadence_id: cadence.id, skipped: true, reason: "completed" };
    }

    const template = getActiveMessageTemplate(cadence.template_id);
    const templateSender =
        parseActiveMessageTemplateSender(cadence.template_sender) ??
        DEFAULT_ACTIVE_MESSAGE_TEMPLATE_SENDER;

    if (!template) {
        await supabase
            .from("active_message_cadences")
            .update({
                status: "failed",
                updated_at: new Date().toISOString(),
            })
            .eq("id", cadence.id);

        return {
            ok: false,
            cadence_id: cadence.id,
            error: `Template não encontrado: ${cadence.template_id}`,
        };
    }

    try {
        const result = await sendActiveMessageBatch({
            template,
            clientIds: chunk,
            filters: {
                ...(cadence.filters ?? {}),
                cadence_id: cadence.id,
                cadence_slot: slot.key,
                cadence_messages_per_day: cadence.messages_per_day,
            },
            dynamicValues: cadence.dynamic_values ?? {},
            templateSender,
            actor: {
                id: cadence.created_by,
                name: cadence.created_by_name ?? "Envio cadenciado",
            },
        });

        const nextIndex = cadence.next_index + chunk.length;
        const completed = nextIndex >= total;
        const now = new Date().toISOString();

        const { error: updateError } = await supabase
            .from("active_message_cadences")
            .update({
                next_index: nextIndex,
                sent_count: cadence.sent_count + result.sent_count,
                failed_count: cadence.failed_count + result.failed_count,
                status: completed ? "completed" : "running",
                completed_at: completed ? now : null,
                updated_at: now,
            })
            .eq("id", cadence.id);

        if (updateError) throw updateError;

        return {
            ok: result.failed_count === 0,
            cadence_id: cadence.id,
            batch_id: result.batch_id,
            attempted_count: chunk.length,
            sent_count: result.sent_count,
            failed_count: result.failed_count,
            remaining_count: Math.max(0, total - nextIndex),
            completed,
        };
    } catch (error) {
        console.error("[mensagem-ativa-cadence] send failed", {
            cadence_id: cadence.id,
            slot: slot.key,
            error,
        });

        await supabase
            .from("active_message_cadences")
            .update({
                status: "failed",
                updated_at: new Date().toISOString(),
            })
            .eq("id", cadence.id);

        return {
            ok: false,
            cadence_id: cadence.id,
            batch_id:
                error instanceof ActiveMessageBatchError
                    ? error.batchId
                    : null,
            error:
                error instanceof Error
                    ? error.message
                    : "Falha inesperada no envio cadenciado",
        };
    }
}

async function markCompleted(cadenceId: string) {
    const now = new Date().toISOString();
    await supabase
        .from("active_message_cadences")
        .update({
            status: "completed",
            completed_at: now,
            updated_at: now,
        })
        .eq("id", cadenceId);
}

function getSlotQuota(messagesPerDay: number, slotIndex: number) {
    const base = Math.floor(messagesPerDay / CADENCE_HOURS.length);
    const remainder = messagesPerDay % CADENCE_HOURS.length;

    return base + (slotIndex < remainder ? 1 : 0);
}

function getCurrentCadenceSlot(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: SAO_PAULO_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);

    const value = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? "";

    const hour = Number(value("hour"));
    const index = CADENCE_HOURS.indexOf(
        hour as (typeof CADENCE_HOURS)[number],
    );

    if (index < 0) return null;

    return {
        index,
        key: `${value("year")}-${value("month")}-${value("day")}:${String(hour).padStart(2, "0")}`,
    };
}
