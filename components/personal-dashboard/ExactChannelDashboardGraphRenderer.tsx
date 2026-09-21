"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import InstagramConversationInsights from "@/components/dashboard/InstagramConversationInsights";
import MessengerConversationInsights from "@/components/dashboard/MessengerConversationInsights";
import InstagramAdAttributionInsights from "@/components/dashboard/InstagramAdAttributionInsights";
import DashboardCallInsights from "@/components/dashboard/DashboardCallInsights";
import DashboardWebPageViews from "@/components/dashboard/DashboardWebPageViews";
import {
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";

type Props = {
    widgetId: string;
    period: CalendarPresetValue | null;
    selectedRange: DateRange;
    unitNames: string[];
};

const INSTAGRAM_TITLES: Record<string, string> = {
    "instagram.evolucao_diaria": "Evolução diária do Instagram",
    "instagram.pontos_abandono": "Pontos de abandono",
    "instagram.motivos_abandono": "Motivos prováveis de abandono",
    "instagram.estado_final": "Estado final do cliente",
    "instagram.resultado_resolucao": "Resultado da resolução",
    "instagram.status_objetivo": "Status do objetivo",
    "instagram.intencao_inicial": "Intenção inicial",
    "instagram.objetivo_conversa": "Objetivo da conversa",
    "instagram.sentimento_cliente": "Sentimento do cliente",
    "instagram.dimensoes_qualidade": "Dimensões da qualidade",
    "instagram.objecoes": "Objeções identificadas",
};

const ATTRIBUTION_TITLES: Record<string, string> = {
    "instagram.origem_paga": "Origem paga dos clientes",
    "instagram.clientes_campanha": "Clientes por campanha",
};

const SHARE_TITLES: Record<string, string> = {
    "jornada.participacao_instagram": "Participação do Instagram nas conversas",
    "jornada.participacao_messenger": "Participação do Messenger nas conversas",
};

export default function ExactChannelDashboardGraphRenderer({
    widgetId,
    period,
    selectedRange,
    unitNames,
}: Props) {
    if (widgetId === "ligacoes.evolucao") {
        return (
            <IsolatedSourceCard title="Evolução das ligações">
                <DashboardCallInsights period={period} selectedRange={selectedRange} unitNames={unitNames} />
            </IsolatedSourceCard>
        );
    }

    if (widgetId === "web.site_principal") {
        return (
            <IsolatedSourceCard title="Páginas do site principal">
                <DashboardWebPageViews period={period} selectedRange={selectedRange} />
            </IsolatedSourceCard>
        );
    }

    if (widgetId === "web.landing_pages") {
        return (
            <IsolatedSourceCard title="Performance das landing pages">
                <DashboardWebPageViews period={period} selectedRange={selectedRange} />
            </IsolatedSourceCard>
        );
    }

    if (widgetId === "canais.instagram_conversas") return <InstagramConversationInsights mode="analysis" period={period} selectedRange={selectedRange} />;
    if (widgetId === "canais.messenger_conversas") return <MessengerConversationInsights mode="analysis" period={period} selectedRange={selectedRange} />;
    if (widgetId === "canais.ligacoes") return <DashboardCallInsights period={period} selectedRange={selectedRange} unitNames={unitNames} />;
    if (widgetId === "canais.site") return <DashboardWebPageViews period={period} selectedRange={selectedRange} />;

    if (widgetId === "messenger.evolucao_diaria") {
        return (
            <IsolatedSourceCard title="Evolução diária do Messenger">
                <MessengerConversationInsights
                    mode="analysis"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    const instagramTitle = INSTAGRAM_TITLES[widgetId];
    if (instagramTitle) {
        return (
            <IsolatedSourceCard title={instagramTitle}>
                <InstagramConversationInsights
                    mode="analysis"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    const attributionTitle = ATTRIBUTION_TITLES[widgetId];
    if (attributionTitle) {
        return (
            <IsolatedSourceCard title={attributionTitle}>
                <InstagramAdAttributionInsights
                    searchParams={buildSearchParams(period, selectedRange)}
                />
            </IsolatedSourceCard>
        );
    }

    if (widgetId === "jornada.participacao_instagram") {
        return (
            <IsolatedSourceCard title={SHARE_TITLES[widgetId]}>
                <InstagramConversationInsights
                    mode="share"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    if (widgetId === "jornada.participacao_messenger") {
        return (
            <IsolatedSourceCard title={SHARE_TITLES[widgetId]}>
                <MessengerConversationInsights
                    mode="share"
                    period={period}
                    selectedRange={selectedRange}
                />
            </IsolatedSourceCard>
        );
    }

    return null;
}

function IsolatedSourceCard({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    const rootRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        let frame = 0;
        const isolate = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const heading = [...root.querySelectorAll<HTMLElement>("h1,h2,h3")].find(
                    (element) => element.textContent?.trim() === title,
                );
                const target = heading?.closest<HTMLElement>("[data-dashboard-card='true']");
                if (!target) return;

                let current: HTMLElement = target;
                while (current.parentElement && current.parentElement !== root) {
                    const parent = current.parentElement;
                    for (const sibling of [...parent.children]) {
                        if (sibling !== current && sibling instanceof HTMLElement) {
                            sibling.style.display = "none";
                        }
                    }
                    parent.style.display = "block";
                    parent.style.gridTemplateColumns = "none";
                    parent.style.gap = "0";
                    parent.style.margin = "0";
                    current = parent;
                }
            });
        };

        isolate();
        const observer = new MutationObserver(isolate);
        observer.observe(root, { childList: true, subtree: true });
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [title]);

    return <div ref={rootRef}>{children}</div>;
}

function buildSearchParams(
    period: CalendarPresetValue | null,
    selectedRange: DateRange,
) {
    const params = new URLSearchParams();
    applyCalendarDateParams({
        params,
        selectedRange,
        selectedPreset: period,
    });
    return params.toString();
}






