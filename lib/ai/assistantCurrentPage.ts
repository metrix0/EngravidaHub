import type { AssistantPageContext } from "./assistantPageContext";

export function readCurrentPageContext(context: AssistantPageContext | null | undefined, scope: unknown, sectionId: unknown) {
    if (!context || !Array.isArray(context.sections)) return { ok: false, error: "Nenhum dado da tela disponível neste chat." };
    const sections = context.sections.filter(section => section &&
        typeof section.id === "string" && typeof section.title === "string");
    const relevant = scope === "all" ? sections :
        scope === "section" ? sections.filter(section => section.id === sectionId) :
        sections.filter(section => context.visible_sections?.includes(section.id) || section.id === context.focused_section);
    const chosen = relevant.length ? relevant : scope === "section" ? [] : sections.slice(0, 2);
    // Dashboard widgets share already-fetched sources. Include each referenced source once.
    const references = new Set(chosen.flatMap(section => {
        const data = section.data;
        if (!data || typeof data !== "object" || !("dados_referencia" in data)) return [];
        const refs = data.dados_referencia;
        return typeof refs === "string" ? [refs] :
            Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string") : [];
    }));
    const resolved = [
        ...chosen,
        ...sections.filter(section => references.has(section.id) && !chosen.includes(section)),
    ];
    return {
        ok: true,
        origem: "dados já carregados no navegador",
        pagina: context.title,
        caminho: context.path,
        secao_em_foco: context.focused_section,
        secoes_visiveis: context.visible_sections,
        filtros: context.filters,
        texto_visivel: context.visible_text,
        secoes: resolved,
        outras_secoes_disponiveis: sections.map(section => ({ id: section.id, title: section.title })),
        aviso: resolved.some(section => section.truncated) ?
            "Alguns conjuntos grandes foram limitados. Não trate uma amostra como a lista inteira." : null,
    };
}
