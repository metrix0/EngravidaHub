// components/scheduling/FivAutomationBox.tsx
"use client";

import { Funnel } from "lucide-react";

type FivAutomationBoxProps = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
};

export default function FivAutomationBox({
    checked,
    onChange,
    disabled = false,
}: FivAutomationBoxProps) {
    return (
        <label
            className={`group grid w-full grid-cols-[minmax(0,1fr)_24px] items-center rounded-xl border px-4 py-4 text-left transition ${
                checked
                    ? "cursor-pointer border-purple/20 bg-purple-soft/60 hover:bg-purple-soft"
                    : "cursor-pointer border-slate-200 bg-slate-50 hover:bg-slate-100"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
            <div className="min-w-0">
                <div
                    className={`mb-1 flex items-center gap-2 text-sm font-bold ${
                        checked ? "text-purple" : "text-slate-500"
                    }`}
                >
                    <Funnel size={16} />
                    <span>Adicionar ao Funil FIV</span>
                </div>
                <div className="text-xs leading-relaxed text-slate-500">
                    O cliente será movido automaticamente para a primeira etapa,
                    Avaliação Agendada.
                </div>
            </div>

            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                className="h-4 w-4 cursor-pointer accent-purple disabled:cursor-not-allowed"
                aria-label="Adicionar cliente ao Funil FIV"
            />
        </label>
    );
}
