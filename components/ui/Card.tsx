"use client";

import { usePathname } from "next/navigation";
import {
    Children,
    isValidElement,
    type ReactElement,
    type ReactNode,
} from "react";

import DashboardAddControl from "@/components/personal-dashboard/DashboardAddControl";
import { useInsideDashboardWidgetBoundary } from "@/components/personal-dashboard/DashboardWidget";
import { findDashboardWidgetBySource } from "@/lib/personal-dashboard/registryExtended";

type CardProps = {
    children: ReactNode;
    className?: string;
};

export default function Card({ children, className = "" }: CardProps) {
    const pathname = usePathname();
    const insideDashboardWidget = useInsideDashboardWidgetBoundary();
    const widgetId = insideDashboardWidget
        ? null
        : findCardWidgetId(pathname, children);

    return (
        <div
            data-dashboard-card="true"
            className={`group/dashboard-widget relative rounded-2xl border-1 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:p-6 ${className}`}
            style={{
                backgroundColor: "var(--color-card)",
                borderColor: "var(--color-border)",
            }}
        >
            {children}
            {widgetId ? <DashboardAddControl widgetId={widgetId} /> : null}
        </div>
    );
}

function findCardWidgetId(pathname: string, children: ReactNode) {
    for (const title of collectCandidateTitles(children)) {
        const widget = findDashboardWidgetBySource(pathname, title);
        if (widget) return widget.id;
    }
    return null;
}

function collectCandidateTitles(node: ReactNode): string[] {
    const titles: string[] = [];

    Children.forEach(node, (child) => {
        if (!isValidElement(child)) return;
        const element = child as ReactElement<{
            title?: unknown;
            children?: ReactNode;
        }>;

        if (typeof element.props.title === "string") {
            titles.push(element.props.title);
        }

        if (
            typeof element.type === "string" &&
            /^h[1-3]$/.test(element.type)
        ) {
            const text = flattenText(element.props.children).trim();
            if (text) titles.push(text);
        }

        titles.push(...collectCandidateTitles(element.props.children));
    });

    return titles;
}

function flattenText(node: ReactNode): string {
    if (typeof node === "string" || typeof node === "number") {
        return String(node);
    }

    let text = "";
    Children.forEach(node, (child) => {
        if (typeof child === "string" || typeof child === "number") {
            text += String(child);
        } else if (isValidElement(child)) {
            text += flattenText(
                (child as ReactElement<{ children?: ReactNode }>).props.children,
            );
        }
    });
    return text;
}

export const __uiDemo = {
    element: (
        <Card>
            <div className="font-semibold">Card content</div>
            <p className="text-sm text-slate-500">Example card.</p>
        </Card>
    ),
    code: `<Card>\n  <div>Card content</div>\n</Card>`,
};
