"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

type SectionDefinition = {
    id: string;
    label: string;
    heading?: string;
};

type SectionNavigationConfig = {
    key: string;
    parentHref: string;
    sections: SectionDefinition[];
};

const DASHBOARD_SECTIONS: SectionDefinition[] = [
    { id: "dashboard-conversas", label: "Conversas" },
    {
        id: "dashboard-instagram",
        label: "Instagram",
        heading: "Análise das conversas do Instagram",
    },
    {
        id: "dashboard-messenger",
        label: "Messenger",
        heading: "Análise das conversas do Messenger",
    },
    { id: "dashboard-ligacoes", label: "Ligações", heading: "Ligações" },
];

const FINANCEIRO_SECTIONS: SectionDefinition[] = [
    { id: "financeiro-visao-geral", label: "Visão geral" },
    {
        id: "financeiro-unidades",
        label: "Unidades",
        heading: "Faturamento por unidade",
    },
    {
        id: "financeiro-origem-medicos",
        label: "Origem e médicos",
        heading: "Faturamento por Origem",
    },
    {
        id: "financeiro-midia-paga",
        label: "Mídia paga",
        heading: "Mídia paga",
    },
];

function getNavigationConfig(pathname: string): SectionNavigationConfig | null {
    if (pathname === "/") {
        return {
            key: "dashboard",
            parentHref: "/",
            sections: DASHBOARD_SECTIONS,
        };
    }

    if (pathname.startsWith("/financeiro")) {
        return {
            key: "financeiro",
            parentHref: "/financeiro",
            sections: FINANCEIRO_SECTIONS,
        };
    }

    return null;
}

function getPageScroller() {
    return document.querySelector<HTMLElement>(".app-content > main");
}

function findHeading(root: HTMLElement, text: string) {
    return [...root.querySelectorAll<HTMLElement>("h1, h2, h3")].find(
        (element) => element.textContent?.trim() === text,
    ) ?? null;
}

function resolveSectionTarget(
    scroller: HTMLElement,
    section: SectionDefinition,
    firstSectionId: string,
) {
    if (section.id === firstSectionId || !section.heading) {
        return scroller;
    }

    const heading = findHeading(scroller, section.heading);
    if (!heading) return null;

    return heading.closest<HTMLElement>("section") ?? heading;
}

function getTargetTop(scroller: HTMLElement, target: HTMLElement) {
    if (target === scroller) return 0;

    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return scroller.scrollTop + targetRect.top - scrollerRect.top;
}

function findParentLink(nav: HTMLElement, href: string) {
    return [...nav.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
        (link) => {
            try {
                return new URL(link.href, window.location.origin).pathname === href;
            } catch {
                return false;
            }
        },
    ) ?? null;
}

