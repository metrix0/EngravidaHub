// lib/inbox/schedulingData.ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
    SchedulingClientProfile,
    SchedulingDataResponse,
    SchedulingForm,
    SchedulingPersonFields,
} from "@/types/scheduling";

const CLIENT_SELECT = `
    id,
    name,
    phone,
    email,
    country,
    state,
    street,
    number,
    cep,
    cpf,
    birth_date,
    spouse_client_id
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

    if (threadError) {
        throw threadError;
    }

    if (!thread) {
        return null;
    }

    const client = await fetchClientProfile(supabase, thread.client_id);

    if (!client) {
        return null;
    }

    const spouse = client.spouse_client_id
        ? await fetchClientProfile(supabase, client.spouse_client_id)
        : null;

    return {
        thread: thread as SchedulingThread,
        client,
        spouse,
        suggestedFormat: spouse ? "casal" : "congelamento",
        form: buildSchedulingForm(client, spouse),
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

    if (error) {
        throw error;
    }

    return (data as SchedulingClientProfile | null) ?? null;
}

function buildSchedulingForm(
    client: SchedulingClientProfile,
    spouse: SchedulingClientProfile | null,
): SchedulingForm {
    return {
        schedulingDate: "",
        primary: mapClientToPerson(client),
        spouse: spouse ? mapClientToPerson(spouse) : emptyPerson(),
        address: buildAddress(client),
    };
}

function mapClientToPerson(client: SchedulingClientProfile): SchedulingPersonFields {
    return {
        fullName: client.name?.trim() ?? "",
        cpf: formatCpf(client.cpf ?? ""),
        birthDate: formatStoredDate(client.birth_date),
        email: client.email?.trim().toLowerCase() ?? "",
        phone: formatPhone(client.phone ?? ""),
    };
}

function buildAddress(client: SchedulingClientProfile) {
    const parts = [
        client.street?.trim(),
        client.number?.trim(),
        client.state?.trim(),
        client.country?.trim(),
        client.cep ? `CEP ${formatCep(client.cep)}` : null,
    ].filter(Boolean);

    return parts.join(", ");
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
    if (!isoMatch) return value;

    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
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

    if (digits.length <= 10) {
        return digits
            .replace(/^(\d{2})(\d)/, "($1) $2")
            .replace(/(\d{4})(\d)/, "$1-$2");
    }

    return digits
        .replace(/^(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCep(value: string) {
    const digits = onlyDigits(value).slice(0, 8);
    return digits.replace(/^(\d{5})(\d)/, "$1-$2");
}

function onlyDigits(value: string) {
    return value.replace(/\D/g, "");
}
