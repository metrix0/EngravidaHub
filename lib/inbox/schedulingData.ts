// lib/inbox/schedulingData.ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
    SchedulingAddressFields,
    SchedulingClientProfile,
    SchedulingDataResponse,
    SchedulingDoctorOption,
    SchedulingForm,
    SchedulingPersonFields,
    SchedulingUnitOption,
} from "@/types/scheduling";

const CLIENT_SELECT = `
    id,
    name,
    phone,
    email,
    country,
    state,
    city,
    neighborhood,
    street,
    number,
    complement,
    cep,
    cpf,
    birth_date,
    spouse_client_id,
    unit_id,
    units (
        name
    )
`;

const UNIT_SELECT = `
    id,
    name,
    city,
    state,
    street,
    number,
    cep,
    latitude,
    longitude
`;

type SchedulingThread = {
    id: string;
    client_id: string;
    assigned_attendant_id: string | null;
};

export async function loadSchedulingContext(
    supabase: SupabaseClient,
    threadId: string,
    attendantId: string,
): Promise<(SchedulingDataResponse & { thread: SchedulingThread }) | null> {
    const { data: thread, error: threadError } = await supabase
        .from("thread")
        .select("id, client_id, assigned_attendant_id")
        .eq("id", threadId)
        .eq("assigned_attendant_id", attendantId)
        .maybeSingle();

    if (threadError) throw threadError;
    if (!thread) return null;

    const context = await loadSchedulingClientContext(
        supabase,
        thread.client_id,
    );

    return context
        ? {
              ...context,
              thread: thread as SchedulingThread,
          }
        : null;
}

export async function loadSchedulingClientContext(
    supabase: SupabaseClient,
    clientId: string,
): Promise<SchedulingDataResponse | null> {
    const [client, units, doctors] = await Promise.all([
        fetchClientProfile(supabase, clientId),
        fetchUnits(supabase),
        fetchDoctors(supabase),
    ]);

    if (!client) return null;

    const spouse = client.spouse_client_id
        ? await fetchClientProfile(supabase, client.spouse_client_id)
        : null;

    return {
        client,
        spouse,
        units,
        doctors,
        suggestedFormat: spouse ? "casal" : "congelamento",
        form: buildSchedulingForm(client, spouse, units, doctors),
    };
}

async function fetchClientProfile(
    supabase: SupabaseClient,
    clientId: string,
): Promise<SchedulingClientProfile | null> {
    const { data, error } = await supabase
        .from("clients")
        .select(CLIENT_SELECT)
        .eq("id", clientId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const unit = Array.isArray(data.units) ? data.units[0] : data.units;

    return {
        ...data,
        unit_name: unit?.name ?? null,
    } as SchedulingClientProfile;
}

async function fetchUnits(supabase: SupabaseClient) {
    const { data, error } = await supabase
        .from("units")
        .select(UNIT_SELECT)
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []) as SchedulingUnitOption[];
}

async function fetchDoctors(supabase: SupabaseClient) {
    const { data, error } = await supabase
        .from("doctor_units")
        .select(`
            unit_id,
            doctor:doctors!inner (
                id,
                name,
                specialty,
                crm,
                color,
                email,
                phone,
                active
            )
        `)
        .eq("active", true)
        .eq("doctor.active", true);

    if (error) throw error;

    return (data ?? [])
        .flatMap((row) => {
            const doctor = Array.isArray(row.doctor)
                ? row.doctor[0]
                : row.doctor;

            if (!doctor) return [];

            return [{
                unit_id: row.unit_id,
                id: doctor.id,
                name: doctor.name,
                specialty: doctor.specialty,
                crm: doctor.crm,
                color: doctor.color,
                email: doctor.email,
                phone: doctor.phone,
            } satisfies SchedulingDoctorOption];
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function buildSchedulingForm(
    client: SchedulingClientProfile,
    spouse: SchedulingClientProfile | null,
    units: SchedulingUnitOption[],
    doctors: SchedulingDoctorOption[],
): SchedulingForm {
    const unitId = chooseInitialUnit(client, units);
    const selectedUnit = units.find((unit) => unit.id === unitId) ?? null;
    const unitDoctors = doctors.filter((doctor) => doctor.unit_id === unitId);

    return {
        unitId,
        doctorId: unitDoctors.length === 1 ? unitDoctors[0].id : "",
        schedulingDate: "",
        schedulingTime: "",
        durationMinutes: 45,
        procedureName: "Consulta",
        primary: mapClientToPerson(client),
        spouse: spouse ? mapClientToPerson(spouse) : emptyPerson(),
        address: buildAddress(client, selectedUnit),
        notes: "",
    };
}

function chooseInitialUnit(
    client: SchedulingClientProfile,
    units: SchedulingUnitOption[],
) {
    if (client.unit_id && units.some((unit) => unit.id === client.unit_id)) {
        return client.unit_id;
    }

    const address = normalizeText(
        [
            client.street,
            client.number,
            client.state,
            client.country,
            client.cep,
        ]
            .filter(Boolean)
            .join(" "),
    );

    if (!address) return "";

    let bestMatch = "";
    let bestScore = 0;

    for (const unit of units) {
        const candidates = [unit.name, unit.city, unit.state, unit.cep]
            .filter(Boolean)
            .map((value) => normalizeText(String(value)));
        const score = candidates.reduce(
            (total, value) => total + (value && address.includes(value) ? 1 : 0),
            0,
        );

        if (score > bestScore) {
            bestScore = score;
            bestMatch = unit.id;
        }
    }

    return bestMatch;
}

function mapClientToPerson(
    client: SchedulingClientProfile,
): SchedulingPersonFields {
    return {
        fullName: client.name?.trim() ?? "",
        cpf: formatCpf(client.cpf ?? ""),
        birthDate: formatStoredDate(client.birth_date),
        email: client.email?.trim().toLowerCase() ?? "",
        phone: formatPhone(client.phone ?? ""),
    };
}

function buildAddress(
    client: SchedulingClientProfile,
    selectedUnit: SchedulingUnitOption | null,
): SchedulingAddressFields {
    return {
        street: client.street?.trim() ?? "",
        number: client.number?.trim() ?? "",
        complement: client.complement?.trim() ?? "",
        neighborhood: client.neighborhood?.trim() ?? "",
        city: client.city?.trim() ?? "",
        state:
            client.state?.trim() ||
            selectedUnit?.state?.trim() ||
            "",
        cep: formatCep(client.cep ?? ""),
        country: client.country?.trim() || "Brasil",
    };
}

function emptyPerson(): SchedulingPersonFields {
    return {
        fullName: "",
        cpf: "",
        birthDate: "",
        email: "",
        phone: "",
    };
}

function formatStoredDate(value: string | null) {
    if (!value) return "";
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return isoMatch ? `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}` : value;
}

function formatCpf(value: string) {
    const digits = onlyDigits(value).slice(0, 11);
    return digits
        .replace(/^(\d{3})(\d)/, "$1.$2")
        .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function formatPhone(value: string) {
    let digits = onlyDigits(value);
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
        digits = digits.slice(2);
    }
    digits = digits.slice(0, 11);

    return digits.length <= 10
        ? digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2")
        : digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCep(value: string) {
    return onlyDigits(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function onlyDigits(value: string) {
    return value.replace(/\D/g, "");
}