export default function SidePanelSectionNav() {
    const pathname = usePathname();
    const config = useMemo(() => getNavigationConfig(pathname), [pathname]);
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    const [activeSectionId, setActiveSectionId] = useState<string | null>(
        config?.sections[0]?.id ?? null,
    );

    useEffect(() => {
        setActiveSectionId(config?.sections[0]?.id ?? null);
    }, [config]);

    useEffect(() => {
        if (!config) {
            setHost(null);
            return;
        }

        let currentHost: HTMLDivElement | null = null;
        let resizeObserver: ResizeObserver | null = null;

        const install = () => {
            if (currentHost?.isConnected) return true;

            const aside = document.querySelector<HTMLElement>("aside");
            const nav = aside?.querySelector<HTMLElement>("nav");
            if (!aside || !nav) return false;

            const parentLink = findParentLink(nav, config.parentHref);
            if (!parentLink) return false;

            const previousHost = nav.querySelector<HTMLDivElement>(
                `[data-sidepanel-section-nav="${config.key}"]`,
            );
            previousHost?.remove();

            currentHost = document.createElement("div");
            currentHost.dataset.sidepanelSectionNav = config.key;
            parentLink.insertAdjacentElement("afterend", currentHost);
            setHost(currentHost);

            const updateExpanded = () => {
                const mobile = window.matchMedia("(max-width: 767px)").matches;
                setSidebarExpanded(mobile || aside.getBoundingClientRect().width >= 180);
            };

            updateExpanded();
            resizeObserver = new ResizeObserver(updateExpanded);
            resizeObserver.observe(aside);
            return true;
        };

        if (!install()) {
            const observer = new MutationObserver(() => {
                if (install()) observer.disconnect();
            });
            observer.observe(document.body, { childList: true, subtree: true });

            return () => {
                observer.disconnect();
                resizeObserver?.disconnect();
                currentHost?.remove();
                setHost(null);
            };
        }

        return () => {
            resizeObserver?.disconnect();
            currentHost?.remove();
            setHost(null);
        };
    }, [config]);

    useEffect(() => {
        if (!config) return;

        const scroller = getPageScroller();
        if (!scroller) return;

        let targets = new Map<string, HTMLElement>();

        const resolveTargets = () => {
            const nextTargets = new Map<string, HTMLElement>();
            const firstSectionId = config.sections[0]?.id ?? "";

            for (const section of config.sections) {
                const target = resolveSectionTarget(
                    scroller,
                    section,
                    firstSectionId,
                );
                if (target) nextTargets.set(section.id, target);
            }

            targets = nextTargets;
        };

        const updateActiveSection = () => {
            if (targets.size === 0) resolveTargets();

            const marker = scroller.scrollTop + Math.min(220, scroller.clientHeight * 0.28);
            let active = config.sections[0]?.id ?? null;

            for (const section of config.sections) {
                const target = targets.get(section.id);
                if (!target) continue;

                if (getTargetTop(scroller, target) <= marker) {
                    active = section.id;
                }
            }

            setActiveSectionId(active);
        };

        resolveTargets();
        updateActiveSection();

        const mutationObserver = new MutationObserver(() => {
            resolveTargets();
            updateActiveSection();
        });
        mutationObserver.observe(scroller, { childList: true, subtree: true });

        const resizeObserver = new ResizeObserver(() => {
            resolveTargets();
            updateActiveSection();
        });
        resizeObserver.observe(scroller);

        scroller.addEventListener("scroll", updateActiveSection, {
            passive: true,
        });

        return () => {
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            scroller.removeEventListener("scroll", updateActiveSection);
        };
    }, [config]);

    if (!config || !host) return null;

    const scrollToSection = (section: SectionDefinition) => {
        const scroller = getPageScroller();
        if (!scroller) return;

        const target = resolveSectionTarget(
            scroller,
            section,
            config.sections[0]?.id ?? "",
        );
        if (!target) return;

        setActiveSectionId(section.id);
        scroller.scrollTo({
            top: Math.max(0, getTargetTop(scroller, target) - 18),
            behavior: "smooth",
        });

        if (window.matchMedia("(max-width: 767px)").matches) {
            const closeButton = document.querySelector<HTMLButtonElement>(
                'button[aria-label="Fechar menu"]',
            );
            closeButton?.click();
        }
    };

    return createPortal(
        <div
            className={`${sidebarExpanded ? "block" : "hidden"} mb-1 ml-8 border-l border-slate-200 py-1 pl-3`}
            aria-label={`Seções de ${config.key}`}
        >
            <div className="space-y-0.5">
                {config.sections.map((section) => {
                    const active = activeSectionId === section.id;

                    return (
                        <button
                            key={section.id}
                            type="button"
                            onClick={() => scrollToSection(section)}
                            className={`flex w-full cursor-pointer items-center rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                                active
                                    ? "font-semibold text-brand"
                                    : "font-medium text-slate-500 hover:bg-selection hover:text-slate-700"
                            }`}
                            aria-current={active ? "location" : undefined}
                        >
                            <span
                                className={`mr-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                                    active ? "bg-brand" : "bg-slate-300"
                                }`}
                            />
                            <span className="truncate">{section.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>,
        host,
    );
}
