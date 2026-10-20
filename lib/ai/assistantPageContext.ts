"use client";

import { useEffect, useRef } from "react";

export type AssistantPageSection = {
    id: string;
    title: string;
    data: unknown;
};

export type AssistantPageSnapshot = {
    title: string;
    filters?: Record<string, unknown>;
    sections: AssistantPageSection[];
};

export type AssistantPageContext = {
    path: string;
    title: string;
    focused_section: string | null;
    visible_sections: string[];
    filters: Record<string, unknown>;
    sections: Array<{ id: string; title: string; data: unknown; truncated: boolean }>;
    visible_text: string;
};

const providers = new Map<string, () => AssistantPageSnapshot | null>();

// A provider holds only a getter. Existing React state is never copied on page load.
export function useAssistantPageContext(id: string, getSnapshot: () => AssistantPageSnapshot | null) {
    const getter = useRef(getSnapshot);
    getter.current = getSnapshot;

    useEffect(() => {
        const read = () => getter.current();
        providers.set(id, read);
        return () => {
            if (providers.get(id) === read) providers.delete(id);
        };
    }, [id]);
}

function boundedData(value: unknown, maxChars: number) {
    let truncated = false;
    function trim(input: unknown, depth: number): unknown {
        if (typeof input === "string") {
            if (input.length > 500) truncated = true;
            return input.slice(0, 500);
        }
        if (input === null || typeof input !== "object") return input;
        if (depth >= 7) {
            truncated = true;
            return "[mais níveis disponíveis na página]";
        }
        if (Array.isArray(input)) {
            if (input.length > 35) truncated = true;
            const items = input.slice(0, 35).map(item => trim(item, depth + 1));
            return input.length > 35 ? { total: input.length, primeiros_registros: items } : items;
        }
        const entries = Object.entries(input as Record<string, unknown>);
        if (entries.length > 70) truncated = true;
        return Object.fromEntries(entries.slice(0, 70).map(([key, item]) => [key, trim(item, depth + 1)]));
    }
    const sampled = trim(value, 0);
    let serialized: string;
    try {
        serialized = JSON.stringify(sampled) ?? "null";
    } catch {
        return { data: null, truncated: true };
    }
    if (serialized.length > maxChars) {
        truncated = true;
        // JSON remains valid. The assistant will know the preview is incomplete.
        return { data: { resumo_parcial: serialized.slice(0, maxChars) }, truncated };
    }
    return { data: sampled, truncated };
}

function inViewport(element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 &&
        bounds.bottom > 0 && bounds.top < window.innerHeight &&
        bounds.right > 0 && bounds.left < window.innerWidth;
}


