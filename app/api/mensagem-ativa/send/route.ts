// app/api/mensagem-ativa/send/route.ts
import { NextResponse } from "next/server";

import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import {
    ActiveMessageBatchError,
    MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND,
    sendActiveMessageBatch,
} from "@/lib/active-messages/sendActiveMessageBatch";
import {
    getActiveMessageDynamicFields,
    getActiveMessageTemplate,
} from "@/lib/active-messages/templates";
import {
    DEFAULT_ACTIVE_MESSAGE_TEMPLATE_SENDER,
    parseActiveMessageTemplateSender,
} from "@/lib/active-messages/templateSenders";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SendBody = {
    template_id?: unknown;
    client_ids?: unknown;
    filters?: unknown;
    dynamic_values?: unknown;
    template_sender?: unknown;
    delivery_mode?: unknown;
    messages_per_day?: unknown;
};

export async function POST(request: Request) {
    const access = await requireActiveMessageAccess();

    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    let body: SendBody;

    try {
        body = (await request.json()) as SendBody;
    } catch {
        return NextResponse.json(
            { error: "O corpo da requisição não é um JSON válido" },
            { status: 400 },
        );
    }

    const templateId =
        typeof body.template_id === "string" ? body.template_id.trim() : "";
    const template = getActiveMessageTemplate(templateId);

    if (!template) {
        return NextResponse.json(
            { error: "Selecione um template válido" },
            { status: 400 },
        );
    }

    const templateSender =
        body.template_sender === undefined
            ? DEFAULT_ACTIVE_MESSAGE_TEMPLATE_SENDER
            : parseActiveMessageTemplateSender(body.template_sender);

    if (!templateSender) {
        return NextResponse.json(
            { error: "Selecione um número de envio válido" },
            { status: 400 },
        );
    }

    const dynamicValuesResult = resolveDynamicValues({
        template,
        value: body.dynamic_values,
    });

    if (dynamicValuesResult.ok === false) {
        return NextResponse.json(
            { error: dynamicValuesResult.error },
            { status: 400 },
        );
    }

    const clientIds = normalizeClientIds(body.client_ids);

    if (clientIds.length === 0) {
        return NextResponse.json(
            { error: "Selecione pelo menos um cliente" },
            { status: 400 },
        );
    }

    const deliveryMode =
        body.delivery_mode === "cadenced" ? "cadenced" : "immediate";

    if (
        deliveryMode === "immediate" &&
        clientIds.length > MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND
    ) {
        return NextResponse.json(
            {
                error: `Envios imediatos aceitam até ${MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND} clientes. Use o envio cadenciado para listas maiores.`,
            },
            { status: 400 },
        );
    }

    if (deliveryMode === "cadenced") {
        const messagesPerDay =
            typeof body.messages_per_day === "number"
                ? body.messages_per_day
                : Number(body.messages_per_day);

        if (
            !Number.isInteger(messagesPerDay) ||
            messagesPerDay < 1 ||
            messagesPerDay > MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND
        ) {
            return NextResponse.json(
                {
                    error: `Informe um limite diário entre 1 e ${MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND} mensagens.`,
                },
                { status: 400 },
            );
        }

        const { data: cadence, error: cadenceError } = await supabase
            .from("active_message_cadences")
            .insert({
                template_id: template.id,
                template_name: template.name,
                client_ids: clientIds,
                dynamic_values: dynamicValuesResult.values,
                template_sender: templateSender,
                filters: {
                    ...(isRecord(body.filters) ? body.filters : {}),
                    cadence_label: buildCadenceLabel({
                        total: clientIds.length,
                        messagesPerDay,
                        templateName: template.name,
                    }),
                },
                messages_per_day: messagesPerDay,
                created_by: access.actor.id,
                created_by_name: access.actor.name,
            })
            .select("id")
            .single();

        if (cadenceError || !cadence) {
            console.error(
                "[mensagem-ativa] failed to create cadence",
                cadenceError,
            );
            return NextResponse.json(
                { error: "Não foi possível agendar o envio cadenciado" },
                { status: 500 },
            );
        }

        return NextResponse.json({
            ok: true,
            cadence_id: cadence.id,
            status: "scheduled",
            requested_count: clientIds.length,
            messages_per_day: messagesPerDay,
        });
    }

    try {
        const result = await sendActiveMessageBatch({
            template,
            clientIds,
            filters: isRecord(body.filters) ? body.filters : {},
            dynamicValues: dynamicValuesResult.values,
            templateSender,
            actor: {
                id: access.actor.id,
                name: access.actor.name,
            },
        });

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível concluir o envio",
                batch_id:
                    error instanceof ActiveMessageBatchError
                        ? error.batchId
                        : null,
            },
            { status: 500 },
        );
    }
}

function resolveDynamicValues({
    template,
    value,
}: {
    template: NonNullable<ReturnType<typeof getActiveMessageTemplate>>;
    value: unknown;
}):
    | { ok: true; values: Record<string, string> }
    | { ok: false; error: string } {
    const input = isRecord(value) ? value : {};
    const values: Record<string, string> = {};

    for (const field of getActiveMessageDynamicFields(template)) {
        const rawValue = input[field.field_id];
        const resolvedValue =
            (typeof rawValue === "string" ? rawValue.trim() : "") ||
            field.default_value?.trim() ||
            "";

        if (field.required && !resolvedValue) {
            return {
                ok: false,
                error: `Preencha o campo “${field.label}”.`,
            };
        }

        if (resolvedValue.length > 500) {
            return {
                ok: false,
                error: `O campo “${field.label}” deve ter no máximo 500 caracteres.`,
            };
        }

        values[field.field_id] = resolvedValue;
    }

    return { ok: true, values };
}

function buildCadenceLabel({
    total,
    messagesPerDay,
    templateName,
}: {
    total: number;
    messagesPerDay: number;
    templateName: string;
}) {
    const totalLabel =
        total >= 1_000
            ? `${new Intl.NumberFormat("pt-BR", {
                  maximumFractionDigits: 1,
              }).format(total / 1_000)}k`
            : total.toLocaleString("pt-BR");

    return `(${totalLabel} ${messagesPerDay}/dia) ${templateName}`;
}

function normalizeClientIds(value: unknown) {
    if (!Array.isArray(value)) return [];

    return [
        ...new Set(
            value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
