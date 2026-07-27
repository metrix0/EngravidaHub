// components/ui/HoverBadgeList.tsx
"use client";

import { useRef, useState } from "react";

export type HoverBadgeListItem = {
    key: string;
    label: string;
    className?: string;
    title?: string;
    ariaLabel?: string;
    onClick?: () => void;
};

type HoverBadgeListProps = {
    items: HoverBadgeListItem[];
    emptyLabel?: string;
    className?: string;
    badgeClassName?: string;
    expandedBadgeClassName?: string;
    maxBadgeWidthClassName?: string;
    popupMaxWidthClassName?: string;
    popupAlignContainerSelector?: string;
    previewCount?: number;
    overflowIndicatorThreshold?: number;
    overflowLabel?: string;
};

export function HoverBadgeList({
    items,
    emptyLabel = "—",
    className = "",
    badgeClassName = "rounded-full px-2 py-1 text-[11px] font-bold",
    expandedBadgeClassName = "",
    maxBadgeWidthClassName = "max-w-[115px]",
    popupMaxWidthClassName = "max-w-[520px]",
    popupAlignContainerSelector,
    previewCount = 2,
    overflowIndicatorThreshold = Number.POSITIVE_INFINITY,
    overflowLabel = "…",
}: HoverBadgeListProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [side, setSide] = useState<"left" | "right">("left");

    if (items.length === 0) {
        return <span className="text-xs font-medium text-slate-400">{emptyLabel}</span>;
    }

    const normalizedPreviewCount = Math.max(0, previewCount);
    const hiddenCount = Math.max(0, items.length - normalizedPreviewCount);
    const previewItems: HoverBadgeListItem[] =
        items.length > overflowIndicatorThreshold
            ? [
                  ...items.slice(0, normalizedPreviewCount),
                  {
                      key: "__overflow-indicator__",
                      label: overflowLabel,
                      title: `Mais ${hiddenCount} clientes. Passe o mouse para ver todos.`,
                      className: "bg-slate-100 text-slate-600",
                  },
              ]
            : items;

    function handleMouseEnter() {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const popupWidth = 520;

        if (popupAlignContainerSelector) {
            const container = wrapper.closest(popupAlignContainerSelector);

            if (container) {
                const containerRect = container.getBoundingClientRect();
                const spaceRight = containerRect.right - wrapperRect.left;

                setSide(spaceRight < popupWidth ? "right" : "left");
                return;
            }
        }

        const spaceRight = window.innerWidth - wrapperRect.left;
        setSide(spaceRight < popupWidth ? "right" : "left");
    }

    return (
        <div
            ref={wrapperRef}
            onMouseEnter={handleMouseEnter}
            className={`group/badge-list relative min-w-0 max-w-full ${className}`}
        >
            <div className="flex min-w-0 max-w-full flex-nowrap gap-1.5 overflow-hidden">
                {previewItems.map((item) => (
                    <Badge
                        key={item.key}
                        item={item}
                        badgeClassName={badgeClassName}
                        extraClassName={maxBadgeWidthClassName}
                    />
                ))}
            </div>

            <div
                className={`pointer-events-none absolute top-full z-50 pt-2 opacity-0 transition-all duration-150 ease-out group-hover/badge-list:pointer-events-auto group-hover/badge-list:translate-y-0 group-hover/badge-list:scale-100 group-hover/badge-list:opacity-100 ${
                    side === "right" ? "right-0" : "left-0"
                } translate-y-1 scale-[0.98]`}
            >
                <div
                    className={`${popupMaxWidthClassName} rounded-2xl border border-slate-100 bg-white p-3 shadow-xl`}
                >
                    <div className="flex max-w-full flex-wrap gap-1.5">
                        {items.map((item) => (
                            <Badge
                                key={`hover-${item.key}`}
                                item={item}
                                badgeClassName={badgeClassName}
                                extraClassName={expandedBadgeClassName}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Badge({
    item,
    badgeClassName,
    extraClassName,
}: {
    item: HoverBadgeListItem;
    badgeClassName: string;
    extraClassName: string;
}) {
    const className = `inline-flex shrink-0 truncate ${badgeClassName} ${extraClassName} ${
        item.className ?? "bg-slate-100 text-slate-500"
    }`;
    const title = item.title ?? item.label;

    if (item.onClick) {
        return (
            <button
                type="button"
                title={title}
                aria-label={item.ariaLabel ?? title}
                onClick={(event) => {
                    event.stopPropagation();
                    item.onClick?.();
                }}
                className={`${className} cursor-pointer transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25`}
            >
                {item.label}
            </button>
        );
    }

    return (
        <span title={title} className={className}>
            {item.label}
        </span>
    );
}
