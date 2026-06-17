// app/src/components/dashboard/DashboardHeader.tsx

"use client";

import { ButtonGroup, CalendarButton } from "../index";
import {
    DEFAULT_CALENDAR_PRESETS,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";

type DashboardHeaderProps = {
    title: string;
    description: string;
    period: CalendarPresetValue | null;
    setPeriod: (value: CalendarPresetValue | null) => void;
    selectedRange: DateRange;
    setSelectedRange: (value: DateRange) => void;
    presets?: typeof DEFAULT_CALENDAR_PRESETS;
};

export function DashboardHeader({
                                    title,
                                    description,
                                    period,
                                    setPeriod,
                                    selectedRange,
                                    setSelectedRange,
                                    presets = DEFAULT_CALENDAR_PRESETS,
                                }: DashboardHeaderProps) {
    return (
        <header className="mb-8 flex items-start justify-between">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                    {title}
                </h1>

                <p className="mt-2 text-sm text-slate-500">
                    {description}
                </p>
            </div>

            <ButtonGroup
                value={period}
                onChange={(value) => {
                    setPeriod(value);
                    setSelectedRange({
                        start: null,
                        end: null,
                    });
                }}
                options={presets.map((preset) => ({
                    value: preset.value,
                    label: preset.label,
                }))}
            >
                <CalendarButton
                    value={selectedRange}
                    onChange={setSelectedRange}
                    onApply={(range) => {
                        if (range.start) {
                            setPeriod(null);
                            return;
                        }

                        setPeriod(presets[0]?.value ?? "yesterday");
                    }}
                />
            </ButtonGroup>
        </header>
    );
}