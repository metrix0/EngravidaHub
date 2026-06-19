// types/scheduling.ts

export type SchedulingFormat = "congelamento" | "casal";

export type SchedulingPersonFields = {
    fullName: string;
    cpf: string;
    birthDate: string;
    email: string;
    phone: string;
};

export type SchedulingForm = {
    schedulingDate: string;
    primary: SchedulingPersonFields;
    spouse: SchedulingPersonFields;
    address: string;
};

export type SchedulingClientProfile = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    country: string | null;
    state: string | null;
    street: string | null;
    number: string | null;
    cep: string | null;
    cpf: string | null;
    birth_date: string | null;
    spouse_client_id: string | null;
};

export type SchedulingDataResponse = {
    client: SchedulingClientProfile;
    spouse: SchedulingClientProfile | null;
    suggestedFormat: SchedulingFormat;
    form: SchedulingForm;
};