// The fallback reads only rendered page content when the user sends a message.
// Pages with a registered data provider keep their richer, already-loaded state.
function readRenderedPage() {
    const root = document.querySelector<HTMLElement>(".app-content main") ??
        document.querySelector<HTMLElement>(".app-content [role='main']") ??
        document.querySelector<HTMLElement>(".app-content");
    if (!root) return null;

    const elements: Array<{ id: string; element: HTMLElement }> = [];
    const sections: AssistantPageSection[] = [];
    const used = new Set<HTMLElement>();
    const headings = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, [role='heading']"))
        .slice(0, 80);

    const pageTitle = headings.find(heading => heading.matches("h1, [aria-level='1']"))
        ?.innerText.trim() || document.title.replace(/\s*[|–-]\s*Engravida Hub.*$/, "").trim()
        || window.location.pathname.split("/").filter(Boolean).join(" / ") || "Dashboard";

    for (const heading of headings) {
        if (sections.length >= 14) break;
        const title = heading.innerText.trim().replace(/\s+/g, " ").slice(0, 140);
        if (!title) continue;

        // Find the nearest reasonable widget/container, not an entire dashboard.
        let element = heading.parentElement;
        let chosen: HTMLElement | null = null;
        for (let depth = 0; element && element !== root && depth < 6; depth++, element = element.parentElement) {
            const otherHeadings = element.querySelectorAll("h1, h2, h3, [role='heading']").length;
            if (otherHeadings > 3) break;
            const length = element.innerText.trim().length;
            if (length > 0 && length <= 4500) chosen = element;
            if (length >= 180) break;
        }
        const container = chosen ?? heading.parentElement ?? heading;
        if (used.has(container)) continue;
        used.add(container);
        const id = `pagina-secao-${sections.length + 1}`;
        sections.push({
            id,
            title,
            data: {
                texto_renderizado: textChunks(container.innerText, 2200),
            },
        });
        elements.push({ id, element: container });
    }

    // Covers pages without headings and content outside the identified widgets.
    sections.push({
        id: "pagina-resumo",
        title: "Conteúdo da página",
        data: { texto_renderizado: textChunks(root.innerText, 5000) },
    });

    const activeControls = Array.from(root.querySelectorAll<HTMLElement>(
        '[role="tab"][aria-selected="true"], [aria-pressed="true"], [data-state="active"], [data-state="checked"]',
    )).slice(0, 20).map(control => control.innerText.trim().slice(0, 100)).filter(Boolean);
    const selectedOptions = Array.from(root.querySelectorAll<HTMLSelectElement>("select")).slice(0, 15)
        .map(select => ({
            campo: select.getAttribute("aria-label") || select.name || "Seleção",
            valor: Array.from(select.selectedOptions).map(option => option.text).join(", ").slice(0, 180),
        })).filter(option => option.valor);

    return {
        snapshot: {
            title: pageTitle,
            filters: {
                ...(activeControls.length ? { controles_ativos: activeControls } : {}),
                ...(selectedOptions.length ? { selecoes: selectedOptions } : {}),
            },
            sections,
        } satisfies AssistantPageSnapshot,
        elements,
    };
}

function textChunks(raw: string, limit: number): string[] {
    // Keep chunks short so the existing context limiter doesn't cut them at 500 characters.
    const value = raw.trim().replace(/\n{3,}/g, "\n\n").slice(0, limit);
    return value.match(/[\s\S]{1,400}/g) ?? [];
}

export function captureAssistantPageContext(): AssistantPageContext | null {
    if (typeof window === "undefined") return null;
    const snapshots = [...providers.values()].map(read => {
        try { return read(); } catch { return null; }
    }).filter((item): item is AssistantPageSnapshot => item !== null);
    const rendered = readRenderedPage();
    if (rendered) snapshots.push(rendered.snapshot);
    if (!snapshots.length) return null;

    const annotated = Array.from(document.querySelectorAll<HTMLElement>(".app-content [data-assistant-section]"))
        .map(element => ({ id: element.dataset.assistantSection ?? "", element }));
    const locations = [...annotated, ...(rendered?.elements ?? [])]
        .filter(item => item.id && inViewport(item.element))
        .map(({ id, element }) => ({
            id,
            score: Math.abs((element.getBoundingClientRect().top + element.getBoundingClientRect().bottom) / 2 - window.innerHeight / 2),
        }))
        .sort((a, b) => a.score - b.score);
    const focused = document.activeElement?.closest<HTMLElement>("[data-assistant-section]")?.dataset.assistantSection;
    const visible = [...new Set(locations.map(item => item.id).filter(Boolean))].slice(0, 5);
    const sections = snapshots.flatMap(snapshot => snapshot.sections).map(section => ({
        id: section.id,
        title: section.title,
        ...boundedData(section.data, 6000),
    }));
    // Read text already rendered in the current viewport, without DOM observers or requests.
    const headings = Array.from(document.querySelectorAll<HTMLElement>(".app-content main h1, .app-content main h2, .app-content main h3"))
        .filter(inViewport).map(el => el.innerText.trim()).filter(Boolean).slice(0, 12);
    const active = document.activeElement as HTMLElement | null;
    const activeLabel = active?.getAttribute("aria-label") || active?.getAttribute("title") || "";
    return {
        path: window.location.pathname,
        title: snapshots.find(snapshot => snapshot !== rendered?.snapshot)?.title ?? rendered?.snapshot.title ?? snapshots[0].title,
        focused_section: focused || visible[0] || null,
        visible_sections: visible,
        filters: Object.assign({}, ...snapshots.map(snapshot => snapshot.filters ?? {})),
        sections,
        visible_text: [...headings, activeLabel].filter(Boolean).join(" · ").slice(0, 1500),
    };
}
