// lib/performance/report.ts
// Aggregate the existing conversation analyses and Clinisys bookings without guessing identities.
export type PerformanceSource = {
    attendant_aliases?: Array<{ source_name: string; attendant_id: string }>;
    people: Array<{ id: string; name: string; sector: string; active: boolean }>;
    units: Array<{ id: string; name: string }>;
    period: Array<{ attendant_id: string; tickets: number; analyzed: number; first_seconds: number | null; first_count: number; response_seconds: number | null; response_count: number; score: number | null; score_count: number; resolved: number; eligible_resolution: number; partial: number; goal_achieved: number; goal_eligible: number }>;
    monthly: Array<{ attendant_id: string; month: string; tickets: number; analyzed: number; first_seconds: number | null; response_seconds: number | null; score: number | null; resolved: number; partial: number; eligible_resolution: number; goal_achieved: number; goal_eligible: number }>;
    bookings: Array<{ date: string; attendant_name: string | null; unit_name: string | null; appointments: number }>;
};
export type PerformanceMonth = { month: string; tickets: number; appointments: number; firstResponse: number | null; response: number | null; score: number | null; resolved: number; partial: number; eligibleResolution: number; goalAchieved: number; goalEligible: number };
export type PerformanceAttendant = {
    id: string; name: string; sector: string; tickets: number; analyzed: number; appointments: number;
    firstResponse: number | null; firstCount: number; response: number | null; responseCount: number;
    score: number | null; scoreCount: number; resolutionRate: number | null; partiallyResolved: number; eligibleResolution: number; partialResolutionRate: number | null; goalAchieved: number; goalEligible: number; goalAchievementRate: number | null; monthly: PerformanceMonth[];
};
export type PerformanceUnit = { name: string; total: number; ra: number; matched: number; share: number };
export type PerformanceUnitAttribution = { unitName: string; attendantId: string; appointments: number };
export type PerformanceReport = {
    attendants: PerformanceAttendant[];
    units: PerformanceUnit[];
    unitOptions: Array<{ id: string; name: string }>;
    attendantOptions: Array<{ id: string; name: string }>;
    unitAttributions: PerformanceUnitAttribution[];
    coverage: { totalBookings: number; matchedBookings: number; totalTickets: number; analyzedTickets: number };
    months: string[];
};
const STOP_WORDS = new Set(["de", "da", "do", "dos", "das", "e"]);
const tokens = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter(word => word.length > 1 && !STOP_WORDS.has(word));

export function matchPerformanceAttendant(name: string | null, people: PerformanceSource["people"]) {
    if (typeof name !== "string") return null;
    const incoming = tokens(name);
    if (incoming.length < 2) return null;
    // Some Clinisys names separate compound first names (Ana Carolina) that
    // are joined in the Hub (Anacarolina).
    const forms = [incoming, ...incoming.slice(0, -1).map((_, index) =>
        [...incoming.slice(0, index), incoming[index] + incoming[index + 1], ...incoming.slice(index + 2)])];
    const matches = people.filter(person => {
        const candidate = tokens(person.name);
        return candidate.length >= 2 && forms.some(form => candidate.every(word => form.includes(word)));
    });
    return matches.length === 1 ? matches[0] : null;
}

function monthKeys(end: string) {
    const year = Number(end.slice(0, 4)), month = Number(end.slice(5, 7)) - 1;
    return Array.from({ length: 6 }, (_, index) =>
        new Date(Date.UTC(year, month - 5 + index, 1)).toISOString().slice(0, 7));
}

