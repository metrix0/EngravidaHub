// components/ui/InfoTooltip.tsx
"use client";

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type TooltipPosition = "top" | "bottom";
type TooltipAlign = "left" | "center" | "right";

type InfoTooltipProps = {
    children: ReactNode;
    text: string;
    portal?: boolean;
    widthClassName?: string;
};

type PortalPosition = {
    left: number;
    top: number;
};

const VIEWPORT_MARGIN = 12;
const TOOLTIP_GAP = 8;

export default function InfoTooltip({
                                        children,
                                        text,
                                        portal = false,
                                        widthClassName = "w-[320px]",
                                    }: InfoTooltipProps) {
    const wrapperRef = useRef<HTMLSpanElement | null>(null);
    const tooltipRef = useRef<HTMLSpanElement | null>(null);

    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<TooltipPosition>("bottom");
    const [align, setAlign] = useState<TooltipAlign>("center");
    const [portalPosition, setPortalPosition] = useState<PortalPosition>({
        left: VIEWPORT_MARGIN,
        top: VIEWPORT_MARGIN,
    });

    const updatePosition = useCallback(() => {
        const element = wrapperRef.current;
        if (!element) return;

        const rect = element.getBoundingClientRect();

        if (portal) {
            const tooltipWidth = tooltipRef.current?.offsetWidth ?? 320;
            const tooltipHeight = tooltipRef.current?.offsetHeight ?? 160;
            const maxLeft = Math.max(
                VIEWPORT_MARGIN,
                window.innerWidth - tooltipWidth - VIEWPORT_MARGIN,
            );
            const left = Math.min(
                Math.max(
                    rect.left + rect.width / 2 - tooltipWidth / 2,
                    VIEWPORT_MARGIN,
                ),
                maxLeft,
            );
            const showAbove =
                window.innerHeight - rect.bottom < tooltipHeight + TOOLTIP_GAP &&
                rect.top > window.innerHeight - rect.bottom;
            const top = showAbove
                ? rect.top - tooltipHeight - TOOLTIP_GAP
                : rect.bottom + TOOLTIP_GAP;
            const maxTop = Math.max(
                VIEWPORT_MARGIN,
                window.innerHeight - tooltipHeight - VIEWPORT_MARGIN,
            );

            setPortalPosition({
                left,
                top: Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop),
            });
            return;
        }

        const spaceRight = window.innerWidth - rect.right;
        const spaceLeft = rect.left;
        const spaceBottom = window.innerHeight - rect.bottom;
        const spaceTop = rect.top;

        if (spaceRight < 180) {
            setAlign("right");
        } else if (spaceLeft < 180) {
            setAlign("left");
        } else {
            setAlign("center");
        }

        if (spaceBottom < 160 && spaceTop > spaceBottom) {
            setPosition("top");
        } else {
            setPosition("bottom");
        }
    }, [portal]);

    useLayoutEffect(() => {
        if (open && portal) updatePosition();
    }, [open, portal, updatePosition]);

    useEffect(() => {
        if (!open || !portal) return;

        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [open, portal, updatePosition]);

    function handleOpen() {
        updatePosition();
        setOpen(true);
    }

    const positionClass =
        position === "bottom"
            ? "top-7"
            : "bottom-7";

    const alignClass = {
        left: "left-0",
        center: "left-1/2 -translate-x-1/2",
        right: "right-0",
    }[align];

    const tooltip = (
        <span
            ref={tooltipRef}
            className={
                portal
                    ? `pointer-events-none fixed z-[100] rounded-xl border bg-white px-4 py-3 text-xs font-normal leading-relaxed text-slate-600 shadow-lg transition-opacity duration-150 ${
                          open ? "opacity-100" : "opacity-0"
                      } ${widthClassName}`
                    : `absolute ${positionClass} ${alignClass} z-50 rounded-xl border bg-white px-4 py-3 text-xs font-normal leading-relaxed text-slate-600 shadow-lg transition-all duration-150 ${
                          open
                              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                              : "pointer-events-none -translate-y-1 scale-95 opacity-0"
                      } ${widthClassName}`
            }
            style={{
                borderColor: "var(--color-border)",
                ...(portal
                    ? {
                          ...portalPosition,
                          maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
                      }
                    : {}),
            }}
        >
            {text}
        </span>
    );

    return (
        <span
            ref={wrapperRef}
            className="relative inline-flex"
            onMouseEnter={handleOpen}
            onMouseLeave={() => setOpen(false)}
        >
            <span className="inline-flex cursor-help">{children}</span>
            {portal
                ? open && typeof document !== "undefined"
                    ? createPortal(tooltip, document.body)
                    : null
                : tooltip}
        </span>
    );
}

export const __uiDemo = {
    element: (
        <InfoTooltip text="Explicação rápida sobre essa métrica.">
            <span className="text-slate-400">?</span>
        </InfoTooltip>
    ),
    code: `<InfoTooltip text="Explicação rápida sobre essa métrica.">
  <HelpCircle size={16} />
</InfoTooltip>`,
};
