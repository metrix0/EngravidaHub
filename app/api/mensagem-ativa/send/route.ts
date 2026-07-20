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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SendBody = {
    template_id?: unknown;
    client_ids?: unknown;
    filters?: unknown;
    dynamic_values?: unknown;
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

    if (clientIds.length > MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND) {
        return NextResponse.json(
            {
                error: `Cada envio aceita até ${MAX_ACTIVE_MESSAGE_CLIENTS_PER_SEND} clientes. Divida a seleção em mais de um envio.`,
            },
            { status: 400 },
        );
    }

    try {
        const result = await sendActiveMessageBatch({
            template,
            clientIds,
            filters: isRecord(body.filters) ? body.filters : {},
            dynamicValues: dynamicValuesResult.values,
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
