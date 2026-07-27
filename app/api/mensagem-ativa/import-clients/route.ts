// app/api/mensagem-ativa/import-clients/route.ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { requireActiveMessageAccess } from "@/lib/active-messages/access";
import { normalizePhoneIdentity } from "@/lib/clients/phoneIdentity";
import { supabase } from "@/lib/supabase/client";
import { resolveClosestUnitIdFromPhone } from "@/lib/units/resolveClosestUnitFromPhone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_CLIENTS_PER_IMPORT = 500;
const QUERY_BATCH_SIZE = 100;
const CREATE_CONCURRENCY = 8;

type ImportBody = {
    clients?: unknown;
};

type ImportedClientInput = {
    name: string | null;
    email: string | null;
    phone: string;
    phoneIdentity: string;
};

type ExistingClientRow = {
    id: string;
    phone: string | null;
    phone_identity: string | null;
};

type CreatedClientResult = {
    id: string;
    created: boolean;
};

export async function POST(request: Request) {
    const access = await requireActiveMessageAccess();

    if (access.ok === false) {
        return NextResponse.json(
            { error: access.error },
            { status: access.status },
        );
    }

    let body: ImportBody;

    try {
        body = (await request.json()) as ImportBody;
    } catch {
        return NextResponse.json(
            { error: "O corpo da requisição não é um JSON válido" },
            { status: 400 },
        );
    }

    const inputs = normalizeImportedClients(body.clients);

    if (inputs.length === 0) {
        return NextResponse.json(
            { error: "Nenhum novo cliente com telefone válido foi informado" },
            { status: 400 },
        );
    }

    if (inputs.length > MAX_CLIENTS_PER_IMPORT) {
        return NextResponse.json(
            {
                error: `Cada importação aceita até ${MAX_CLIENTS_PER_IMPORT} novos clientes.`,
            },
            { status: 400 },
        );
    }

    try {
        const existingByPhone = await findExistingClients(inputs);
        const resultsByPhone = new Map<string, CreatedClientResult>();
        const missingInputs: ImportedClientInput[] = [];

        for (const input of inputs) {
            const existing = existingByPhone.get(input.phoneIdentity);

            if (existing) {
                resultsByPhone.set(input.phoneIdentity, {
                    id: existing.id,
                    created: false,
                });
            } else {
                missingInputs.push(input);
            }
        }

        const createdResults = await mapWithConcurrency(
            missingInputs,
            CREATE_CONCURRENCY,
            createImportedClient,
        );

        for (let index = 0; index < missingInputs.length; index += 1) {
            const input = missingInputs[index];
            const result = createdResults[index];
            if (input && result) {
                resultsByPhone.set(input.phoneIdentity, result);
            }
        }

        const orderedResults = inputs.flatMap((input) => {
            const result = resultsByPhone.get(input.phoneIdentity);
            return result ? [result] : [];
        });

        return NextResponse.json({
            ok: true,
            requested_count: inputs.length,
            created_count: orderedResults.filter((item) => item.created).length,
            existing_count: orderedResults.filter((item) => !item.created).length,
            client_ids: orderedResults.map((item) => item.id),
        });
    } catch (error) {
        console.error("[mensagem-ativa] failed to create imported clients", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Não foi possível criar os novos clientes",
            },
            { status: 500 },
        );
    }
}

function normalizeImportedClients(value: unknown) {
    if (!Array.isArray(value)) return [];

    const byPhone = new Map<string, ImportedClientInput>();

    for (const item of value) {
        if (!isRecord(item)) continue;

        const rawPhone = typeof item.phone === "string" ? item.phone : "";
        const phoneIdentity = normalizePhoneIdentity(rawPhone);
        if (!phoneIdentity || byPhone.has(phoneIdentity)) continue;

        byPhone.set(phoneIdentity, {
            name: normalizeOptionalText(item.name, 250),
            email: normalizeEmail(item.email),
            phone: phoneIdentity,
            phoneIdentity,
        });
    }

    return [...byPhone.values()];
}

