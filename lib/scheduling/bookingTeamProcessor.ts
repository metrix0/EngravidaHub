import { supabase } from "@/lib/supabase/client";
import { teamForAttendantName, type BookingTeam } from "./bookingOrigin";

type BookingCandidate = {
    id: string;
    booking_team?: BookingTeam;
    source_external_id?: string | null;
};

type ResolutionOptions = {
    inferHistory?: boolean;
    recordAttempt?: boolean;
};

const BATCH_SIZE = 24;
const RPC_BATCH_SIZE = 6;
const RECHECK_HOURS = 24;

// This runs only during ingestion or in the background, never in an agenda GET.
export async function processPendingBookingTeams() {
    const retryBefore = new Date(Date.now() - RECHECK_HOURS * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("appointments")
        .select("id,source_external_id,booking_team")
        .eq("source", "clinisys")
        .is("booking_team", null)
        .or("booking_team_checked_at.is.null,booking_team_checked_at.lt." + retryBefore)
        .order("booking_team_checked_at", { ascending: true, nullsFirst: true })
        .order("starts_at", { ascending: false })
        .limit(BATCH_SIZE);
    if (error) throw error;
    return persistResolvedBookingTeams(data ?? [], { inferHistory: true, recordAttempt: true });
}

export async function persistResolvedBookingTeams(
    appointments: BookingCandidate[],
    { inferHistory = false, recordAttempt = false }: ResolutionOptions = {},
) {
    const pending = appointments.filter(row => !row.booking_team);
    if (!pending.length) return { attempted: 0, resolved: 0, unidentified: 0 };

    const ids = [...new Set(pending.map(row => row.source_external_id).filter((id): id is string => Boolean(id)))];
    const [{ data: attendants, error: attendantError }, { data: aliases, error: aliasError }, scheduleResult] = await Promise.all([
        supabase.from("attendants").select("id,name,queues!attendants_queue_id_fkey(sector)"),
        supabase.from("attendant_aliases").select("source_name,attendant_id").eq("source", "clinisys"),
        ids.length
            ? supabase.from("schedules").select("source_external_id,attendant_name").in("source_external_id", ids)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (attendantError) throw attendantError;
    if (aliasError) throw aliasError;
    if (scheduleResult.error) throw scheduleResult.error;

    const names = (attendants ?? []).map(row => {
        const queue = Array.isArray(row.queues) ? row.queues[0] : row.queues;
        const team: BookingTeam = queue?.sector === "ra" ? "ra" : "unit";
        return { id: row.id, name: row.name, team };
    });
    const byId = new Map(names.map(row => [row.id, row.team]));
    const aliasTeams = new Map((aliases ?? []).map(row => [row.source_name, byId.get(row.attendant_id) ?? null]));
    const directTeams = new Map<string, Set<BookingTeam>>();
    (scheduleResult.data ?? []).forEach(row => {
        if (!row.source_external_id) return;
        const team = row.attendant_name
            ? (aliasTeams.get(row.attendant_name) ?? teamForAttendantName(row.attendant_name, names))
            : null;
        const existing = directTeams.get(row.source_external_id) ?? new Set<BookingTeam>();
        existing.add(team);
        directTeams.set(row.source_external_id, existing);
    });
    const directTeam = (row: BookingCandidate): BookingTeam => {
        const found = directTeams.get(row.source_external_id ?? "");
        return found?.size === 1 ? [...found][0] : null;
    };

    const inferred = new Map<string, BookingTeam>();
    if (inferHistory) {
        const unresolved = pending.filter(row => !directTeam(row)).map(row => row.id);
        // Restrict both batch size and concurrency: the legacy unbounded RPC was
        // causing PostgreSQL statement timeouts on agenda page loads.
        for (let offset = 0; offset < unresolved.length; offset += RPC_BATCH_SIZE) {
            const batch = unresolved.slice(offset, offset + RPC_BATCH_SIZE);
            try {
                const { data, error } = await supabase.rpc("infer_appointment_booking_teams", {
                    appointment_ids: batch,
                });
                if (error) throw error;
                for (const row of (data ?? []) as Array<{ appointment_id: string; inferred_team: BookingTeam }>) {
                    if (row.inferred_team) inferred.set(row.appointment_id, row.inferred_team);
                }
            } catch (error) {
                // A slow or failed history lookup must never block other records.
                console.warn("[booking-teams] history inference deferred", { count: batch.length, error });
            }
        }
    }

    const checkedAt = new Date().toISOString();
    let resolved = 0;
    // Keep writes bounded, too; only persist confirmed teams and scan markers.
    for (let offset = 0; offset < pending.length; offset += RPC_BATCH_SIZE) {
        await Promise.all(pending.slice(offset, offset + RPC_BATCH_SIZE).map(async row => {
            const team = directTeam(row) ?? inferred.get(row.id) ?? null;
            if (!team && !recordAttempt) return;
            const values = team
                ? { booking_team: team, booking_team_checked_at: checkedAt }
                : { booking_team_checked_at: checkedAt };
            const { error } = await supabase.from("appointments").update(values)
                .eq("id", row.id).eq("source", "clinisys").is("booking_team", null);
            if (error) throw error;
            if (team) resolved += 1;
        }));
    }

    return { attempted: pending.length, resolved, unidentified: pending.length - resolved };
}
