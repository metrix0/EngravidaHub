// scripts/backfill-tintim-attribution.ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
    createClient,
    type SupabaseClient,
} from "@supabase/supabase-js";

import {
    buildTintimAttributionEvent,
    isTrackedTintimSource,
    type TintimPayload,
} from "../lib/tintim/attribution";

const PAGE_SIZE = 1_000;
const CLIENT_FILTER_BATCH_SIZE = 200;
const CONVERSATION_FILTER_BATCH_SIZE = 100;
const FINGERPRINT_FILTER_BATCH_SIZE = 100;
const INSERT_BATCH_SIZE = 500;
const DEFAULT_MAX_DISTANCE_HOURS = 48;

type CsvColumns = {
    phone: number;
    occurredAt: number;
    source: number;
    gclid: number | null;
    gbraid: number | null;
    wbraid: number | null;
    fbclid: number | null;
    fbc: number | null;
    ctwaClid: number | null;
    utmSource: number | null;
    utmMedium: number | null;
};

type ParsedTintimRow = {
    line: number;
    phone: string;
    occurredAt: string;
    source: string | null;
    tracking: Pick<
        TintimPayload,
        | "gclid"
        | "gbraid"
        | "wbraid"
        | "fbclid"
        | "fbc"
        | "ctwa_clid"
        | "utm_source"
        | "utm_medium"
    >;
};

type ClientRow = {
    id: string;
    phone: string | null;
};

type ConversationRow = {
    id: string;
    client_id: string;
    started_at: string;
};

type AttributionInsert = ReturnType<typeof buildTintimAttributionEvent>;

type RejectionReason =
    | "invalid_phone"
    | "invalid_date"
    | "client_not_found"
    | "duplicate_clients"
    | "conversation_not_found"
    | "multiple_conversations"
    | "duplicate_csv_event";

type Rejection = {
    line: number;
    phone: string | null;
    reason: RejectionReason;
};

type ScriptOptions = {
    csvPath: string;
    apply: boolean;
    maxDistanceHours: number;
    phoneColumn: string | null;
    dateColumn: string | null;
    sourceColumn: string | null;
};

const PHONE_ALIASES = [
    "telefone",
    "telefone do lead",
    "phone",
    "phone e164",
    "celular",
    "whatsapp",
    "numero",
    "numero do telefone",
    "numero do whatsapp",
];

const DATE_ALIASES = [
    "data",
    "data hora",
    "data da conversa",
    "data de criacao",
    "data do contato",
    "inicio",
    "inicio da conversa",
    "criado em",
    "created at",
    "created isoformat",
    "created iso format",
];

