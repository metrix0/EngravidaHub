// lib/scheduling/appointmentServer.ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalendarAppointment } from "@/types/scheduling";

export const APPOINTMENT_SELECT = `
    id,
    client_id,
    thread_id,
    unit_id,
    doctor_id,
    starts_at,
    ends_at,
    status,
    format,
    procedure_name,
    patient_name,
    patient_phone,
    patient_email,
    patient_cpf,
    patient_birth_date,
    spouse_name,
    spouse_phone,
    spouse_email,
    spouse_cpf,
    spouse_birth_date,
    address_street,
    address_number,
    address_complement,
    address_neighborhood,
    address_city,
    address_state,
    address_cep,
    address_country,
    address_legacy,
    notes,
    created_at,
    updated_at,
    client:clients!appointments_client_id_fkey (
        id,
        name,
        phone,
        email,
        state,
        street,
        number,
        cep
    ),
    unit:units!appointments_unit_id_fkey (
        id,
        name,
        city,
        state,
        street,
        number,
        cep,
        latitude,
        longitude
    ),
    doctor:doctors!appointments_doctor_id_fkey (
        id,
        name,
        specialty,
        crm,
        color,
        email,
        phone
    )
`;

export async function validateDoctorForUnit(
    supabase: SupabaseClient,
    doctorId: string,
    unitId: string,
) {
    const { data, error } = await supabase
        .from("doctor_units")
        .select("doctor_id, unit_id, doctor:doctors!inner(active)")
        .eq("doctor_id", doctorId)
        .eq("unit_id", unitId)
        .eq("active", true)
        .eq("doctor.active", true)
        .maybeSingle();

    if (error) throw error;
    return Boolean(data);
}

export async function fetchAppointmentById(
    supabase: SupabaseClient,
    appointmentId: string,
) {
    const { data, error } = await supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .eq("id", appointmentId)
        .maybeSingle();

    if (error) throw error;
    return data ? mapAppointment(data) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapAppointment(row: any): CalendarAppointment {
    const doctor = relationOne(row.doctor);

    return {
        id: row.id,
        client_id: row.client_id ?? null,
        thread_id: row.thread_id ?? null,
        unit_id: row.unit_id,
        doctor_id: row.doctor_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: row.status,
        format: row.format,
        procedure_name: row.procedure_name,
        patient_name: row.patient_name,
        patient_phone: row.patient_phone ?? null,
        patient_email: row.patient_email ?? null,
        patient_cpf: row.patient_cpf ?? null,
        patient_birth_date: row.patient_birth_date ?? null,
        spouse_name: row.spouse_name ?? null,
        spouse_phone: row.spouse_phone ?? null,
        spouse_email: row.spouse_email ?? null,
        spouse_cpf: row.spouse_cpf ?? null,
        spouse_birth_date: row.spouse_birth_date ?? null,
        address: mapAddress(row),
        notes: row.notes ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        client: relationOne(row.client),
        unit: relationOne(row.unit),
        doctor: doctor ? { ...doctor, unit_id: row.unit_id } : null,
    } as CalendarAppointment;
}

export function parseBrazilDate(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAddress(row: any) {
    const address = {
        street: row.address_street ?? "",
        number: row.address_number ?? "",
        complement: row.address_complement ?? "",
        neighborhood: row.address_neighborhood ?? "",
        city: row.address_city ?? "",
        state: row.address_state ?? "",
        cep: formatCep(row.address_cep ?? ""),
        country: row.address_country ?? "",
    };

    if (Object.values(address).some(Boolean)) return address;

    const legacyAddress = String(row.address_legacy ?? "").trim();
    return legacyAddress ? { ...address, street: legacyAddress } : null;
}

function formatCep(value: string) {
    return value.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function relationOne<T = any>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}
