import { supabase } from "@/lib/supabase/client";

const REQUEST_TIMEOUT_MS = 10_000;
const SAO_PAULO_TZ = "America/Sao_Paulo";

type ClinisysStatus = "Agendado" | "Atendido" | "Desmarcou" | "Faltou";

type AppointmentForClinisys = {
    id: string;
    sourceExternalId: string | null;
    unitId: string;
    doctorId: string;
    unitName: string | null;
    doctorName: string | null;
    startsAt: string;
    endsAt: string;
    status: string;
    procedureName: string;
    patient: {
        name: string;
        cpf: string | null;
        birthDate: string | null;
        phone: string | null;
        email: string | null;
    };
    notes: string | null;
};

type ClinisysAgenda = {
    id?: string | number;
    nome?: string;
    unidade_id?: string | number;
    unidade_nome?: string;
    medico_id?: string | number;
    medico_nome?: string;
    status?: string;
};

type ClinisysProcedure = {
    id?: string | number;
    nome?: string;
};

type ClinisysApiResponse = {
    status?: string;
    status_codigo?: string;
    status_descricao?: string;
    protocolo?: string | number;
    agendas?: ClinisysAgenda[];
    procedimentos?: ClinisysProcedure[];
    horarios?: Array<{ data?: string; inicio?: string; termino?: string }>;
    agendamento?: { id?: string | number };
};

export async function createClinisysAppointment(appointment: AppointmentForClinisys) {
    const context = await resolveContext(appointment);
    const response = await clinisysRequest<ClinisysApiResponse>(
        "POST",
        "/Agenda/Agendamentos",
        buildAppointmentBody(appointment, context),
    );
    const externalId = text(response.agendamento?.id);
    if (!externalId) throw new Error("CliniSYS não retornou o ID do agendamento.");
    return { externalId, protocol: text(response.protocolo) };
}

export async function updateClinisysAppointment(appointment: AppointmentForClinisys) {
    if (!appointment.sourceExternalId) {
        throw new Error("Agendamento ainda não está vinculado ao CliniSYS.");
    }
    const context = await resolveContext(appointment);
    const response = await clinisysRequest<ClinisysApiResponse>(
        "PUT",
        "/Agenda/Agendamentos",
        {
            id: appointment.sourceExternalId,
            ...buildAppointmentBody(appointment, context),
        },
    );
    return { protocol: text(response.protocolo) };
}

export async function deleteClinisysAppointment(externalId: string) {
    await clinisysRequest<ClinisysApiResponse>(
        "DELETE",
        "/Agenda/Agendamentos",
        { id: externalId },
    );
}

export async function listClinisysProcedures(agendaId: string) {
    const params = new URLSearchParams({ agenda: agendaId });
    const response = await clinisysRequest<ClinisysApiResponse>(
        "GET",
        `/Agenda/Procedimentos?${params.toString()}`,
    );
    return (response.procedimentos ?? []).flatMap((procedure) => {
        const id = text(procedure.id);
        const name = text(procedure.nome);
        return id && name ? [{ id, name }] : [];
    });
}

export async function listClinisysAvailability({
    unitId,
    doctorId,
    unitName,
    doctorName,
    procedureName,
    dateFrom,
    dateTo,
}: {
    unitId: string;
    doctorId: string;
    unitName: string | null;
    doctorName: string | null;
    procedureName: string;
    dateFrom?: string | null;
    dateTo?: string | null;
}) {
    const context = await resolveContext({
        id: "availability",
        sourceExternalId: null,
        unitId,
        doctorId,
        unitName,
        doctorName,
        startsAt: new Date().toISOString(),
        endsAt: new Date().toISOString(),
        status: "scheduled",
        procedureName,
        patient: { name: "", cpf: null, birthDate: null, phone: null, email: null },
        notes: null,
    });
    const params = new URLSearchParams({
        acao: "listarHorariosDisponiveis",
        agenda: context.agendaId,
        procedimento: context.procedureId,
    });
    if (dateFrom) params.set("data_inicial", formatQueryDate(dateFrom));
    if (dateTo) params.set("data_final", formatQueryDate(dateTo));
    const response = await clinisysRequest<ClinisysApiResponse>(
        "GET",
        `/Agenda/Agendas?${params.toString()}`,
    );
    return response.horarios ?? [];
}

async function resolveContext(appointment: AppointmentForClinisys) {
    const agendaId = await resolveAgendaId(appointment);
    const procedureId = await resolveProcedureId(agendaId, appointment.procedureName);
    return { agendaId, procedureId };
}

