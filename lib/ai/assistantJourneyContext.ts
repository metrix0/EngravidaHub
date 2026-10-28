import type { AssistantPageSection } from "./assistantPageContext";

/** Read the graph's resolved state, never the separate summary response. */
export function buildAssistantJourneySections({ pipeline, loading, error, query }: {
    pipeline: object;
    loading: boolean;
    error?: string | null;
    query: string | null;
}): AssistantPageSection[] {
    const details: AssistantPageSection[] = [];
    if (!loading && !error) {
        const root = pipeline as Record<string, unknown>;
        const groups = [
            { key: "paid", pipeline: root },
            ...((root.additional_pipelines ?? []) as Array<{ key: string; pipeline: Record<string, unknown> }>),
        ];
        for (const group of groups) {
            const entries = Object.entries(group.pipeline).filter(([field]) =>
                field !== "additional_pipelines" && field !== "query_params");
            const metadata = Object.fromEntries(entries.filter(([, value]) =>
                value === null || typeof value !== "object"));
            const fields: Array<[string, unknown]> = [["escopo", metadata]];
            for (const [field, value] of entries) {
                if (value === null || typeof value !== "object") continue;
                if (field === "audit") {
                    const auditEntries = Object.entries(value);
                    fields.push(["audit-escopo", Object.fromEntries(auditEntries.filter(([, item]) =>
                        item === null || typeof item !== "object"))]);
                    fields.push(...auditEntries.filter(([, item]) => item !== null && typeof item === "object")
                        .map(([key, item]): [string, unknown] => [`audit-${key}`, item]));
                } else fields.push([field, value]);
            }
            for (const [field, value] of fields) {
                // Separate branches so large flows cannot hide later groups behind
                // the per-section character/depth limit.
                const chunks = Array.isArray(value)
                    ? Array.from({ length: Math.max(1, Math.ceil(value.length / 20)) }, (_, i) => value.slice(i * 20, (i + 1) * 20))
                    : [value];
                chunks.forEach((data, index) => details.push({
                    id: `jornada-pipeline-${group.key}-${field}-${index}`,
                    title: `Jornada completa — ${group.key} — ${field}${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ""}`,
                    data: { grupo: group.key, campo: field, valores: data },
                }));
            }
        }
    }
    return [{
        id: "jornada-pipeline",
        title: "Jornada completa — grafo exibido",
        data: {
            carregando: loading,
            erro: error ?? null,
            consulta: query,
            metodologia: "Coortes e grupos distintos. Não somar taxas nem confundir clientes, conversas, agendamentos e valores monetários. Receita autorizada não confirma pagamento. Métricas de anúncios globais quando ads_scope_global=true.",
            dados_referencia: details.map(section => section.id),
        },
    }, ...details];
}
