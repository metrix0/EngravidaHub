import { supabase } from "@/lib/supabase/client";
import {
    compatibleProcedure,
    vacancyFromHistory,
    type RecoveryVacancy,
    type VacancyHistory,
} from "@/lib/scheduling/slotRecovery";

const DAY = 86_400_000;
const ACTIVE_STATUSES = ["scheduled", "confirmed"];
const WEEK = 7 * DAY;

type AppointmentRow = {
    client_id: string | null;
    unit_id: string;
    doctor_id: string;
    starts_at: string;
    ends_at: string;
    procedure_name: string;
};
type ContactRow = {
    id: string;
    vacancy_history_id: number;
    client_id: string;
    status: "pending" | "contacted" | "failed";
    contacted_at: string | null;
    batch_id: string | null;
    error: string | null;
};
type ClientRow = {
    id: string;
    name: string | null;
    phone: string | null;
    unit_id: string | null;
    last_interaction_at: string;
    last_active_message_sent_at: string | null;
};
type ClientMessage = { client_id: string | null; text: string; sent_at: string };

export type RecoveryCandidate = {
    clientId: string;
    name: string;
    score: number;
    reasons: string[];
    status: "available" | "contacted" | "responded" | "booked" | "pending" | "failed";
    contactedAt: string | null;
    recentContact: boolean;
    canContact: boolean;
    error: string | null;
};

function timeOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
    return Date.parse(firstStart) < Date.parse(secondEnd) && Date.parse(firstEnd) > Date.parse(secondStart);
}

export async function loadRecoveryVacancies({
    start, end, unitIds = [],
}: { start: string; end: string; unitIds?: string[] }) {
    const since = new Date(Date.now() - DAY).toISOString();
    const { data, error } = await supabase.from("schedule_history")
        .select("id, entity_id, operation, recorded_at, before_state, after_state")
        .eq("entity_type", "appointment")
        .in("operation", ["UPDATE", "DELETE"])
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: false })
        .limit(1500);
    if (error) throw error;

    const unique = new Map<string, ReturnType<typeof vacancyFromHistory>>();
    for (const row of (data ?? []) as VacancyHistory[]) {
        const vacancy = vacancyFromHistory(row);
        if (!vacancy || Date.parse(vacancy.startsAt) <= Date.now()) continue;
        const localDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date(vacancy.startsAt));
        if (localDate < start || localDate >= end) continue;
        if (unitIds.length && !unitIds.includes(vacancy.unitId)) continue;
        const key = [vacancy.unitId, vacancy.doctorId, vacancy.startsAt, vacancy.endsAt].join(":");
        if (!unique.has(key)) unique.set(key, vacancy);
    }
    const events = [...unique.values()].filter((row): row is NonNullable<typeof row> => row !== null);
    if (!events.length) return [] as RecoveryVacancy[];

    const firstStart = events.reduce((a, b) => a.startsAt < b.startsAt ? a : b).startsAt;
    const lastEnd = events.reduce((a, b) => a.endsAt > b.endsAt ? a : b).endsAt;
    const ids = events.map(row => row.id);
    const [bookingResult, contactResult] = await Promise.all([
        supabase.from("appointments")
            .select("client_id,unit_id,doctor_id,starts_at,ends_at,procedure_name")
            .in("status", ACTIVE_STATUSES)
            .lt("starts_at", lastEnd)
            .gt("ends_at", firstStart)
            .limit(4000),
        supabase.from("appointment_recovery_contacts")
            .select("id,vacancy_history_id,client_id,status,contacted_at,batch_id,error")
            .in("vacancy_history_id", ids),
    ]);
    if (bookingResult.error) throw bookingResult.error;
    if (contactResult.error) throw contactResult.error;
    const appointments = (bookingResult.data ?? []) as AppointmentRow[];
    const contacts = (contactResult.data ?? []) as ContactRow[];
    const sentContacts = contacts.filter(c => c.status === "contacted" && c.contacted_at);
    const responseMap = new Set<string>();
    if (sentContacts.length) {
        const firstContact = sentContacts.reduce((a, b) =>
            a.contacted_at! < b.contacted_at! ? a : b).contacted_at!;
        const clientIds = [...new Set(sentContacts.map(c => c.client_id))];
        const { data: messages, error: messageError } = await supabase.from("messages")
            .select("client_id,sent_at")
            .eq("sender_type", "client").in("client_id", clientIds)
            .gt("sent_at", firstContact)
            .order("sent_at", { ascending: false }).limit(3000);
        if (messageError) throw messageError;
        for (const contact of sentContacts) {
            if ((messages ?? []).some(m => m.client_id === contact.client_id &&
                m.sent_at > contact.contacted_at!)) responseMap.add(contact.id);
        }
    }
    return events.map(vacancy => {
        const occupying = appointments.find(booking =>
            booking.unit_id === vacancy.unitId && booking.doctor_id === vacancy.doctorId &&
            timeOverlap(booking.starts_at, booking.ends_at, vacancy.startsAt, vacancy.endsAt));
        const forVacancy = contacts.filter(c => c.vacancy_history_id === vacancy.id);
        return {
            ...vacancy,
            filled: Boolean(occupying),
            filledByClientId: occupying?.client_id ?? null,
            contacted: forVacancy.filter(c => c.status === "contacted").length,
            responded: forVacancy.filter(c => responseMap.has(c.id)).length,
        };
    }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function loadRecoveryVacancy(id: number) {
    const { data, error } = await supabase.from("schedule_history")
        .select("id, entity_id, operation, recorded_at, before_state, after_state")
        .eq("id", id).eq("entity_type", "appointment").maybeSingle();
    if (error) throw error;
    const vacancy = data ? vacancyFromHistory(data as VacancyHistory) : null;
    if (!vacancy || Date.now() - Date.parse(vacancy.openedAt) > DAY ||
        Date.parse(vacancy.startsAt) <= Date.now()) return null;
    return vacancy;
}

export async function isRecoveryVacancyFilled(vacancy: { unitId: string; doctorId: string; startsAt: string; endsAt: string }) {
    const { data, error } = await supabase.from("appointments").select("id,client_id")
        .eq("unit_id", vacancy.unitId).eq("doctor_id", vacancy.doctorId)
        .in("status", ACTIVE_STATUSES)
        .lt("starts_at", vacancy.endsAt).gt("ends_at", vacancy.startsAt)
        .limit(1);
    if (error) throw error;
    return (data ?? [])[0] ?? null;
}

function interestText(value: string) {
    return /agend|hor[aá]rio|consulta|vaga|antecip|adiant|dispon[ií]vel|encaixe/i.test(value);
}

function preference(value: string, startsAt: string) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23",
    }).format(new Date(startsAt)));
    const day = new Date(startsAt).getUTCDay();
    const dayNames = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
    const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return (hour < 12 && /manha/.test(normalized)) ||
        (hour >= 12 && hour < 18 && /tarde/.test(normalized)) ||
        (hour >= 18 && /noite/.test(normalized)) ||
        normalized.includes(dayNames[day]);
}