async function findExistingClients(inputs: ImportedClientInput[]) {
    const result = new Map<string, ExistingClientRow>();
    const identities = inputs.map((input) => input.phoneIdentity);

    for (const batch of chunk(identities, QUERY_BATCH_SIZE)) {
        const query = await supabase
            .from("clients")
            .select("id, phone, phone_identity")
            .in("phone_identity", batch);

        if (query.error) throw query.error;

        for (const row of (query.data ?? []) as ExistingClientRow[]) {
            const identity =
                row.phone_identity ?? normalizePhoneIdentity(row.phone);
            if (identity) result.set(identity, row);
        }
    }

    const missingIdentities = identities.filter(
        (identity) => !result.has(identity),
    );
    const legacyPhoneValues = [
        ...new Set(
            missingIdentities.flatMap((identity) => phoneLookupVariants(identity)),
        ),
    ];

    for (const batch of chunk(legacyPhoneValues, QUERY_BATCH_SIZE)) {
        const query = await supabase
            .from("clients")
            .select("id, phone, phone_identity")
            .in("phone", batch);

        if (query.error) throw query.error;

        for (const row of (query.data ?? []) as ExistingClientRow[]) {
            const identity =
                row.phone_identity ?? normalizePhoneIdentity(row.phone);
            if (identity && missingIdentities.includes(identity)) {
                result.set(identity, row);
            }
        }
    }

    return result;
}

async function createImportedClient(
    input: ImportedClientInput,
): Promise<CreatedClientResult> {
    const now = new Date().toISOString();
    const clientId = randomUUID();
    const externalContactId = `${input.phoneIdentity}@wa.gw.msging.net`;
    const unitId = await resolveClosestUnitIdFromPhone(input.phoneIdentity);

    const inserted = await supabase.from("clients").insert({
        id: clientId,
        name: input.name,
        phone: input.phone,
        phone_identity: input.phoneIdentity,
        email: input.email,
        external_contact_id: externalContactId,
        unit_id: unitId,
        first_seen_at: now,
        last_interaction_at: now,
        created_at: now,
        updated_at: now,
    });

    if (!inserted.error) {
        return { id: clientId, created: true };
    }

    if (inserted.error.code !== "23505") {
        throw inserted.error;
    }

    const winner = await findExistingClient(input.phoneIdentity);
    if (!winner) throw inserted.error;

    return { id: winner.id, created: false };
}

async function findExistingClient(phoneIdentity: string) {
    const externalContactId = `${phoneIdentity}@wa.gw.msging.net`;
    const external = await supabase
        .from("clients")
        .select("id, phone, phone_identity")
        .eq("external_contact_id", externalContactId)
        .maybeSingle();

    if (external.error) throw external.error;
    if (external.data) return external.data as ExistingClientRow;

    const canonical = await supabase
        .from("clients")
        .select("id, phone, phone_identity")
        .eq("phone_identity", phoneIdentity)
        .limit(1)
        .maybeSingle();

    if (canonical.error) throw canonical.error;
    if (canonical.data) return canonical.data as ExistingClientRow;

    const legacy = await supabase
        .from("clients")
        .select("id, phone, phone_identity")
        .in("phone", phoneLookupVariants(phoneIdentity))
        .limit(20);

    if (legacy.error) throw legacy.error;

    return (
        ((legacy.data ?? []) as ExistingClientRow[]).find(
            (row) => normalizePhoneIdentity(row.phone) === phoneIdentity,
        ) ?? null
    );
}

function phoneLookupVariants(phoneIdentity: string) {
    const local = phoneIdentity.startsWith("55")
        ? phoneIdentity.slice(2)
        : phoneIdentity;

    return [
        phoneIdentity,
        `+${phoneIdentity}`,
        local,
        `+${local}`,
    ];
}

function normalizeOptionalText(value: unknown, maxLength: number) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeEmail(value: unknown) {
    const email = normalizeOptionalText(value, 320);
    return email?.toLocaleLowerCase("pt-BR") ?? null;
}

function chunk<T>(values: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }

    return chunks;
}

async function mapWithConcurrency<T, TResult>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<TResult>,
) {
    const results = new Array<TResult>(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) return;
            results[index] = await mapper(items[index]);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, items.length) },
            () => worker(),
        ),
    );

    return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
