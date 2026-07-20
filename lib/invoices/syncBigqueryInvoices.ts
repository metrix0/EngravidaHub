// lib/invoices/syncBigqueryInvoices.ts
import { supabase } from "@/lib";
import { normalizePhoneIdentity } from "@/lib/clients/phoneIdentity";
import { classifyInvoiceDescription } from "@/lib/invoices/categories";
import {
    getBigqueryInvoices,
    type BigqueryInvoice,
} from "@/lib/invoices/getBigqueryInvoices";
import {
    findDoctorBySourceName,
    type DoctorReference,
} from "@/lib/invoices/matchDoctor";

const PAGE_SIZE = 1_000;
const UPSERT_BATCH_SIZE = 500;

type ClientPhoneRow = {
    id: string;
    phone: string | null;
    phone_identity: string | null;
    updated_at: string;
};

type UnitRow = {
    id: string;
    name: string;
};

export async function syncBigqueryInvoices({
    daysBack = 1,
    limit = 25_000,
}: {
    daysBack?: number;
    limit?: number;
} = {}) {
    const startedAt = Date.now();
    const [invoices, clients, units, doctors] = await Promise.all([
        getBigqueryInvoices({ daysBack, limit }),
        loadClients(),
        loadUnits(),
        loadDoctors(),
    ]);

    const clientsByPhone = buildClientsByPhone(clients);
    const unitsByName = new Map(
        units.map((unit) => [normalizeText(unit.name), unit]),
    );
    const syncedAt = new Date().toISOString();
    let linkedClients = 0;
    let linkedUnits = 0;
    let linkedDoctors = 0;

    const rows = invoices.map((invoice) => {
        const clientId = findClientId(invoice, clientsByPhone);
        const unitId = invoice.unit_name
            ? unitsByName.get(normalizeText(invoice.unit_name))?.id ?? null
            : null;
        const doctorId = findDoctorBySourceName(
            invoice.doctor_name,
            doctors,
        )?.id ?? null;

        if (clientId) linkedClients += 1;
        if (unitId) linkedUnits += 1;
        if (doctorId) linkedDoctors += 1;

        return {
            source_invoice_id: invoice.source_invoice_id,
            issued_at: invoice.issued_at,
            amount: invoice.amount,
            description: invoice.description,
            category: classifyInvoiceDescription(invoice.description),
            status: invoice.status,
            unit_id: unitId,
            unit_name: invoice.unit_name,
            doctor_id: doctorId,
            doctor_name: invoice.doctor_name,
            patient_code: invoice.patient_code,
            client_id: clientId,
            nfe_number: invoice.nfe_number,
            updated_at: syncedAt,
        };
    });

    let upserted = 0;

    for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
        const { error } = await supabase
            .from("clinisys_invoices")
            .upsert(batch, { onConflict: "source_invoice_id" });

        if (error) throw error;
        upserted += batch.length;
    }

    const result = {
        ok: true,
        fetched: invoices.length,
        upserted,
        linked_clients: linkedClients,
        linked_units: linkedUnits,
        linked_doctors: linkedDoctors,
        unlinked_clients: rows.length - linkedClients,
        unlinked_doctors: rows.length - linkedDoctors,
        days_back: daysBack,
        limit,
        duration_ms: Date.now() - startedAt,
    };

    console.log("[syncBigqueryInvoices] sync completed", result);
    return result;
}

async function loadClients() {
    const rows: ClientPhoneRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("clients")
            .select("id, phone, phone_identity, updated_at")
            .order("updated_at", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;

        const page = (data ?? []) as ClientPhoneRow[];
        rows.push(...page);

        if (page.length < PAGE_SIZE) break;
    }

    return rows;
}

async function loadUnits() {
    const { data, error } = await supabase
        .from("units")
        .select("id, name")
        .eq("active", true);

    if (error) throw error;
    return (data ?? []) as UnitRow[];
}

async function loadDoctors() {
    const { data, error } = await supabase
        .from("doctors")
        .select("id, name")
        .eq("active", true);

    if (error) throw error;
    return (data ?? []) as DoctorReference[];
}

function buildClientsByPhone(clients: ClientPhoneRow[]) {
    const map = new Map<string, string>();

    for (const client of clients) {
        const identities = [
            normalizePhoneIdentity(client.phone_identity),
            normalizePhoneIdentity(client.phone),
        ].filter((value): value is string => Boolean(value));

        for (const identity of identities) {
            if (!map.has(identity)) map.set(identity, client.id);
        }
    }

    return map;
}

function findClientId(
    invoice: BigqueryInvoice,
    clientsByPhone: Map<string, string>,
) {
    const phoneIdentity = normalizePhoneIdentity(invoice.patient_phone);
    return phoneIdentity ? clientsByPhone.get(phoneIdentity) ?? null : null;
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}