async function resolveAgendaId(appointment: AppointmentForClinisys) {
    const { data: saved, error: savedError } = await supabase
        .from("clinisys_agendas")
        .select("external_id, procedures")
        .eq("unit_id", appointment.unitId)
        .eq("doctor_id", appointment.doctorId)
        .eq("active", true)
        .limit(2);
    if (savedError) throw savedError;
    if ((saved ?? []).length === 1) return saved![0].external_id;

    const procedureNeedle = normalize(appointment.procedureName);
    const procedureMatches = (saved ?? []).filter((agenda) =>
        storedProcedures(agenda.procedures).some(
            (procedure) => normalize(procedure.name) === procedureNeedle,
        ),
    );
    if (procedureMatches.length === 1) return procedureMatches[0].external_id;

    const [{ data: unit, error: unitError }, response] = await Promise.all([
        supabase
            .from("units")
            .select("name, city, state")
            .eq("id", appointment.unitId)
            .maybeSingle(),
        clinisysRequest<ClinisysApiResponse>("GET", "/Agenda/Agendas"),
    ]);
    if (unitError) throw unitError;

    const doctorNeedle = normalizePerson(appointment.doctorName ?? "");
    const unitAliases = [
        appointment.unitName,
        unit?.name,
        unit?.city,
        unit?.state,
    ]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(normalize)
        .filter(Boolean);

    const active = (response.agendas ?? []).filter(
        (agenda) => !agenda.status || normalize(agenda.status) === "ativa",
    );
    const doctorMatches = active.filter((agenda) => {
        const remoteDoctor = normalizePerson(agenda.medico_nome ?? agenda.nome ?? "");
        return namesOverlap(remoteDoctor, doctorNeedle);
    });
    const unitMatches = doctorMatches.filter((agenda) => {
        const haystack = normalize(`${agenda.unidade_nome ?? ""} ${agenda.nome ?? ""}`);
        return unitAliases.some((alias) => alias.length >= 2 && namesOverlap(haystack, alias));
    });
    const candidates = unitMatches.length ? unitMatches : doctorMatches;
    if (candidates.length !== 1) {
        throw new Error(
            candidates.length === 0
                ? `Agenda do CliniSYS não encontrada para ${appointment.doctorName ?? "o médico selecionado"}.`
                : `Mais de uma agenda do CliniSYS corresponde a ${appointment.doctorName ?? "o médico selecionado"}.`,
        );
    }
    const agendaId = text(candidates[0].id);
    if (!agendaId) throw new Error("Agenda do CliniSYS sem identificador.");
    return agendaId;
}

async function resolveProcedureId(agendaId: string, procedureName: string) {
    const params = new URLSearchParams({ agenda: agendaId });
    const response = await clinisysRequest<ClinisysApiResponse>(
        "GET",
        `/Agenda/Procedimentos?${params.toString()}`,
    );
    const procedures = response.procedimentos ?? [];
    const needle = normalize(procedureName);
    const exact = procedures.filter((procedure) => normalize(procedure.nome ?? "") === needle);
    const loose = procedures.filter((procedure) => namesOverlap(normalize(procedure.nome ?? ""), needle));
    const candidates = exact.length ? exact : loose;
    if (candidates.length !== 1) {
        throw new Error(
            candidates.length === 0
                ? `Procedimento "${procedureName}" não encontrado no CliniSYS para a agenda selecionada.`
                : `Procedimento "${procedureName}" é ambíguo no CliniSYS.`,
        );
    }
    const id = text(candidates[0].id);
    if (!id) throw new Error("Procedimento do CliniSYS sem identificador.");
    return id;
}

function buildAppointmentBody(
    appointment: AppointmentForClinisys,
    context: { agendaId: string; procedureId: string },
) {
    const status = toClinisysStatus(appointment.status);
    return {
        data: formatDateTime(appointment.startsAt).date,
        inicio: formatDateTime(appointment.startsAt).time,
        termino: formatDateTime(appointment.endsAt).time,
        agenda: context.agendaId,
        procedimento: context.procedureId,
        paciente: appointment.patient.name,
        cpf: appointment.patient.cpf || undefined,
        nascimento_paciente: formatBirthDate(appointment.patient.birthDate),
        celular: appointment.patient.phone || undefined,
        email: appointment.patient.email || undefined,
        status,
        confirmado: appointment.status === "confirmed" ? "1" : "0",
        observacoes: appointment.notes || undefined,
    };
}

function toClinisysStatus(status: string): ClinisysStatus {
    if (status === "completed") return "Atendido";
    if (status === "cancelled") return "Desmarcou";
    if (status === "no_show") return "Faltou";
    return "Agendado";
}

async function clinisysRequest<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
): Promise<T> {
    const baseUrl = "https://api.clinisys.com.br/Engravida";
    const token = process.env.CLINISYS_TOKEN?.trim();
    if (!token) throw new Error("CLINISYS_TOKEN não está configurado.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
            signal: controller.signal,
        });
        const raw = await response.text();
        let data: ClinisysApiResponse | null = null;
        try {
            data = raw ? (JSON.parse(raw) as ClinisysApiResponse) : null;
        } catch {
            data = null;
        }
        if (!response.ok || !data || data.status !== "OK") {
            const detail = data?.status_descricao || data?.status_codigo || raw || `HTTP ${response.status}`;
            throw new Error(`CliniSYS: ${detail}`);
        }
        return data as T;
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("CliniSYS não respondeu dentro do tempo limite.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function storedProcedures(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((procedure) => {
        if (!procedure || typeof procedure !== "object") return [];
        const row = procedure as { id?: unknown; name?: unknown };
        const id = text(row.id);
        const name = text(row.name);
        return id && name ? [{ id, name }] : [];
    });
}

function formatQueryDate(value: string) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}

function formatDateTime(value: string) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: SAO_PAULO_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? "";
    return {
        date: `${part("day")}/${part("month")}/${part("year")}`,
        time: `${part("hour")}:${part("minute")}`,
    };
}

function formatBirthDate(value: string | null) {
    if (!value) return undefined;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return value;
}

function text(value: unknown) {
    if (value === null || value === undefined) return null;
    const result = String(value).trim();
    return result || null;
}

function normalizePerson(value: string) {
    return normalize(value).replace(/^(dr|dra|doutor|doutora)\s+/, "");
}

function normalize(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function namesOverlap(first: string, second: string) {
    if (!first || !second) return false;
    return first === second || first.includes(second) || second.includes(first);
}
