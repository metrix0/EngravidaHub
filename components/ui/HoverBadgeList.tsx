// components/ui/HoverBadgeList.tsx
"use client";

import { useLayoutEffect, useRef, useState } from "react";

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
    overflowLabel,
}: HoverBadgeListProps) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const measurementRef = useRef<HTMLDivElement | null>(null);
    const indicatorRef = useRef<HTMLSpanElement | null>(null);
    const [side, setSide] = useState<"left" | "right">("left");
    const [fittingCount, setFittingCount] = useState<number | null>(null);
    const previewLimit = items.length > overflowIndicatorThreshold
        ? Math.min(items.length, Math.max(0, Math.floor(previewCount)))
        : items.length;

    useLayoutEffect(() => {
        const row = rowRef.current, measurement = measurementRef.current, indicator = indicatorRef.current;
        if (!row || !measurement || !indicator) return;

        function measure() {
            if (!row || !measurement || !indicator) return;
            const width = row.clientWidth;
            const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
            const widths = Array.from(measurement.children).map(badge => badge.getBoundingClientRect().width);
            const prefixWidths = [0];
            for (const badgeWidth of widths) prefixWidths.push(prefixWidths[prefixWidths.length - 1] + badgeWidth);
            if (previewLimit === items.length && prefixWidths[previewLimit] + gap * Math.max(0, previewLimit - 1) <= width) {
                setFittingCount(previewLimit);
                return;
            }

            const indicatorWidths = new Map<number, number>();
            for (let count = Math.min(previewLimit, items.length - 1); count >= 0; count--) {
                const digits = String(items.length - count).length;
                if (!indicatorWidths.has(digits)) {
                    indicator.textContent = overflowLabel ?? `+${"9".repeat(digits)}`;
                    indicatorWidths.set(digits, indicator.getBoundingClientRect().width);
                }
                if (count === 0 || prefixWidths[count] + gap * count + indicatorWidths.get(digits)! <= width) {
                    setFittingCount(count);
                    return;
                }
            }
        }

        measure();
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        });
        observer.observe(row);
        for (const badge of measurement.children) observer.observe(badge);
        return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }, [items, previewLimit, badgeClassName, maxBadgeWidthClassName, overflowLabel]);

    if (items.length === 0) {
        return <span className="text-xs font-medium text-slate-400">{emptyLabel}</span>;
    }

    const visibleCount = Math.min(fittingCount ?? previewLimit, previewLimit);
    const hiddenCount = items.length - visibleCount;
    const indicatorClassName = `inline-flex shrink-0 tabular-nums ${badgeClassName} bg-slate-100 text-slate-600`;
    const overflowTitle = `${hiddenCount} ${hiddenCount === 1 ? "item oculto" : "itens ocultos"}. Passe o mouse para ver todos.`;

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
            <div ref={rowRef} className="flex min-w-0 max-w-full flex-nowrap gap-1.5 overflow-hidden">
                {items.slice(0, visibleCount).map((item) => (
                    <Badge
                        key={item.key}
                        item={item}
                        badgeClassName={badgeClassName}
                        extraClassName={maxBadgeWidthClassName}
                    />
                ))}
                {hiddenCount > 0 ? <span className={indicatorClassName} title={overflowTitle} aria-label={overflowTitle}>{overflowLabel ?? `+${hiddenCount}`}</span> : null}
            </div>

            <div aria-hidden="true" inert className="pointer-events-none invisible absolute inset-x-0 top-0 overflow-hidden">
                <div ref={measurementRef} className="flex min-w-0 max-w-full flex-nowrap gap-1.5">
                    {items.slice(0, previewLimit).map(item => <Badge key={item.key} item={item} badgeClassName={badgeClassName} extraClassName={maxBadgeWidthClassName} />)}
                </div>
                <span ref={indicatorRef} className={indicatorClassName}>{overflowLabel ?? `+${items.length}`}</span>
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
