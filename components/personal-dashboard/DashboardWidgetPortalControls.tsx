"use client";

import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

import DashboardAddControl from "@/components/personal-dashboard/DashboardAddControl";
import { CHANNEL_DASHBOARD_WIDGETS } from "@/lib/personal-dashboard/channelWidgets";
import { DASHBOARD_WIDGETS } from "@/lib/personal-dashboard/registry";

type PortalTarget = {
    key: string;
    widgetId: string;
    element: HTMLElement;
};

const ATENDIMENTO_SECTIONS = [
    ["dashboard-instagram", ["instagram."]],
    ["dashboard-messenger", ["messenger."]],
    ["dashboard-ligacoes", ["ligacoes."]],
] as const;

const MESSAGE_HEADINGS = [
    ["Templates utilizados", "mensagem_ativa.templates_utilizados"],
    ["Volume e resultados", "mensagem_ativa.volume_resultados"],
    ["Histórico de envios", "mensagem_ativa.historico_envios"],
] as const;

const ATTRIBUTION_IDS = new Set([
    "instagram.origem_paga",
    "instagram.clientes_campanha",
]);

export default function DashboardWidgetPortalControls() {
    const pathname = usePathname();
    const [targets, setTargets] = useState<PortalTarget[]>([]);

    useEffect(() => {
        const supportedPath =
            pathname === "/" ||
            DASHBOARD_WIDGETS.some((widget) => widget.sourcePath === pathname) ||
            pathname === "/atendimento" ||
            pathname === "/mensagem-ativa";

        if (!supportedPath) {
            setTargets([]);
            return;
        }

        let frame = 0;
        const scan = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (pathname === "/") {
                    movePersonalDashboardControlsToBottom();
                    setTargets([]);
                    return;
                }

                const next = new Map<string, PortalTarget>();

                if (pathname === "/atendimento") {
                    for (const target of findAtendimentoTargets()) {
                        next.set(target.widgetId, target);
                    }
                }

                if (pathname === "/mensagem-ativa") {
                    for (const target of findMensagemAtivaTargets()) {
                        next.set(target.widgetId, target);
                    }
                }

                for (const target of findGenericTargets(pathname)) {
                    if (!next.has(target.widgetId)) {
                        next.set(target.widgetId, target);
                    }
                }

                const resolved = [...next.values()];
                for (const target of resolved) {
                    target.element.classList.add(
                        "relative",
                        "group/dashboard-widget",
                    );
                }
                setTargets(resolved);
            });
        };

        scan();
        const observer = new MutationObserver(scan);
        const root = document.querySelector(".app-content") ?? document.body;
        observer.observe(root, { childList: true, subtree: true });

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [pathname]);

    return (
        <>
            {targets.map((target) =>
                createPortal(
                    <DashboardAddControl
                        widgetId={target.widgetId}
                        groupControl
                    />,
                    target.element,
                    target.key,
                ),
            )}
        </>
    );
}

function movePersonalDashboardControlsToBottom() {
    const widgets = document.querySelectorAll<HTMLElement>(
        '[class~="group/personal-widget"]',
    );

    for (const widget of widgets) {
        const controls = [...widget.children].find(
            (child): child is HTMLElement =>
                child instanceof HTMLElement &&
                child.classList.contains("absolute") &&
                child.classList.contains("right-3") &&
                child.classList.contains("top-3"),
        );
        if (!controls) continue;
        controls.classList.remove("top-3");
        controls.classList.add("bottom-3");
    }
}

function findGenericTargets(pathname: string): PortalTarget[] {
    const appRoot = document.querySelector<HTMLElement>(".app-content");
    if (!appRoot) return [];

    const targets: PortalTarget[] = [];
    for (const widget of DASHBOARD_WIDGETS) {
        if (widget.sourcePath !== pathname || widget.id.startsWith("canais.")) {
            continue;
        }

        const element = findDashboardCard(appRoot, widget.title, true);
        if (!element || element.querySelector("[data-dashboard-add-control='true']")) {
            continue;
        }

        targets.push({
            key: `generic-${widget.id}`,
            widgetId: widget.id,
            element,
        });
    }

    return targets;
}

function findAtendimentoTargets(): PortalTarget[] {
    const targets = new Map<string, PortalTarget>();

    for (const [sectionId, prefixes] of ATENDIMENTO_SECTIONS) {
        const section = document.getElementById(sectionId);
        if (!section) continue;

        const definitions = CHANNEL_DASHBOARD_WIDGETS.filter((widget) =>
            prefixes.some((prefix) => widget.id.startsWith(prefix)),
        );
        for (const widget of definitions) {
            if (ATTRIBUTION_IDS.has(widget.id)) continue;
            const element = findDashboardCard(section, widget.title, true);
            if (!element) continue;
            targets.set(widget.id, {
                key: `channel-${widget.id}`,
                widgetId: widget.id,
                element,
            });
        }
    }

    const appRoot = document.querySelector<HTMLElement>(".app-content");
    if (appRoot) {
        for (const widget of CHANNEL_DASHBOARD_WIDGETS) {
            if (!ATTRIBUTION_IDS.has(widget.id)) continue;
            const element = findDashboardCard(appRoot, widget.title, true);
            if (!element) continue;
            targets.set(widget.id, {
                key: `channel-${widget.id}`,
                widgetId: widget.id,
                element,
            });
        }
    }

    return [...targets.values()];
}

function findMensagemAtivaTargets(): PortalTarget[] {
    const targets: PortalTarget[] = [];

    for (const [headingText, widgetId] of MESSAGE_HEADINGS) {
        const heading = findHeading(document, headingText);
        const section = heading?.closest("section") as HTMLElement | null;
        if (!section) continue;
        targets.push({
            key: `mensagem-${widgetId}`,
            widgetId,
            element: section,
        });
    }

    return targets;
}

function findDashboardCard(
    root: ParentNode,
    title: string,
    allowTextFallback = false,
) {
    const titled = [...root.querySelectorAll<HTMLElement>("[title]")].find(
        (element) => element.getAttribute("title")?.trim() === title,
    );
    const titledCard = titled ? closestDashboardCard(titled) : null;
    if (titledCard) return titledCard;

    const heading = findHeading(root, title);
    const headingCard = heading ? closestDashboardCard(heading) : null;
    if (headingCard) return headingCard;

    if (!allowTextFallback) return null;

    return [...root.querySelectorAll<HTMLElement>("[data-dashboard-card='true']")].find(
        (card) => card.textContent?.includes(title),
    ) ?? null;
}

function closestDashboardCard(element: HTMLElement) {
    let current: HTMLElement | null = element;
    while (current) {
        if (current.dataset.dashboardCard === "true") return current;
        current = current.parentElement;
    }
    return null;
}

function findHeading(root: ParentNode, text: string) {
    return [...root.querySelectorAll<HTMLElement>("h2, h3")].find(
        (element) => element.textContent?.trim() === text,
    );
}