export function buildPerformanceReport(source: PerformanceSource, start: string, end: string): PerformanceReport {
    const months = monthKeys(end);
    const monthStart = months[0];
    const peopleById = new Map(source.people.map(person => [person.id, person]));
    const periodById = new Map(source.period.map(row => [row.attendant_id, row]));
    const monthById = new Map<string, Map<string, PerformanceMonth>>();
    for (const row of source.monthly) {
        if (!peopleById.has(row.attendant_id) || !months.includes(row.month)) continue;
        let group = monthById.get(row.attendant_id);
        if (!group) { group = new Map(); monthById.set(row.attendant_id, group); }
        group.set(row.month, { month: row.month, tickets: Number(row.tickets), appointments: 0,
            firstResponse: row.first_seconds, response: row.response_seconds, score: row.score === null ? null : Number(row.score),
            resolved: Number(row.resolved ?? 0), partial: Number(row.partial ?? 0), eligibleResolution: Number(row.eligible_resolution ?? 0),
            goalAchieved: Number(row.goal_achieved ?? 0), goalEligible: Number(row.goal_eligible ?? 0) });
    }
    const bookingsById = new Map<string, number>();
    const unitsByName = new Map<string, { total: number; ra: number; matched: number }>();
    const unitAttributions = new Map<string, PerformanceUnitAttribution>();
    const resolvedNames = new Map<string | null, PerformanceSource["people"][number] | null>();
    const aliases = new Map((source.attendant_aliases ?? []).map(alias => [alias.source_name, alias.attendant_id]));
    let totalBookings = 0, matchedBookings = 0;
    for (const booking of source.bookings) {
        const amount = Number(booking.appointments);
        if (!resolvedNames.has(booking.attendant_name)) {
            const aliasId = booking.attendant_name === null ? undefined : aliases.get(booking.attendant_name);
            // A verified mapping takes precedence over ambiguous name matching.
            // An alias to an inactive/missing person must not fall through to someone else.
            resolvedNames.set(booking.attendant_name, aliasId !== undefined
                ? peopleById.get(aliasId) ?? null
                : matchPerformanceAttendant(booking.attendant_name, source.people));
        }
        const person = resolvedNames.get(booking.attendant_name) ?? null;
        const inPeriod = booking.date >= start && booking.date <= end;
        if (inPeriod) {
            totalBookings += amount;
            if (person) { matchedBookings += amount; bookingsById.set(person.id, (bookingsById.get(person.id) ?? 0) + amount); }
            const unitName = booking.unit_name?.trim() || "Unidade não informada";
            if (person) {
                const key = person.id + "|" + unitName;
                const attribution = unitAttributions.get(key) ?? { unitName, attendantId: person.id, appointments: 0 };
                attribution.appointments += amount;
                unitAttributions.set(key, attribution);
            }
            const unit = unitsByName.get(unitName) ?? { total: 0, ra: 0, matched: 0 };
            unit.total += amount;
            if (person) { unit.matched += amount; if (person.sector === "ra") unit.ra += amount; }
            unitsByName.set(unitName, unit);
        }
        if (person && booking.date.slice(0, 7) >= monthStart && booking.date <= end) {
            let group = monthById.get(person.id);
            if (!group) { group = new Map(); monthById.set(person.id, group); }
            const key = booking.date.slice(0, 7);
            const row = group.get(key) ?? { month: key, tickets: 0, appointments: 0, firstResponse: null, response: null, score: null, resolved: 0, partial: 0, eligibleResolution: 0, goalAchieved: 0, goalEligible: 0 };
            row.appointments += amount;
            group.set(key, row);
        }
    }
    const attendants = source.people.map(person => {
        const period = periodById.get(person.id);
        const ticketCount = Number(period?.tickets ?? 0);
        const appointmentCount = bookingsById.get(person.id) ?? 0;
        const eligibleResolution = Number(period?.eligible_resolution ?? 0);
        const partiallyResolved = Number(period?.partial ?? 0);
        const goalEligible = Number(period?.goal_eligible ?? 0);
        const goalAchieved = Number(period?.goal_achieved ?? 0);
        return {
            id: person.id, name: person.name, sector: person.sector,
            tickets: ticketCount, analyzed: Number(period?.analyzed ?? 0), appointments: appointmentCount,
            firstResponse: period?.first_seconds ?? null, firstCount: Number(period?.first_count ?? 0),
            response: period?.response_seconds ?? null, responseCount: Number(period?.response_count ?? 0),
            score: period?.score === null || period?.score === undefined ? null : Number(period.score),
            scoreCount: Number(period?.score_count ?? 0),
            resolutionRate: eligibleResolution ? Math.round(1000 * Number(period?.resolved ?? 0) / eligibleResolution) / 10 : null,
            partiallyResolved, eligibleResolution, partialResolutionRate: eligibleResolution ? Math.round(1000 * partiallyResolved / eligibleResolution) / 10 : null,
            goalAchieved, goalEligible, goalAchievementRate: goalEligible ? Math.round(1000 * goalAchieved / goalEligible) / 10 : null,
            monthly: months.map(month => monthById.get(person.id)?.get(month) ?? { month, tickets: 0, appointments: 0, firstResponse: null, response: null, score: null, resolved: 0, partial: 0, eligibleResolution: 0, goalAchieved: 0, goalEligible: 0 }),
        };
    }).filter(person => person.tickets > 0 || person.appointments > 0);
    const units = [...unitsByName.entries()].map(([name, value]) =>
        ({ name, ...value, share: value.total ? 100 * value.ra / value.total : 0 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));
    return {
        attendants, units, months,
        unitOptions: source.units,
        attendantOptions: source.people.map(person => ({ id: person.id, name: person.name })),
        unitAttributions: [...unitAttributions.values()],
        coverage: {
            totalBookings, matchedBookings,
            totalTickets: attendants.reduce((count, person) => count + person.tickets, 0),
            analyzedTickets: attendants.reduce((count, person) => count + person.analyzed, 0),
        },
    };
}
