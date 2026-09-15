"use client";

import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

import DashboardAddControl from "@/components/personal-dashboard/DashboardAddControl";

type PortalTarget = {
    key: string;
    widgetId: string;
    element: HTMLElement;
};

const ATENDIMENTO_GROUPS = [
    ["dashboard-instagram", "canais.instagram_conversas"],
    ["dashboard-messenger", "canais.messenger_conversas"],
    ["dashboard-ligacoes", "canais.ligacoes"],
] as const;

const MESSAGE_HEADINGS = [
    ["Templates utilizados", "mensagem_ativa.templates_utilizados"],
    ["Volume e resultados", "mensagem_ativa.volume_resultados"],
    ["Histórico de envios", "mensagem_ativa.historico_envios"],
] as const;

export default function DashboardWidgetPortalControls() {
    const pathname = usePathname();
    const [targets, setTargets] = useState<PortalTarget[]>([]);

    useEffect(() => {
        if (
            pathname !== "/atendimento" &&
            pathname !== "/financeiro" &&
            pathname !== "/mensagem-ativa"
        ) {
            setTargets([]);
            return;
        }

        let frame = 0;
        const scan = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const next =
                    pathname === "/atendimento"
                        ? findAtendimentoTargets()
                        : pathname === "/financeiro"
                          ? findFinanceiroTargets()
                          : findMensagemAtivaTargets();
                for (const target of next) {
                    target.element.classList.add(
                        "relative",
                        "group/dashboard-widget",
                    );
                }
                setTargets(next);
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

function findAtendimentoTargets(): PortalTarget[] {
    const targets: PortalTarget[] = [];

    for (const [sectionId, widgetId] of ATENDIMENTO_GROUPS) {
        const section = document.getElementById(sectionId);
        if (!section) continue;
        targets.push({ key: sectionId, widgetId, element: section });
    }

    const siteHeading = findHeading("Páginas web");
    const siteRoot = siteHeading?.closest("div.min-w-0.space-y-5") as
        | HTMLElement
        | null;
    if (siteRoot) {
        targets.push({
            key: "atendimento-site",
            widgetId: "canais.site",
            element: siteRoot,
        });
    }

    return targets;
}

function findFinanceiroTargets(): PortalTarget[] {
    const label = findExactElement("span", "Faturamento autorizado");
    const card = label?.closest('[data-dashboard-card="true"]') as
        | HTMLElement
        | null;

    return card
        ? [
              {
                  key: "financeiro-faturamento-autorizado",
                  widgetId: "financeiro.faturamento_autorizado",
                  element: card,
              },
          ]
        : [];
}

function findMensagemAtivaTargets(): PortalTarget[] {
    const targets: PortalTarget[] = [];

    for (const [headingText, widgetId] of MESSAGE_HEADINGS) {
        const heading = findHeading(headingText);
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

function findHeading(text: string) {
    return findExactElement("h2, h3", text);
}

function findExactElement(selector: string, text: string) {
    return [...document.querySelectorAll<HTMLElement>(selector)].find(
        (element) => element.textContent?.trim() === text,
    );
}
