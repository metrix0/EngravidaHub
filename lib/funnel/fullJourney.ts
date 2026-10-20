import type { CalendarPreset } from "@/components/ui/CalendarButton";
import { classifyClinisysJourneyProcedure } from "@/lib/funnel/clinisysJourney";

export const JOURNEY_CALENDAR_PRESETS: CalendarPreset[] = [
    { label: "90 a 30 dias atrás", value: "mature_journey", startOffsetDays: -90, endOffsetDays: -30 },
    { label: "Mês anterior", value: "previous_month", startOffsetDays: 0, endOffsetDays: 0 },
    { label: "2 meses anteriores", value: "previous_two_months", startOffsetDays: 0, endOffsetDays: 0 },
];

export function getMatureJourneyRange(now = new Date()) {
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    const offset = (days: number) => {
        const day = new Date(`${today}T12:00:00Z`);
        day.setUTCDate(day.getUTCDate() + days);
        return day.toISOString().slice(0, 10);
    };
    return { start_date: offset(-90), end_date: offset(-30) };
}

export function journeyProcedureKind(event: { event_kind: string | null; procedure_name: string | null }) {
    if (event.event_kind === "evaluation" || event.event_kind === "procedure") return event.event_kind;
    // Preserve the Hub classification; unnamed appointments remain counted.
    return classifyClinisysJourneyProcedure(event.procedure_name) ?? "procedure";
}