const SOURCE_ALIASES = [
    "origem",
    "origem da conversa",
    "origem do lead",
    "source",
    "fonte",
    "canal",
];

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const csv = await readFile(resolve(options.csvPath), "utf8");
    const { delimiter, rows } = parseCsv(csv);

    if (rows.length < 2) {
        throw new Error("The CSV has no data rows.");
    }

    const headers = rows[0].map((value) => value.trim());
    const columns = resolveColumns(headers, options);
    const rejected: Rejection[] = [];
    const parsedRows: ParsedTintimRow[] = [];

    for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index];
        if (row.every((value) => value.trim() === "")) continue;

        const line = index + 1;
        const phone = normalizeBrazilPhone(row[columns.phone] ?? "");
        if (!phone) {
            rejected.push({ line, phone: null, reason: "invalid_phone" });
            continue;
        }

        const occurredAt = parseTintimDate(
            row[columns.occurredAt] ?? "",
        );
        if (!occurredAt) {
            rejected.push({ line, phone, reason: "invalid_date" });
            continue;
        }

        parsedRows.push({
            line,
            phone,
            occurredAt,
            source: nullableText(row[columns.source]),
            tracking: {
                gclid: valueAt(row, columns.gclid),
                gbraid: valueAt(row, columns.gbraid),
                wbraid: valueAt(row, columns.wbraid),
                fbclid: valueAt(row, columns.fbclid),
                fbc: valueAt(row, columns.fbc),
                ctwa_clid: valueAt(row, columns.ctwaClid),
                utm_source: valueAt(row, columns.utmSource),
                utm_medium: valueAt(row, columns.utmMedium),
            },
        });
    }

    if (parsedRows.length === 0) {
        printInputSummary({
            csvPath: options.csvPath,
            delimiter,
            headers,
            totalRows: rows.length - 1,
            parsedRows: 0,
        });
        printRejections(rejected);
        throw new Error("No valid phone/date rows were found.");
    }

    const supabase = createServiceClient();
    const clientsByPhone = await loadClientsByPhone(
        supabase,
        parsedRows.map((row) => row.phone),
    );
    const uniqueClientIds = new Set<string>();
    const rowsWithClient: Array<{
        row: ParsedTintimRow;
        client: ClientRow;
    }> = [];

    for (const row of parsedRows) {
        const clients = clientsByPhone.get(row.phone) ?? [];
        if (clients.length === 0) {
            rejected.push({
                line: row.line,
                phone: row.phone,
                reason: "client_not_found",
            });
            continue;
        }
        if (clients.length !== 1) {
            rejected.push({
                line: row.line,
                phone: row.phone,
                reason: "duplicate_clients",
            });
            continue;
        }

        const client = clients[0];
        uniqueClientIds.add(client.id);
        rowsWithClient.push({ row, client });
    }

    const maxDistanceMs =
        options.maxDistanceHours * 60 * 60 * 1_000;
    const minimumTimestamp = Math.min(
        ...parsedRows.map((row) => Date.parse(row.occurredAt)),
    );
    const maximumTimestamp = Math.max(
        ...parsedRows.map((row) => Date.parse(row.occurredAt)),
    );
    const conversationsByClient = await loadConversationsByClient(
        supabase,
        Array.from(uniqueClientIds),
        new Date(minimumTimestamp - maxDistanceMs).toISOString(),
        new Date(maximumTimestamp + maxDistanceMs).toISOString(),
    );
    const safeEvents = new Map<string, AttributionInsert>();

    for (const { row, client } of rowsWithClient) {
        const eventTime = Date.parse(row.occurredAt);
        const candidates = (
            conversationsByClient.get(client.id) ?? []
        ).filter((conversation) => {
            const conversationTime = Date.parse(conversation.started_at);
            return (
                Number.isFinite(conversationTime) &&
                Math.abs(conversationTime - eventTime) <= maxDistanceMs
            );
        });

        if (candidates.length === 0) {
            rejected.push({
                line: row.line,
                phone: row.phone,
                reason: "conversation_not_found",
            });
            continue;
        }
        if (candidates.length !== 1) {
            rejected.push({
                line: row.line,
                phone: row.phone,
                reason: "multiple_conversations",
            });
            continue;
        }

        const event = buildTintimAttributionEvent({
            clientId: client.id,
            phone: row.phone,
            payload: {
                event_type: "historical_csv_backfill",
                created_isoformat: row.occurredAt,
                source: row.source,
                ...row.tracking,
            },
        });

        if (safeEvents.has(event.event_fingerprint)) {
            rejected.push({
                line: row.line,
                phone: row.phone,
                reason: "duplicate_csv_event",
            });
            continue;
        }
        safeEvents.set(event.event_fingerprint, event);
    }

    const events = Array.from(safeEvents.values());
    printInputSummary({
        csvPath: options.csvPath,
        delimiter,
        headers,
        totalRows: rows.length - 1,
        parsedRows: parsedRows.length,
    });
    printAttributionSummary(events);
    printRejections(rejected);

    console.log(
        `\nSafe events: ${formatNumber(events.length)} ` +
            `(maximum distance ${options.maxDistanceHours}h; exactly one client and one conversation required)`,
    );

    if (!options.apply) {
        console.log(
            "\nDRY RUN ONLY — nothing was written. Re-run with --apply after reviewing these totals.",
        );
        return;
    }

    if (events.length === 0) {
        throw new Error("There are no safe events to insert.");
    }

    const fingerprints = events.map((event) => event.event_fingerprint);
    const existingBefore = await loadExistingFingerprints(
        supabase,
        fingerprints,
    );
    const eventsToInsert = events.filter(
        (event) => !existingBefore.has(event.event_fingerprint),
    );

    for (const batch of chunk(eventsToInsert, INSERT_BATCH_SIZE)) {
        const { error } = await supabase
            .from("tintim_attribution_events")
            .upsert(batch, {
                onConflict: "event_fingerprint",
                ignoreDuplicates: true,
            });

        if (error) {
            throw new Error(
                "Backfill insert failed. Run " +
                    "supabase-correct-tintim-conversation-attribution.sql " +
                    `first. Supabase: ${error.message}`,
            );
        }
    }

    const existingAfter = await loadExistingFingerprints(
        supabase,
        fingerprints,
    );
    const missingAfter = fingerprints.filter(
        (fingerprint) => !existingAfter.has(fingerprint),
    );
    if (missingAfter.length > 0) {
        throw new Error(
            `${missingAfter.length} events were not found after the insert.`,
        );
    }

    console.log(
        `\nAPPLIED — ${formatNumber(eventsToInsert.length)} new events inserted; ` +
            `${formatNumber(existingBefore.size)} already existed.`,
    );
}

function createServiceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
        throw new Error(
            "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
        );
    }

    return createClient(url, serviceRoleKey, {
        global: { fetch: supabaseServiceFetch },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        },
    });
}

async function loadClientsByPhone(
    supabase: SupabaseClient,
    normalizedPhones: string[],
) {
    const variants = Array.from(
        new Set(
            normalizedPhones.flatMap((phone) => [
                phone,
                `+${phone}`,
                stripBrazilPrefix(phone),
                `+${stripBrazilPrefix(phone)}`,
            ]),
        ),
    );
    const rows: ClientRow[] = [];

    for (const phoneBatch of chunk(variants, CLIENT_FILTER_BATCH_SIZE)) {
        for (let from = 0; ; from += PAGE_SIZE) {
            const { data, error } = await supabase
                .from("clients")
                .select("id, phone")
                .in("phone", phoneBatch)
                .order("id", { ascending: true })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                throw new Error(`Failed to load clients: ${error.message}`);
            }

            const page = (data ?? []) as ClientRow[];
            rows.push(...page);
            if (page.length < PAGE_SIZE) break;
        }
    }

    const byPhone = new Map<string, Map<string, ClientRow>>();
    for (const row of rows) {
        const phone = normalizeBrazilPhone(row.phone ?? "");
        if (!phone) continue;
        const clients = byPhone.get(phone) ?? new Map<string, ClientRow>();
        clients.set(row.id, row);
        byPhone.set(phone, clients);
    }

    return new Map(
        Array.from(byPhone.entries()).map(([phone, clients]) => [
            phone,
            Array.from(clients.values()),
        ]),
    );
}

async function loadConversationsByClient(
    supabase: SupabaseClient,
    clientIds: string[],
    startAt: string,
    endAt: string,
) {
    const rows: ConversationRow[] = [];

    for (const clientBatch of chunk(
        clientIds,
        CONVERSATION_FILTER_BATCH_SIZE,
    )) {
        for (let from = 0; ; from += PAGE_SIZE) {
            const { data, error } = await supabase
                .from("conversations")
                .select("id, client_id, started_at")
                .in("client_id", clientBatch)
                .gte("started_at", startAt)
                .lte("started_at", endAt)
                .order("started_at", { ascending: true })
                .order("id", { ascending: true })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                throw new Error(
                    `Failed to load conversations: ${error.message}`,
                );
            }

            const page = (data ?? []) as ConversationRow[];
            rows.push(...page);
            if (page.length < PAGE_SIZE) break;
        }
    }

    const byClient = new Map<string, ConversationRow[]>();
    for (const row of rows) {
        const conversations = byClient.get(row.client_id) ?? [];
        conversations.push(row);
        byClient.set(row.client_id, conversations);
    }
    return byClient;
}

