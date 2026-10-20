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

export function captureAssistantPageContext(): AssistantPageContext | null {
    if (typeof window === "undefined") return null;
    const snapshots = [...providers.values()].map(read => {
        try { return read(); } catch { return null; }
    }).filter((item): item is AssistantPageSnapshot => item !== null);
    if (!snapshots.length) return null;

    const locations = Array.from(document.querySelectorAll<HTMLElement>("[data-assistant-section]"))
        .filter(inViewport)
        .map(element => ({
            id: element.dataset.assistantSection ?? "",
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
    const headings = Array.from(document.querySelectorAll<HTMLElement>("main h1, main h2, main h3"))
        .filter(inViewport).map(el => el.innerText.trim()).filter(Boolean).slice(0, 12);
    const active = document.activeElement as HTMLElement | null;
    const activeLabel = active?.getAttribute("aria-label") || active?.getAttribute("title") || "";
    return {
        path: window.location.pathname,
        title: snapshots.find(snapshot => snapshot.filters)?.title ?? snapshots[0].title,
        focused_section: focused || visible[0] || null,
        visible_sections: visible,
        filters: Object.assign({}, ...snapshots.map(snapshot => snapshot.filters ?? {})),
        sections,
        visible_text: [...headings, activeLabel].filter(Boolean).join(" · ").slice(0, 1500),
    };
}
