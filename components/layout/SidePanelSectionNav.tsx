"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    dynamicSections?: "unit-headings";
    firstSectionUsesScroller?: boolean;
};

const DASHBOARD_SECTIONS: SectionDefinition[] = [
    { id: "dashboard-conversas", label: "Conversas" },
    {
        id: "dashboard-consultas",
        label: "Consultas",
        heading: "Consultas",
    },
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
        id: "financeiro-midia-paga",
        label: "Mídia paga",
        heading: "Mídia paga",
    },
];

function getNavigationConfig(pathname: string): SectionNavigationConfig | null {
    if (pathname === "/atendimento") {
        return {
            key: "dashboard",
            parentHref: "/atendimento",
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

    if (pathname === "/unidades") {
        return {
            key: "unidades",
            parentHref: "/unidades",
            sections: [],
            dynamicSections: "unit-headings",
            firstSectionUsesScroller: false,
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

function getResolvedSections(
    config: SectionNavigationConfig,
    scroller: HTMLElement,
) {
    if (config.dynamicSections !== "unit-headings") {
        return config.sections;
    }

    return [...scroller.querySelectorAll<HTMLElement>("aside h2")].flatMap(
        (heading, index) => {
            const label = heading.textContent?.trim();
            return label
                ? [{ id: `unidades-${index}`, label, heading: label }]
                : [];
        },
    );
}

function sameSections(
    current: SectionDefinition[],
    next: SectionDefinition[],
) {
    return (
        current.length === next.length &&
        current.every(
            (section, index) =>
                section.id === next[index]?.id &&
                section.label === next[index]?.label &&
                section.heading === next[index]?.heading,
        )
    );
}

function findDashboardChannelTarget(
    scroller: HTMLElement,
    sectionId: string,
) {
    const channelIndex = {
        "dashboard-instagram": 0,
        "dashboard-messenger": 1,
        "dashboard-ligacoes": 2,
    }[sectionId];

    if (channelIndex === undefined) return null;

    const channelSections = scroller.querySelectorAll<HTMLElement>(
        "section.mt-6.min-w-0.max-w-full",
    );
    return channelSections[channelIndex] ?? null;
}

function resolveSectionTarget(
    scroller: HTMLElement,
    section: SectionDefinition,
    firstSectionId: string,
    firstSectionUsesScroller = true,
) {
    if (section.id === firstSectionId && firstSectionUsesScroller) {
        return scroller;
    }

    const explicitTarget = scroller.querySelector<HTMLElement>(`#${section.id}`);
    if (explicitTarget) {
        return explicitTarget;
    }

    if (!section.heading) {
        return scroller;
    }

    const heading = findHeading(scroller, section.heading);
    if (heading) {
        return heading.closest<HTMLElement>("section") ?? heading;
    }

    return findDashboardChannelTarget(scroller, section.id);
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

function releaseScrollSpyLock(
    scrollSpyLockRef: { current: string | null },
    sectionId: string,
    scroller: HTMLElement,
) {
    window.setTimeout(() => {
        if (scrollSpyLockRef.current === sectionId) {
            scrollSpyLockRef.current = null;
            scroller.dispatchEvent(new Event("scroll"));
        }
    }, 800);
}

export default function SidePanelSectionNav() {
    const pathname = usePathname();
    const config = useMemo(() => getNavigationConfig(pathname), [pathname]);
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    const [sectionsVisible, setSectionsVisible] = useState(false);
    const [manuallyCollapsed, setManuallyCollapsed] = useState(false);
    const [scrollContainerVersion, setScrollContainerVersion] = useState(0);
    const [sections, setSections] = useState<SectionDefinition[]>(
        config?.sections ?? [],
    );
    const [activeSectionId, setActiveSectionId] = useState<string | null>(
        config?.sections[0]?.id ?? null,
    );
    const scrollSpyLockRef = useRef<string | null>(null);
    const pendingSectionRef = useRef<string | null>(null);

    useEffect(() => {
        setSections(config?.sections ?? []);
        setManuallyCollapsed(false);
    }, [config]);

    useEffect(() => {
        scrollSpyLockRef.current = null;
        pendingSectionRef.current = null;
        setActiveSectionId(sections[0]?.id ?? null);
    }, [config?.key, sections]);

    useEffect(() => {
        if (!config) {
            setHost(null);
            return;
        }

        let currentHost: HTMLDivElement | null = null;
        let resizeObserver: ResizeObserver | null = null;
        let removeParentClickListener: (() => void) | null = null;
        let previousSidebarWidth: number | null = null;

        const install = () => {
            if (currentHost?.isConnected) return true;

            const aside = document.querySelector<HTMLElement>("aside");
            const nav = aside?.querySelector<HTMLElement>("nav");
            if (!aside || !nav) return false;

            const parentLink = findParentLink(nav, config.parentHref);
            if (!parentLink) return false;

            const handleParentClick = (event: MouseEvent) => {
                if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                ) {
                    return;
                }

                const mobile = window.matchMedia("(max-width: 767px)").matches;
                if (!mobile && aside.getBoundingClientRect().width < 180) return;

                event.preventDefault();
                setManuallyCollapsed((collapsed) => !collapsed);
            };

            parentLink.addEventListener("click", handleParentClick);
            removeParentClickListener = () =>
                parentLink.removeEventListener("click", handleParentClick);

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
                const sidebarWidth = aside.getBoundingClientRect().width;
                const isCollapsing =
                    previousSidebarWidth !== null &&
                    sidebarWidth < previousSidebarWidth;

                setSidebarExpanded(
                    mobile || (!isCollapsing && sidebarWidth >= 180),
                );
                previousSidebarWidth = sidebarWidth;
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
                removeParentClickListener?.();
                currentHost?.remove();
                setHost(null);
            };
        }

        return () => {
            resizeObserver?.disconnect();
            removeParentClickListener?.();
            currentHost?.remove();
            setHost(null);
        };
    }, [config]);

    useEffect(() => {
        if (!host || !sidebarExpanded || manuallyCollapsed) {
            setSectionsVisible(false);
            return;
        }

        setSectionsVisible(false);
        let secondFrame = 0;
        const firstFrame = window.requestAnimationFrame(() => {
            secondFrame = window.requestAnimationFrame(() => {
                setSectionsVisible(true);
            });
        });

        return () => {
            window.cancelAnimationFrame(firstFrame);
            if (secondFrame) window.cancelAnimationFrame(secondFrame);
        };
    }, [host, sidebarExpanded, config?.key, manuallyCollapsed]);

    useEffect(() => {
        if (!config || getPageScroller()) return;

        const appContent = document.querySelector<HTMLElement>(".app-content");
        if (!appContent) return;

        const observer = new MutationObserver(() => {
            if (!getPageScroller()) return;

            observer.disconnect();
            setScrollContainerVersion((version) => version + 1);
        });
        observer.observe(appContent, { childList: true, subtree: true });

        return () => observer.disconnect();
    }, [config]);

    useEffect(() => {
        if (!config?.dynamicSections) return;

        const scroller = getPageScroller();
        if (!scroller) return;

        const refreshSections = () => {
            const nextSections = getResolvedSections(config, scroller);
            setSections((current) =>
                sameSections(current, nextSections) ? current : nextSections,
            );
        };

        refreshSections();
        const observer = new MutationObserver(refreshSections);
        observer.observe(scroller, { childList: true, subtree: true });

        return () => observer.disconnect();
    }, [config, scrollContainerVersion]);

    useEffect(() => {
        if (!config || sections.length === 0) return;

        const scroller = getPageScroller();
        if (!scroller) return;

        let targets = new Map<string, HTMLElement>();

        const resolveTargets = () => {
            const nextTargets = new Map<string, HTMLElement>();
            const firstSectionId = sections[0]?.id ?? "";

            for (const section of sections) {
                const target = resolveSectionTarget(
                    scroller,
                    section,
                    firstSectionId,
                    config.firstSectionUsesScroller !== false,
                );
                if (target) nextTargets.set(section.id, target);
            }

            targets = nextTargets;
        };

        const scrollPendingSectionIfReady = () => {
            const pendingSectionId = pendingSectionRef.current;
            if (!pendingSectionId) return false;

            const target = targets.get(pendingSectionId);
            if (!target) return false;

            pendingSectionRef.current = null;
            scrollSpyLockRef.current = pendingSectionId;
            setActiveSectionId(pendingSectionId);
            scroller.scrollTo({
                top: Math.max(0, getTargetTop(scroller, target) - 18),
                behavior: "smooth",
            });
            releaseScrollSpyLock(scrollSpyLockRef, pendingSectionId, scroller);
            return true;
        };

        const updateActiveSection = () => {
            if (pendingSectionRef.current) {
                setActiveSectionId(pendingSectionRef.current);
                return;
            }

            if (scrollSpyLockRef.current) {
                setActiveSectionId(scrollSpyLockRef.current);
                return;
            }

            if (targets.size === 0) resolveTargets();

            const marker = scroller.scrollTop + Math.min(220, scroller.clientHeight * 0.28);
            let active = sections[0]?.id ?? null;

            for (const section of sections) {
                const target = targets.get(section.id);
                if (!target) continue;

                if (getTargetTop(scroller, target) <= marker) {
                    active = section.id;
                }
            }

            setActiveSectionId(active);
        };

        const refreshTargetsAndSelection = () => {
            resolveTargets();
            if (!scrollPendingSectionIfReady()) {
                updateActiveSection();
            }
        };

        refreshTargetsAndSelection();

        const mutationObserver = new MutationObserver(
            refreshTargetsAndSelection,
        );
        mutationObserver.observe(scroller, { childList: true, subtree: true });

        const resizeObserver = new ResizeObserver(
            refreshTargetsAndSelection,
        );
        resizeObserver.observe(scroller);

        scroller.addEventListener("scroll", updateActiveSection, {
            passive: true,
        });

        return () => {
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            scroller.removeEventListener("scroll", updateActiveSection);
        };
    }, [config, scrollContainerVersion, sections]);

    if (!config || !host) return null;

    const scrollToSection = (section: SectionDefinition) => {
        const scroller = getPageScroller();
        if (!scroller) return;

        const target = resolveSectionTarget(
            scroller,
            section,
            sections[0]?.id ?? "",
            config.firstSectionUsesScroller !== false,
        );

        setActiveSectionId(section.id);

        if (!target) {
            pendingSectionRef.current = section.id;
            scrollSpyLockRef.current = section.id;
        } else {
            pendingSectionRef.current = null;
            scrollSpyLockRef.current = section.id;
            scroller.scrollTo({
                top: Math.max(0, getTargetTop(scroller, target) - 18),
                behavior: "smooth",
            });
            releaseScrollSpyLock(scrollSpyLockRef, section.id, scroller);
        }

        if (window.matchMedia("(max-width: 767px)").matches) {
            const closeButton = document.querySelector<HTMLButtonElement>(
                'button[aria-label="Fechar menu"]',
            );
            closeButton?.click();
        }
    };

    const expandedHeight = sections.length * 37 + 12;

    return createPortal(
        <div
            className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out ${
                sectionsVisible
                    ? "translate-y-0 opacity-100"
                    : "pointer-events-none -translate-y-2 opacity-0"
            }`}
            style={{ maxHeight: sectionsVisible ? `${expandedHeight}px` : "0px" }}
            aria-label={`Seções de ${config.key}`}
            aria-hidden={!sectionsVisible}
        >
            <div className="mb-1 ml-8 border-l border-slate-200 py-1 pl-3">
                <div className="space-y-0.5">
                    {sections.map((section) => {
                        const active = activeSectionId === section.id;

                        return (
                            <button
                                key={section.id}
                                type="button"
                                onClick={() => scrollToSection(section)}
                                className={`flex w-full cursor-pointer items-center rounded-lg px-2 py-2 text-left text-xs transition-colors duration-200 ${
                                    active
                                        ? "font-semibold text-brand"
                                        : "font-medium text-slate-500 hover:bg-selection hover:text-slate-700"
                                }`}
                                aria-current={active ? "location" : undefined}
                            >
                                <span
                                    className={`mr-2 h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200 ${
                                        active ? "bg-brand" : "bg-slate-300"
                                    }`}
                                />
                                <span className="truncate">{section.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>,
        host,
    );
}