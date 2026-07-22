// lib/schedules/getBigquerySchedules.ts
import { BigQuery } from "@google-cloud/bigquery";

export type BigqueryScheduleRow = {
    source_schedule_id: string | number | null;
    data: string | { value: string } | null;
    agendamento_criado_em: string | { value: string } | null;
    agenda_autor_original: string | null;
    agenda_paciente: string | null;
    agenda_celular: string | null;
    unidade: string | null;
    procedimentos_procedimento: string | null;
    agenda_chegou: string | null;
};

const BIGQUERY_LOCATION = "southamerica-east1";
const BIGQUERY_DATASET = "datastudio";
const BIGQUERY_SCHEDULE_VIEW = "view_agendamentos_uptodate";

let scheduleIdColumnPromise: Promise<string | null> | null = null;

export async function getBigquerySchedules({
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

    scheduleIdColumnPromise ??= resolveScheduleIdColumn(bigquery);
    const scheduleIdColumn = await scheduleIdColumnPromise;
    const sourceIdExpression = scheduleIdColumn
        ? `CAST(source.\`${scheduleIdColumn}\` AS STRING)`
        : "CAST(NULL AS STRING)";

    const query = `
        WITH schedule_source AS (
            SELECT
            ${sourceIdExpression} AS source_schedule_id,
            DATE(source.agenda_data_us) AS data,
            SAFE.PARSE_DATETIME(
                '%d/%m/%Y %H:%M:%S',
                NULLIF(TRIM(source.agenda_data_agendamento_original), '')
            ) AS agendamento_criado_em,
            source.agenda_autor_original,
            source.agenda_paciente,
            source.agenda_celular,
            CASE source.agenda_centro_custos
                WHEN 1 THEN 'Brasília'
                WHEN 2 THEN 'Rio de Janeiro'
                WHEN 3 THEN 'Recife'
                WHEN 4 THEN 'São Paulo'
                WHEN 5 THEN 'Salvador'
                WHEN 6 THEN 'Campinas'
                WHEN 7 THEN 'Manaus'
                WHEN 9 THEN 'Juiz de Fora'
                WHEN 10 THEN 'Bauru'
                WHEN 11 THEN 'Vitória'
                WHEN 12 THEN 'Belo Horizonte'
                ELSE CAST(source.agenda_centro_custos AS STRING)
            END AS unidade,
            source.procedimentos_procedimento,
            source.agenda_chegou
        FROM \`dashboards-384718.datastudio.view_agendamentos_uptodate\` AS source
        WHERE source.agenda_oculto = 0
          AND source.procedimentos_procedimento LIKE '%1ª Avaliação de Reprodução Humana%'
        )

        SELECT *
        FROM schedule_source
        WHERE DATE(agendamento_criado_em) >= DATE_SUB(
                  CURRENT_DATE('America/Sao_Paulo'),
                  INTERVAL @daysBack DAY
              )
           OR data BETWEEN
              DATE_SUB(
                  CURRENT_DATE('America/Sao_Paulo'),
                  INTERVAL @daysBack DAY
              )
              AND CURRENT_DATE('America/Sao_Paulo')
        ORDER BY agendamento_criado_em DESC, data DESC
        LIMIT @limit
    `;

    const [rows] = await bigquery.query({
        query,
        location: BIGQUERY_LOCATION,
        params: {
            daysBack,
            limit,
        },
    });

    console.log("[getBigquerySchedules] raw BigQuery rows", {
        count: rows.length,
        daysBack,
        limit,
        date_filter: "created_or_scheduled_through_today",
        source_id_column: scheduleIdColumn,
    });

    return rows as BigqueryScheduleRow[];
}

async function resolveScheduleIdColumn(bigquery: BigQuery) {
    const override = process.env.CLINISYS_SCHEDULE_ID_COLUMN?.trim();
    if (override) return validateColumnName(override);

    try {
        const [metadata] = await bigquery
            .dataset(BIGQUERY_DATASET)
            .table(BIGQUERY_SCHEDULE_VIEW)
            .getMetadata();
        const fields = Array.isArray(metadata.schema?.fields)
            ? metadata.schema.fields
            : [];
        const names: string[] = fields.flatMap((field: unknown) => {
            if (!field || typeof field !== "object") return [];
            const name = (field as { name?: unknown }).name;
            return typeof name === "string" && name.trim()
                ? [name.trim()]
                : [];
        });

        const candidates = [
            "agenda_id",
            "id_agenda",
            "agendamento_id",
            "id_agendamento",
            "agenda_codigo",
            "codigo_agenda",
            "agenda_cod",
            "agenda_id_agendamento",
            "agenda_uuid",
            "agenda_chave",
        ];
        const byLowerName = new Map(
            names.map((name) => [name.toLocaleLowerCase("pt-BR"), name]),
        );

        for (const candidate of candidates) {
            const match = byLowerName.get(candidate);
            if (match) return validateColumnName(match);
        }

        const heuristicMatch = names.find((name) =>
            /^(?:(?:agenda|agendamento)_(?:id|codigo|cod|chave|uuid)|(?:id|codigo|cod|chave|uuid)_(?:agenda|agendamento))$/i.test(
                name,
            ),
        );

        return heuristicMatch ? validateColumnName(heuristicMatch) : null;
    } catch (error) {
        console.warn(
            "[getBigquerySchedules] could not inspect schedule identifier column; using source_hash fallback",
            error instanceof Error ? error.message : String(error),
        );
        return null;
    }
}

function validateColumnName(value: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`Invalid CLINISYS_SCHEDULE_ID_COLUMN: ${value}`);
    }
    return value;
}

function getGoogleCredentials() {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!raw) {
        throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
    }

    return JSON.parse(raw);
}
