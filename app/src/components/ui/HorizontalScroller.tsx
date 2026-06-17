// app/src/components/ui/HorizontalScroller.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

type HorizontalScrollerProps = {
    children: ReactNode;
    className?: string;
    scrollAmount?: number;
};

export default function HorizontalScroller({
                                               children,
                                               className = "",scrollAmount = 320,
                                           }: HorizontalScrollerProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);

    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    function updateScrollState() {
        const element = scrollRef.current;
        if (!element) return;

        const scrollLeft = element.scrollLeft;
        const maxScrollLeft = element.scrollWidth - element.clientWidth;

        setCanScrollLeft(scrollLeft > 4);
        setCanScrollRight(scrollLeft < maxScrollLeft - 4);
    }

    function scroll(direction: "left" | "right") {
        const element = scrollRef.current;
        if (!element) return;

        element.scrollBy({
            left: direction === "left" ? -scrollAmount : scrollAmount,
            behavior: "smooth",
        });
    }

    useEffect(() => {
        updateScrollState();

        const element = scrollRef.current;
        if (!element) return;

        element.addEventListener("scroll", updateScrollState);
        window.addEventListener("resize", updateScrollState);

        return () => {
            element.removeEventListener("scroll", updateScrollState);
            window.removeEventListener("resize", updateScrollState);
        };
    }, []);

    return (
        <div className={`relative ${className}`}>
            {canScrollLeft && (
                <>
                    <button
                        type="button"
                        onClick={() => scroll("left")}
                        className="absolute left-0 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-white shadow-sm transition hover:bg-slate-50"
                        style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-muted)",
                        }}
                    >
                        <ChevronLeft size={18} />
                    </button>

                    <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-16 bg-gradient-to-r from-white to-transparent" />
                </>
            )}

            {canScrollRight && (
                <>
                    <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-16 bg-gradient-to-l from-white to-transparent" />

                    <button
                        type="button"
                        onClick={() => scroll("right")}
                        className="absolute right-0 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-white shadow-sm transition hover:bg-slate-50"
                        style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-muted)",
                        }}
                    >
                        <ChevronRight size={18} />
                    </button>
                </>
            )}

            <div
                ref={scrollRef}
                className="scrollbar-hide flex gap-5 overflow-x-auto py-1 pr-12"
            >
                {children}
            </div>
        </div>
    );
}

export const __uiDemo = {
    element: (
        <HorizontalScroller>
            <div className="h-24 min-w-[240px] rounded-2xl border border-border bg-card p-4">
                Item 1
            </div>
            <div className="h-24 min-w-[240px] rounded-2xl border border-border bg-card p-4">
                Item 2
            </div>
            <div className="h-24 min-w-[240px] rounded-2xl border border-border bg-card p-4">
                Item 3
            </div>
        </HorizontalScroller>
    ),
    code: `<HorizontalScroller>
  <KpiCard ... />
  <KpiCard ... />
  <KpiCard ... />
</HorizontalScroller>`,
};