// lib/invoices/getBigqueryInvoices.ts
import { BigQuery } from "@google-cloud/bigquery";

const BIGQUERY_DATASET = "datastudio";
const INVOICES_TABLE = "view_faturas_nfs";
const PATIENTS_TABLE = "view_pacientes";
const BIGQUERY_LOCATION = "southamerica-east1";
const PREFILTER_OVERLAP_DAYS = 2;

type BigQueryRow = Record<string, unknown>;

export type BigqueryInvoice = {
    source_invoice_id: number;
    issued_at: string;
    amount: number;
    description: string;
    status: string;
    unit_name: string | null;
    doctor_name: string | null;
    patient_code: number | null;
    patient_phone: string | null;
    nfe_number: number | null;
};

export async function getBigqueryInvoices({
    daysBack,
    limit,
}: {
    daysBack: number;
    limit: number;
}) {
    const credentials = getGoogleCredentials();
    const bigquery = new BigQuery({
        projectId: credentials.project_id,
        credentials,
    });
    const cutoff = startOfSaoPauloDay(daysBack);
    const prefilterCutoff = new Date(
        cutoff - PREFILTER_OVERLAP_DAYS * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const [rawInvoiceRows] = await bigquery.query({
        query: buildInvoiceQuery(credentials.project_id),
        location: BIGQUERY_LOCATION,
        params: { prefilterCutoff },
    });
    const invoiceRows = rawInvoiceRows as BigQueryRow[];
    const latestInvoices = consolidateLatestInvoiceRows(invoiceRows);
    const patientCodes = collectPatientCodes([...latestInvoices.values()]);
    const patientRows = await loadPatientRows(
        bigquery,
        credentials.project_id,
        patientCodes,
    );
    const patientsByCode = buildPatientsByCode(patientRows);

    const invoices = [...latestInvoices.values()]
        .map((row) => normalizeInvoice(row, patientsByCode))
        .filter((invoice): invoice is BigqueryInvoice => Boolean(invoice))
        .filter((invoice) => new Date(invoice.issued_at).getTime() >= cutoff)
        .sort((first, second) =>
            second.issued_at.localeCompare(first.issued_at),
        )
        .slice(0, limit);

    console.log("[getBigqueryInvoices] filtered BigQuery rows loaded", {
        invoice_rows: invoiceRows.length,
        patient_rows: patientRows.length,
        patient_codes: patientCodes.length,
        consolidated_invoices: latestInvoices.size,
        selected_invoices: invoices.length,
        days_back: daysBack,
        limit,
        prefilter_overlap_days: PREFILTER_OVERLAP_DAYS,
    });

    return invoices;
}

function buildInvoiceQuery(projectId: string) {
    const invoicesTable = qualifiedTableName(
        projectId,
        BIGQUERY_DATASET,
        INVOICES_TABLE,
    );

    return `
        WITH invoice_candidates AS (
            SELECT
                source.id_fatura,
                source.data_emissao,
                source.valor,
                source.descricao,
                source.status,
                source.centro_custos,
                source.medico,
                source.pacientes_codigo,
                source.paciente_cpf,
                source.paciente_nome,
                source.nfe_numero,
                SAFE_CAST(
                    CAST(source.data_emissao AS STRING) AS TIMESTAMP
                ) AS engravida_issued_at
            FROM ${invoicesTable} AS source
        )

        SELECT * EXCEPT (engravida_issued_at)
        FROM invoice_candidates
        WHERE engravida_issued_at IS NULL
           OR engravida_issued_at >= TIMESTAMP(@prefilterCutoff)
    `;
}

async function loadPatientRows(
    bigquery: BigQuery,
    projectId: string,
    patientCodes: number[],
) {
    if (patientCodes.length === 0) return [];

    const patientsTable = qualifiedTableName(
        projectId,
        BIGQUERY_DATASET,
        PATIENTS_TABLE,
    );
    const query = `
        SELECT
            source.codigo,
            source.inativo,
            source.esposa_cpf,
            source.marido_cpf,
            source.esposa_nome,
            source.esposa_nome_social,
            source.marido_nome,
            source.marido_nome_social,
            source.esposa_celular,
            source.marido_celular,
            source.telefone
        FROM ${patientsTable} AS source
        WHERE SAFE_CAST(
            TRUNC(
                SAFE_CAST(CAST(source.codigo AS STRING) AS FLOAT64)
            ) AS INT64
        ) IN UNNEST(@patientCodes)
    `;
    const [rows] = await bigquery.query({
        query,
        location: BIGQUERY_LOCATION,
        params: { patientCodes },
    });

    return rows as BigQueryRow[];
}

function collectPatientCodes(rows: BigQueryRow[]) {
    return [
        ...new Set(
            rows.flatMap((row) => {
                const patientCode = integerValue(row.pacientes_codigo);
                return patientCode === null ? [] : [patientCode];
            }),
        ),
    ];
}

function qualifiedTableName(
    projectId: string,
    dataset: string,
    table: string,
) {
    if (!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(projectId)) {
        throw new Error("Invalid Google Cloud project ID");
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dataset)) {
        throw new Error("Invalid BigQuery dataset name");
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        throw new Error("Invalid BigQuery table name");
    }

    return `\`${projectId}.${dataset}.${table}\``;
}

function buildPatientsByCode(rows: BigQueryRow[]) {
    const patients = new Map<number, BigQueryRow>();

    for (const row of rows) {
        const code = integerValue(row.codigo);
        if (code === null) continue;

        const current = patients.get(code);
        if (!current || isActivePatient(row)) {
            patients.set(code, row);
        }
    }

    return patients;
}