async function loadExistingFingerprints(
    supabase: SupabaseClient,
    fingerprints: string[],
) {
    const existing = new Set<string>();

    for (const batch of chunk(fingerprints, FINGERPRINT_FILTER_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("tintim_attribution_events")
            .select("event_fingerprint")
            .in("event_fingerprint", batch);

        if (error) {
            throw new Error(
                `Failed to verify existing events: ${error.message}`,
            );
        }
        for (const row of data ?? []) {
            if (typeof row.event_fingerprint === "string") {
                existing.add(row.event_fingerprint);
            }
        }
    }
    return existing;
}

export function parseCsv(content: string) {
    const sanitized = content.replace(/^\uFEFF/, "");
    const candidates = [",", ";", "\t"].map((delimiter) => ({
        delimiter,
        rows: parseDelimited(sanitized, delimiter),
    }));
    const selected = candidates.sort(
        (left, right) =>
            (right.rows[0]?.length ?? 0) - (left.rows[0]?.length ?? 0),
    )[0];

    if (!selected || (selected.rows[0]?.length ?? 0) < 3) {
        throw new Error(
            "Could not detect the CSV delimiter or at least three columns.",
        );
    }
    return selected;
}

function parseDelimited(content: string, delimiter: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < content.length; index += 1) {
        const character = content[index];

        if (character === '"') {
            if (inQuotes && content[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (character === delimiter && !inQuotes) {
            row.push(field);
            field = "";
            continue;
        }

        if ((character === "\n" || character === "\r") && !inQuotes) {
            if (character === "\r" && content[index + 1] === "\n") {
                index += 1;
            }
            row.push(field);
            if (row.some((value) => value.trim() !== "")) rows.push(row);
            row = [];
            field = "";
            continue;
        }

        field += character;
    }

    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    return rows;
}

export function parseTintimDate(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{10}$/.test(trimmed)) {
        return validIso(Number(trimmed) * 1_000);
    }
    if (/^\d{13}$/.test(trimmed)) {
        return validIso(Number(trimmed));
    }

    const brazilian = trimmed.match(
        /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (brazilian) {
        const [, day, month, year, hour = "0", minute = "0", second = "0"] =
            brazilian;
        return saoPauloIso({ year, month, day, hour, minute, second });
    }

    const isoWithoutZone = trimmed.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/,
    );
    if (isoWithoutZone) {
        const [, year, month, day, hour = "0", minute = "0", second = "0"] =
            isoWithoutZone;
        return saoPauloIso({ year, month, day, hour, minute, second });
    }

    return validIso(Date.parse(trimmed));
}

export function normalizeBrazilPhone(value: string) {
    let digits = value.replace(/\D/g, "");
    if (!digits) return null;
    if (
        digits.startsWith("0") &&
        (digits.length === 11 || digits.length === 12)
    ) {
        digits = digits.slice(1);
    }
    if (digits.startsWith("55")) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits.length >= 10 ? digits : null;
}

function resolveColumns(
    headers: string[],
    options: ScriptOptions,
): CsvColumns {
    return {
        phone: requiredColumn(
            headers,
            options.phoneColumn,
            PHONE_ALIASES,
            "phone",
        ),
        occurredAt: requiredColumn(
            headers,
            options.dateColumn,
            DATE_ALIASES,
            "date/time",
        ),
        source: requiredColumn(
            headers,
            options.sourceColumn,
            SOURCE_ALIASES,
            "source/origin",
        ),
        gclid: optionalColumn(headers, ["gclid"]),
        gbraid: optionalColumn(headers, ["gbraid"]),
        wbraid: optionalColumn(headers, ["wbraid"]),
        fbclid: optionalColumn(headers, ["fbclid"]),
        fbc: optionalColumn(headers, ["fbc"]),
        ctwaClid: optionalColumn(headers, ["ctwa clid", "ctwa_clid"]),
        utmSource: optionalColumn(headers, ["utm source", "utm_source"]),
        utmMedium: optionalColumn(headers, ["utm medium", "utm_medium"]),
    };
}

function requiredColumn(
    headers: string[],
    override: string | null,
    aliases: string[],
    label: string,
) {
    const index = optionalColumn(
        headers,
        override ? [override] : aliases,
    );
    if (index === null) {
        throw new Error(
            `Could not find the ${label} column. CSV headers: ${headers.join(
                " | ",
            )}`,
        );
    }
    return index;
}

function optionalColumn(headers: string[], aliases: string[]) {
    const normalizedAliases = new Set(aliases.map(normalizeHeader));
    const index = headers.findIndex((header) =>
        normalizedAliases.has(normalizeHeader(header)),
    );
    return index >= 0 ? index : null;
}

function parseOptions(args: string[]): ScriptOptions {
    if (args.includes("--help") || args.includes("-h")) {
        printUsage();
        process.exit(0);
    }

    const csvPath = args.find((argument) => !argument.startsWith("--"));
    if (!csvPath) {
        printUsage();
        throw new Error("Provide the TinTim CSV path.");
    }

    const maxDistanceValue = optionValue(args, "max-distance-hours");
    const maxDistanceHours = maxDistanceValue
        ? Number(maxDistanceValue)
        : DEFAULT_MAX_DISTANCE_HOURS;
    if (!Number.isFinite(maxDistanceHours) || maxDistanceHours <= 0) {
        throw new Error("--max-distance-hours must be a positive number.");
    }

    return {
        csvPath,
        apply: args.includes("--apply"),
        maxDistanceHours,
        phoneColumn: optionValue(args, "phone-column"),
        dateColumn: optionValue(args, "date-column"),
        sourceColumn: optionValue(args, "source-column"),
    };
}

function optionValue(args: string[], name: string) {
    const prefix = `--${name}=`;
    return args.find((argument) => argument.startsWith(prefix))?.slice(
        prefix.length,
    ) ?? null;
}

function printUsage() {
    console.log(`
Usage:
  node --env-file=.env.local --import tsx scripts/backfill-tintim-attribution.ts <tintim.csv>
  node --env-file=.env.local --import tsx scripts/backfill-tintim-attribution.ts <tintim.csv> --apply

Optional column overrides:
  --phone-column="Telefone"
  --date-column="Data da conversa"
  --source-column="Origem"
  --max-distance-hours=48

The default is a dry run. No clients or conversations are modified.
`);
}

function printInputSummary({
    csvPath,
    delimiter,
    headers,
    totalRows,
    parsedRows,
}: {
    csvPath: string;
    delimiter: string;
    headers: string[];
    totalRows: number;
    parsedRows: number;
}) {
    const delimiterLabel =
        delimiter === "\t" ? "TAB" : delimiter === ";" ? "semicolon" : "comma";
    console.log("\nTinTim attribution backfill");
    console.log(`CSV: ${resolve(csvPath)}`);
    console.log(`Delimiter: ${delimiterLabel}`);
    console.log(`Headers: ${headers.join(" | ")}`);
    console.log(`Data rows: ${formatNumber(totalRows)}`);
    console.log(`Rows with valid phone/date: ${formatNumber(parsedRows)}`);
}

function printAttributionSummary(events: AttributionInsert[]) {
    const counts = new Map<string, number>();
    for (const event of events) {
        const category =
            event.platform === "meta_ads"
                ? "Meta Ads"
                : event.platform === "google_ads"
                  ? "Google Ads"
                  : isTrackedTintimSource(event.source)
                    ? "Other origins"
                    : "Untracked";
        counts.set(category, (counts.get(category) ?? 0) + 1);
    }

    console.log("\nSafe attribution events:");
    for (const category of [
        "Meta Ads",
        "Google Ads",
        "Other origins",
        "Untracked",
    ]) {
        console.log(
            `  ${category}: ${formatNumber(counts.get(category) ?? 0)}`,
        );
    }
}

function printRejections(rejections: Rejection[]) {
    const counts = new Map<RejectionReason, number>();
    for (const rejection of rejections) {
        counts.set(
            rejection.reason,
            (counts.get(rejection.reason) ?? 0) + 1,
        );
    }

    console.log("\nSkipped rows:");
    if (rejections.length === 0) {
        console.log("  None");
        return;
    }

    for (const reason of [
        "invalid_phone",
        "invalid_date",
        "client_not_found",
        "duplicate_clients",
        "conversation_not_found",
        "multiple_conversations",
        "duplicate_csv_event",
    ] as const) {
        const count = counts.get(reason) ?? 0;
        if (count > 0) console.log(`  ${reason}: ${formatNumber(count)}`);
    }

    console.log("  First examples:");
    for (const rejection of rejections.slice(0, 10)) {
        console.log(
            `    line ${rejection.line} · ${rejection.reason}` +
                (rejection.phone
                    ? ` · phone ending ${rejection.phone.slice(-4)}`
                    : ""),
        );
    }
}

function valueAt(row: string[], index: number | null) {
    return index === null ? null : nullableText(row[index]);
}

function nullableText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed || null;
}

function stripBrazilPrefix(phone: string) {
    return phone.startsWith("55") ? phone.slice(2) : phone;
}

function normalizeHeader(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function validIso(timestamp: number) {
    return Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : null;
}

function saoPauloIso({
    year,
    month,
    day,
    hour,
    minute,
    second,
}: {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    second: string;
}) {
    const numericYear = Number(year);
    const numericMonth = Number(month);
    const numericDay = Number(day);
    const numericHour = Number(hour);
    const numericMinute = Number(minute);
    const numericSecond = Number(second);
    const maximumDay =
        numericMonth >= 1 && numericMonth <= 12
            ? new Date(Date.UTC(numericYear, numericMonth, 0)).getUTCDate()
            : 0;

    if (
        numericYear < 2000 ||
        numericYear > 2100 ||
        numericDay < 1 ||
        numericDay > maximumDay ||
        numericHour < 0 ||
        numericHour > 23 ||
        numericMinute < 0 ||
        numericMinute > 59 ||
        numericSecond < 0 ||
        numericSecond > 59
    ) {
        return null;
    }

    return validIso(
        Date.parse(
            `${numericYear}-${pad(String(numericMonth))}-${pad(
                String(numericDay),
            )}T${pad(String(numericHour))}:${pad(
                String(numericMinute),
            )}:${pad(String(numericSecond))}-03:00`,
        ),
    );
}

const supabaseServiceFetch: typeof fetch = (input, init) => {
    const headers = new Headers(
        input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
        headers.set(key, value);
    });
    const apiKey = headers.get("apikey");
    const authorization = headers.get("authorization");

    if (
        apiKey?.startsWith("sb_secret_") &&
        authorization === `Bearer ${apiKey}`
    ) {
        headers.delete("authorization");
    }

    return fetch(input, { ...init, headers });
};

function pad(value: string) {
    return value.padStart(2, "0");
}

function chunk<T>(values: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function formatNumber(value: number) {
    return new Intl.NumberFormat("pt-BR").format(value);
}

const entrypoint = process.argv[1]
    ? pathToFileURL(resolve(process.argv[1])).href
    : null;

if (entrypoint === import.meta.url) {
    main().catch((error) => {
        console.error(
            "\nBackfill failed:",
            error instanceof Error ? error.message : error,
        );
        process.exitCode = 1;
    });
}
