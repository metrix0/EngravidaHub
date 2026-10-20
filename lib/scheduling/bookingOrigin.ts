// lib/scheduling/bookingOrigin.ts
export type BookingTeam = "ra" | "unit" | null;
export const AGENDA_COLORS = { available: "#16a34a", ra: "#2563eb", unit: "#e4459b", unknown: "#64748b", blocked: "#ef4444", cancelled: "#e43535", open: "#e29229" };
export const bookingTeamLabel = (team: BookingTeam | undefined) => team === "ra" ? "Agendado RA" : team === "unit" ? "Agendado Unidade" : "Agendado · origem não identificada";
export const sectorBookingTeam = (sector?: string | null): BookingTeam => sector === "ra" ? "ra" : ["reception", "assistance", "management", "finance"].includes(sector ?? "") ? "unit" : null;
const tokens = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter(token => token.length > 1 && !["de", "da", "do", "dos", "das"].includes(token));
export function teamForAttendantName(name: string, attendants: Array<{ id: string; name: string; team: BookingTeam }>): BookingTeam {
    const wanted = tokens(name);
    if (wanted.length < 2) return null;
    const exact = attendants.filter(row => tokens(row.name).join(" ") === wanted.join(" "));
    if (exact.length === 1) return exact[0].team;
    if (exact.length > 1) return null;
    const matches = attendants.filter(row => { const candidate = tokens(row.name); return candidate.length >= 2 && (candidate.every(token => wanted.includes(token)) || wanted.every(token => candidate.includes(token))); });
    return matches.length === 1 ? matches[0].team : null;
}