function consolidateLatestInvoiceRows(rows: BigQueryRow[]) {
    const invoices = new Map<number, BigQueryRow>();

    for (const row of rows) {
        const sourceInvoiceId = integerValue(row.id_fatura);
        if (sourceInvoiceId === null) continue;

        const current = invoices.get(sourceInvoiceId);
        if (!current || compareInvoiceVersions(row, current) >= 0) {
            invoices.set(sourceInvoiceId, row);
        }
    }

    return invoices;
}

function compareInvoiceVersions(first: BigQueryRow, second: BigQueryRow) {
    const issuedAtDifference =
        timestampValue(first.data_emissao) - timestampValue(second.data_emissao);
    if (issuedAtDifference !== 0) return issuedAtDifference;

    return (
        (integerValue(first.nfe_numero) ?? 0) -
        (integerValue(second.nfe_numero) ?? 0)
    );
}

function normalizeInvoice(
    row: BigQueryRow,
    patientsByCode: Map<number, BigQueryRow>,
): BigqueryInvoice | null {
    const sourceInvoiceId = integerValue(row.id_fatura);
    const issuedAt = isoTimestamp(row.data_emissao);
    const amount = moneyValue(row.valor);

    if (sourceInvoiceId === null || !issuedAt || amount === null) {
        return null;
    }

    const patientCode = integerValue(row.pacientes_codigo);
    const patient = patientCode === null
        ? null
        : patientsByCode.get(patientCode) ?? null;

    return {
        source_invoice_id: sourceInvoiceId,
        issued_at: issuedAt,
        amount,
        description: cleanText(row.descricao) ?? "Sem descrição",
        status: cleanText(row.status) ?? "Não informado",
        unit_name: unitName(integerValue(row.centro_custos)),
        doctor_name: cleanText(row.medico),
        patient_code: patientCode,
        patient_phone: resolvePatientPhone(row, patient),
        nfe_number: positiveInteger(row.nfe_numero),
    };
}

function resolvePatientPhone(
    invoice: BigQueryRow,
    patient: BigQueryRow | null,
) {
    if (!patient) return null;

    const invoiceCpf = digits(invoice.paciente_cpf);
    const wifeCpf = digits(patient.esposa_cpf);
    const husbandCpf = digits(patient.marido_cpf);

    if (invoiceCpf && invoiceCpf === wifeCpf) {
        return cleanText(patient.esposa_celular);
    }
    if (invoiceCpf && invoiceCpf === husbandCpf) {
        return cleanText(patient.marido_celular);
    }

    const invoiceName = normalizedText(invoice.paciente_nome);
    if (
        invoiceName &&
        [patient.esposa_nome, patient.esposa_nome_social]
            .map(normalizedText)
            .includes(invoiceName)
    ) {
        return cleanText(patient.esposa_celular);
    }
    if (
        invoiceName &&
        [patient.marido_nome, patient.marido_nome_social]
            .map(normalizedText)
            .includes(invoiceName)
    ) {
        return cleanText(patient.marido_celular);
    }

    return (
        cleanText(patient.esposa_celular) ??
        cleanText(patient.marido_celular) ??
        cleanText(patient.telefone)
    );
}

function unitName(code: number | null) {
    const units: Record<number, string> = {
        1: "Brasília",
        2: "Rio de Janeiro",
        3: "Recife",
        4: "São Paulo",
        5: "Salvador",
        6: "Campinas",
        7: "Manaus",
        9: "Juiz de Fora",
        10: "Bauru",
        11: "Vitória",
        12: "Belo Horizonte",
    };

    if (code === null) return null;
    return units[code] ?? String(code);
}

function isActivePatient(row: BigQueryRow) {
    const value = integerValue(row.inativo);
    return value === null || value === 0;
}

function startOfSaoPauloDay(daysBack: number) {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    const todayStart = new Date(`${today}T00:00:00-03:00`).getTime();
    return todayStart - Math.max(1, daysBack) * 24 * 60 * 60 * 1000;
}

function isoTimestamp(value: unknown) {
    const raw = textValue(value);
    if (!raw) return null;

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function timestampValue(value: unknown) {
    const iso = isoTimestamp(value);
    return iso ? new Date(iso).getTime() : 0;
}

function moneyValue(value: unknown) {
    const raw = textValue(value);
    if (!raw) return null;

    const cleaned = raw.replace(/[^0-9,.-]/g, "");
    const normalized = cleaned.includes(",")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned;
    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown) {
    const parsed = integerValue(value);
    return parsed && parsed > 0 ? parsed : null;
}

function integerValue(value: unknown) {
    const raw = textValue(value);
    if (!raw) return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function cleanText(value: unknown) {
    const raw = textValue(value);
    return raw?.replace(/\s+/g, " ").trim() || null;
}

function textValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    if (typeof value === "object" && "value" in value) {
        return textValue((value as { value: unknown }).value);
    }

    const text = String(value).trim();
    return text || null;
}

function digits(value: unknown) {
    const raw = textValue(value);
    if (!raw) return null;
    return raw.replace(/\D/g, "") || null;
}

function normalizedText(value: unknown) {
    return (textValue(value) ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/\s+/g, " ")
        .trim();
}

function getGoogleCredentials() {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!raw) {
        throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
    }

    return JSON.parse(raw) as {
        project_id: string;
        client_email: string;
        private_key: string;
    };
}