export async function loadRecoveryCandidates(vacancy: NonNullable<Awaited<ReturnType<typeof loadRecoveryVacancy>>>) {
    const now = Date.now();
    const later = new Date(now + 180 * DAY).toISOString();
    const [laterResult, interestedResult, conflictResult, previousResult] = await Promise.all([
        supabase.from("appointments")
            .select("client_id,unit_id,doctor_id,starts_at,ends_at,procedure_name")
            .eq("unit_id", vacancy.unitId)
            .in("status", ACTIVE_STATUSES)
            .gt("starts_at", vacancy.startsAt)
            .lt("starts_at", later).order("starts_at", { ascending: false }).limit(1500),
        supabase.from("clients")
            .select("id,name,phone,unit_id,last_interaction_at,last_active_message_sent_at")
            .eq("unit_id", vacancy.unitId)
            .gte("last_interaction_at", new Date(now - 60 * DAY).toISOString())
            .order("last_interaction_at", { ascending: false }).limit(250),
        supabase.from("appointments")
            .select("client_id,unit_id,doctor_id,starts_at,ends_at,procedure_name")
            .in("status", ACTIVE_STATUSES)
            .lt("starts_at", vacancy.endsAt).gt("ends_at", vacancy.startsAt).limit(1500),
        supabase.from("appointment_recovery_contacts")
            .select("id,vacancy_history_id,client_id,status,contacted_at,batch_id,error")
            .eq("vacancy_history_id", vacancy.id),
    ]);
    for (const result of [laterResult, interestedResult, conflictResult, previousResult]) {
        if (result.error) throw result.error;
    }
    const laterBookings = (laterResult.data ?? []) as AppointmentRow[];
    const linked = laterBookings.filter(a => a.client_id &&
        compatibleProcedure(a.procedure_name, vacancy.procedureName));
    const activeClients = (interestedResult.data ?? []) as ClientRow[];
    const contacts = (previousResult.data ?? []) as ContactRow[];
    const clientIds = [...new Set([
        ...linked.map(a => a.client_id!).filter(Boolean),
        ...activeClients.map(c => c.id),
        ...contacts.map(c => c.client_id),
    ])];
    if (!clientIds.length) return [] as RecoveryCandidate[];
    const clientsResult = await supabase.from("clients")
        .select("id,name,phone,unit_id,last_interaction_at,last_active_message_sent_at")
        .in("id", clientIds);
    if (clientsResult.error) throw clientsResult.error;

    // Large IN filters over 90 days of messages timed out on PostgREST.
    // Use small indexed lookups with bounded concurrency instead.
    const messages: ClientMessage[] = [];
    const batchSize = 40;
    let nextBatch = 0;
    await Promise.all(Array.from({
        length: Math.min(3, Math.ceil(clientIds.length / batchSize)),
    }, async () => {
        while (nextBatch < clientIds.length) {
            const start = nextBatch;
            nextBatch += batchSize;
            const { data, error } = await supabase.from("messages")
                .select("client_id,text,sent_at")
                .eq("sender_type", "client")
                .in("client_id", clientIds.slice(start, start + batchSize))
                .gte("sent_at", new Date(now - 90 * DAY).toISOString())
                .order("sent_at", { ascending: false })
                .limit(250);
            if (error) throw error;
            messages.push(...((data ?? []) as ClientMessage[]));
        }
    }));
    messages.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
    const conflicts = new Set((conflictResult.data ?? []).map(row => row.client_id).filter(Boolean));
    const newestMessage = new Map<string, string>();
    const latestClientReply = new Map<string, string>();
    for (const msg of messages) {
        if (!msg.client_id) continue;
        if (!latestClientReply.has(msg.client_id)) latestClientReply.set(msg.client_id, msg.sent_at);
        if (interestText(msg.text) && !newestMessage.has(msg.client_id)) newestMessage.set(msg.client_id, msg.sent_at);
    }

    return ((clientsResult.data ?? []) as ClientRow[]).flatMap(client => {
        const current = contacts.find(c => c.client_id === client.id);
        if (!client.phone || (conflicts.has(client.id) && !current)) return [];
        const booked = linked.filter(a => a.client_id === client.id)
            .sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
        const interest = newestMessage.get(client.id);
        if (!booked && !interest && !current) return [];
        const daysAhead = booked ? Math.max(1, Math.ceil((Date.parse(booked.starts_at) - Date.parse(vacancy.startsAt)) / DAY)) : 0;
        const preferred = messages.filter(m => m.client_id === client.id).slice(0, 10)
            .some(m => preference(m.text, vacancy.startsAt));
        const recentlyContacted = Boolean(client.last_active_message_sent_at &&
            now - Date.parse(client.last_active_message_sent_at) < WEEK);
        const bookedHere = (conflictResult.data ?? []).some(row => row.client_id === client.id &&
            row.unit_id === vacancy.unitId && row.doctor_id === vacancy.doctorId);
        const replied = Boolean(current?.contacted_at &&
            latestClientReply.get(client.id) && latestClientReply.get(client.id)! > current.contacted_at);
        const reasons = [];
        if (booked) reasons.push(`Consulta atual em ${new Intl.DateTimeFormat("pt-BR",{ timeZone:"America/Sao_Paulo" }).format(new Date(booked.starts_at))} · ${daysAhead} dias depois`);
        if (preferred) reasons.push("Preferência de horário compatível");
        if (interest) reasons.push("Interesse recente em agendamento");
        const score = (booked ? 100 + Math.min(daysAhead, 180) * 3 : 30) +
            (preferred ? 12 : 0) + (interest ? 10 : 0) -
            (recentlyContacted ? 400 : 0);
        const status: RecoveryCandidate["status"] = bookedHere ? "booked" : current?.status === "pending" ? "pending" :
            current?.status === "failed" ? "failed" :
            current?.status === "contacted" ? (replied ? "responded" : "contacted") : "available";
        return [{
            clientId: client.id, name: client.name ?? "Cliente sem nome",
            score, reasons, status, contactedAt: current?.contacted_at ?? null,
            recentContact: recentlyContacted,
            canContact: !recentlyContacted && !conflicts.has(client.id) && (status === "available" || status === "failed"),
            error: current?.error ?? null,
        }];
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 60);
}
