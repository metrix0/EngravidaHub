// types/scheduling.ts

export type SchedulingFormat = "congelamento" | "casal";

export type SchedulingPersonFields = {
    fullName: string;
    cpf: string;
    birthDate: string;
    email: string;
    phone: string;
};

export type SchedulingAddressFields = {
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    cep: string;
    country: string;
};

export type SchedulingForm = {
    unitId: string;
    doctorId: string;
    schedulingDate: string;
    schedulingTime: string;
    durationMinutes: number;
    procedureName: string;
    primary: SchedulingPersonFields;
    spouse: SchedulingPersonFields;
    address: SchedulingAddressFields;
    notes: string;
};

export type SchedulingClientProfile = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
    neighborhood: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    cep: string | null;
    cpf: string | null;
    birth_date: string | null;
    spouse_client_id: string | null;
    unit_id: string | null;
    unit_name: string | null;
};

export type SchedulingUnitOption = {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    street: string | null;
    number: string | null;
    cep: string | null;
    latitude: number | null;
    longitude: number | null;
};

export type SchedulingDoctorOption = {
    id: string;
    unit_id: string;
    name: string;
    specialty: string | null;
    crm: string | null;
    color: string;
    email: string | null;
    phone: string | null;
};

export type SchedulingDataResponse = {
    client: SchedulingClientProfile;
    spouse: SchedulingClientProfile | null;
    units: SchedulingUnitOption[];
    doctors: SchedulingDoctorOption[];
    suggestedFormat: SchedulingFormat;
    form: SchedulingForm;
};

export type AppointmentStatus =
    | "scheduled"
    | "confirmed"
    | "completed"
    | "cancelled"
    | "no_show";

export type CalendarAppointment = {
    id: string;
    client_id: string | null;
    thread_id: string | null;
    unit_id: string;
    doctor_id: string;
    starts_at: string;
    ends_at: string;
    status: AppointmentStatus;
    format: SchedulingFormat;
    procedure_name: string;
    patient_name: string;
    patient_phone: string | null;
    patient_email: string | null;
    patient_cpf: string | null;
    patient_birth_date: string | null;
    spouse_name: string | null;
    spouse_phone: string | null;
    spouse_email: string | null;
    spouse_cpf: string | null;
    spouse_birth_date: string | null;
    address: SchedulingAddressFields | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    client: {
        id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        state: string | null;
        street: string | null;
        number: string | null;
        cep: string | null;
    } | null;
    unit: SchedulingUnitOption | null;
    doctor: SchedulingDoctorOption | null;
};

export type AppointmentDayNote = {
    id: string;
    note_date: string;
    unit_id: string | null;
    doctor_id: string | null;
    text: string;
    color: string;
    created_at: string;
    updated_at: string;
};
