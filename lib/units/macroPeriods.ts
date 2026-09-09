import type { UnitAnalysisType } from "@/types/unit-macro-analysis";

export function brazilDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDateDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function analysisPeriod(type: UnitAnalysisType, end = brazilDate()) {
  const date = new Date(`${end}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== end
  )
    throw new Error("Data inválida.");
  if (type === "weekly")
    return { period_start: addDateDays(end, -7), period_end: end };
  // Monthly cutoffs are the 30th, or the last day of February.
  const previousMonthLastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0),
  ).getUTCDate();
  const currentLastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const isMonthlyCutoff = date.getUTCDate() === Math.min(30, currentLastDay);
  const startDay = Math.min(
    isMonthlyCutoff ? 30 : date.getUTCDate(),
    previousMonthLastDay,
  );
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, startDay, 12),
  );
  return { period_start: start.toISOString().slice(0, 10), period_end: end };
}

export function dueAnalysisTypes(date = brazilDate()): UnitAnalysisType[] {
  const value = new Date(`${date}T12:00:00Z`);
  const lastDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const types: UnitAnalysisType[] = [];
  if (value.getUTCDate() === Math.min(30, lastDay)) types.push("monthly");
  if (value.getUTCDay() === 0) types.push("weekly");
  return types;
}
