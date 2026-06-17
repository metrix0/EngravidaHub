// components/ui/Card.tsx
import type { ReactNode } from "react";

type CardProps = {
    children: ReactNode;
    className?: string;
};

export default function Card({ children, className = "" }: CardProps) {
    return (
        <div
            className={`rounded-2xl border-1 p-6 shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${className}`}
            style={{
                backgroundColor: "var(--color-card)",
                borderColor: "var(--color-border)",
            }}
        >
            {children}
        </div>
    );
}

export const __uiDemo = {
    element: (
        <Card>
            <div className="font-semibold">Card content</div>
            <p className="text-sm text-slate-500">Example card.</p>
        </Card>
    ),
    code: `<Card>
  <div>Card content</div>
</Card>`,
};
