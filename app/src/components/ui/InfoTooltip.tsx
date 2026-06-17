// app/src/components/ui/InfoTooltip.tsx
"use client";

import { useRef, useState, type ReactNode } from "react";

type TooltipPosition = "top" | "bottom";
type TooltipAlign = "left" | "center" | "right";

type InfoTooltipProps = {
    children: ReactNode;
    text: string;
    widthClassName?: string;
};

export default function InfoTooltip({
                                        children,
                                        text,
                                        widthClassName = "w-[320px]",
                                    }: InfoTooltipProps) {
    const wrapperRef = useRef<HTMLSpanElement | null>(null);

    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<TooltipPosition>("bottom");
    const [align, setAlign] = useState<TooltipAlign>("center");

    function updatePosition() {
        const element = wrapperRef.current;
        if (!element) return;

        const rect = element.getBoundingClientRect();

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
    }

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

    return (
        <span
            ref={wrapperRef}
            className="relative inline-flex"
            onMouseEnter={handleOpen}
            onMouseLeave={() => setOpen(false)}
        >
            <span className="inline-flex cursor-help">{children}</span>

            <span
                className={`absolute ${positionClass} ${alignClass} z-50 rounded-xl border bg-white px-4 py-3 text-xs font-normal leading-relaxed text-slate-600 shadow-lg transition-all duration-150 ${
                    open
                        ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none -translate-y-1 scale-95 opacity-0"
                } ${widthClassName}`}
                style={{ borderColor: "var(--color-border)" }}
            >
                {text}
            </span>
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