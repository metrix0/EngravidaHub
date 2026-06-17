// app/src/lib/schedules/getBigquerySchedules.ts
import { BigQuery } from "@google-cloud/bigquery";

export type BigqueryScheduleRow = {
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

    const query = `
        WITH schedules AS (
            SELECT
            DATE(agenda_data_us) as data,
            DATE(
            SAFE.PARSE_DATETIME(
            '%d/%m/%Y %H:%M:%S',
            NULLIF(TRIM(agenda_data_agendamento_original), '')
            )
            ) AS agendamento_criado_em,
            agenda_autor_original,
            agenda_paciente,
            agenda_celular,
            CASE agenda_centro_custos
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
            ELSE CAST(agenda_centro_custos AS STRING)
        END AS unidade,
    procedimentos_procedimento,
    agenda_chegou
  FROM \`dashboards-384718.datastudio.view_agendamentos_uptodate\`
  WHERE agenda_oculto = 0
  AND procedimentos_procedimento LIKE '%1ª Avaliação de Reprodução Humana%'
)

        SELECT *
        FROM schedules
        WHERE agendamento_criado_em >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL @daysBack DAY)
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
        rows: rows.slice(0, 10),
    });

    return rows as BigqueryScheduleRow[];
}

function getGoogleCredentials() {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!raw) {
        throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
    }

    return JSON.parse(raw);
}