// lib/chatbot/scheduling.ts
import { randomUUID } from "node:crypto";

import { listClinisysAvailability } from "@/lib/clinisys/client";
import { normalizePhoneIdentity } from "@/lib/clients/phoneIdentity";
import {
    buildAppointmentIntegrationPayload,
    sendAppointmentIntegration,
} from "@/lib/scheduling/appointmentAutomation";
import { fetchAppointmentById } from "@/lib/scheduling/appointmentServer";
import { supabase } from "@/lib/supabase/client";
import {
    buildChatbotReply,
    normalizeChatbotStage,
    type ChatbotStage,
    type OutOfHoursChatbotReply,
} from "@/lib/chatbot/outOfHoursChatbot";

export const CHATBOT_APPOINTMENT_CREATION_ENABLED = false;

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const PROCEDURE_NAME = "Consulta";
const APPOINTMENT_DURATION_MINUTES = 45;

type SchedulingStep =
    | "unit"
    | "doctor"
    | "date"
    | "time"
    | "name"
    | "confirm"
    | "blocked"
    | "completed";

type SchedulingSessionRow = {
    session_key: string;
    phone: string | null;
    topic_stage: string;
    step: SchedulingStep;
    unit_id: string | null;
    doctor_id: string | null;
    scheduling_date: string | null;
    scheduling_time: string | null;
    patient_name: string | null;
    created_at: string;
    updated_at: string;
};

type UnitOption = {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
};

type DoctorOption = {
    id: string;
    unit_id: string;
    name: string;
    specialty: string | null;
};

type AvailabilitySlot = {
    data?: string;
    inicio?: string;
    termino?: string;
};

type UnitAvailabilitySlot = {
    date: string;
    time: string;
    doctorId: string;
};

type DayPeriod = "morning" | "afternoon";

export type ChatbotSchedulingMetadata = {
    active: boolean;
    step: SchedulingStep;
    creation_enabled: boolean;
    creation_blocked: boolean;
    unit_id: string | null;
    doctor_id: string | null;
    scheduling_date: string | null;
    scheduling_time: string | null;
    patient_name: string | null;
};

export type ChatbotSchedulingReply = OutOfHoursChatbotReply & {
    scheduling: ChatbotSchedulingMetadata;
};

export async function hasActiveChatbotSchedulingSession(sessionKey: string) {
    const session = await loadSession(sessionKey);
    return Boolean(session);
}

export async function resetChatbotSchedulingSession(sessionKey: string) {
    const { error } = await supabase
        .from("chatbot_scheduling_sessions")
        .delete()
        .eq("session_key", sessionKey);

    if (error) throw error;
}

export async function startChatbotScheduling({
    sessionKey,
    phone,
    topicStage,
}: {
    sessionKey: string;
    phone: string | null;
    topicStage: ChatbotStage;
}): Promise<ChatbotSchedulingReply> {
    const normalizedPhone = normalizePhoneIdentity(phone);
    const now = new Date().toISOString();
    const session: SchedulingSessionRow = {
        session_key: sessionKey,
        phone: normalizedPhone,
        topic_stage: topicStage,
        step: "unit",
        unit_id: null,
        doctor_id: null,
        scheduling_date: null,
        scheduling_time: null,
        patient_name: null,
        created_at: now,
        updated_at: now,
    };

    const { error } = await supabase
        .from("chatbot_scheduling_sessions")
        .upsert(session, { onConflict: "session_key" });

    if (error) throw error;

    const knownUnit = await loadKnownUnitForPhone(normalizedPhone);
    if (knownUnit) {
        return offerAvailabilityWindow(session, topicStage, knownUnit);
    }

    const units = await loadUnits();
    return schedulingReply(
        session,
        buildChatbotReply({
            action: "show_menu",
            route: "deterministic",
            stage: topicStage,
            reply:
                "Claro. Posso consultar os horários disponíveis e preparar seu agendamento por aqui. Em qual unidade você quer ser atendido?",
            options: units.slice(0, 10).map((unit) => ({
                id: `schedule:unit:${unit.id}`,
                label: unitLabel(unit),
            })),
        }),
    );
}

export async function handleChatbotScheduling({
    sessionKey,
    message,
}: {
    sessionKey: string;
    message: string;
}): Promise<ChatbotSchedulingReply | null> {
    const session = await loadSession(sessionKey);
    if (!session) return null;

    const stage = normalizeChatbotStage(session.topic_stage);
    const normalized = normalizeText(message);

    if (normalized === "schedule:change_unit") {
        return restartAtUnit(session, stage);
    }

    if (isCancelRequest(normalized)) {
        await resetChatbotSchedulingSession(sessionKey);
        return {
            ...buildChatbotReply({
                action: "show_menu",
                route: "deterministic",
                stage,
                reply: "Tudo bem. O agendamento foi cancelado. Como posso ajudar?",
                options: [{ id: "common:menu", label: "Voltar ao menu" }],
            }),
            scheduling: metadata(session, false),
        };
    }

    switch (session.step) {
        case "unit":
            return handleUnitStep(session, message, stage);
        case "doctor":
            return handleDoctorStep(session, message, stage);
        case "date":
            return handleDateStep(session, message, stage);
        case "time":
            return handleTimeStep(session, message, stage);
        case "name":
            return handleNameStep(session, message, stage);
        case "confirm":
            return handleConfirmStep(session, message, stage);
        case "blocked":
            return blockedCreationReply(session, stage);
        case "completed":
            return schedulingReply(
                session,
                buildChatbotReply({
                    action: "reply",
                    route: "deterministic",
                    stage,
                    reply: "Esse agendamento já foi concluído.",
                    options: [{ id: "common:menu", label: "Voltar ao menu" }],
                }),
            );
    }
}

async function handleUnitStep(
    session: SchedulingSessionRow,
    message: string,
    stage: ChatbotStage,
) {
    const units = await loadUnits();
    const selected = selectUnit(message, units);

    if (!selected) {
        return schedulingReply(
            session,
            buildChatbotReply({
                action: "show_menu",
                route: "deterministic",
                stage,
                reply: "Não identifiquei a unidade. Escolha uma das opções abaixo ou escreva o nome da unidade.",
                options: units.slice(0, 10).map((unit) => ({
                    id: `schedule:unit:${unit.id}`,
                    label: unitLabel(unit),
                })),
            }),
        );
    }

    return offerAvailabilityWindow(session, stage, selected);
}

async function handleDoctorStep(
    session: SchedulingSessionRow,
    message: string,
    stage: ChatbotStage,
) {
    if (!session.unit_id || !session.scheduling_date) {
        return restartAtUnit(session, stage);
    }

    const period = parseDayPeriod(message);
    const unit = await loadUnit(session.unit_id);
    if (!unit) return restartAtUnit(session, stage);

    if (isNegativeAvailabilityResponse(message)) {
        return offerAvailabilityWindow(
            session,
            stage,
            unit,
            addDays(endOfWeek(session.scheduling_date), 1),
        );
    }

    if (!period) {
        return askDayPeriod(session, stage);
    }

    const windowEnd = endOfWeek(session.scheduling_date);
    const windowSlots = (await loadUnitAvailableSlots(session.unit_id)).filter(
        (slot) =>
            slot.date >= session.scheduling_date &&
            slot.date <= windowEnd,
    );
    const slots = windowSlots.filter((slot) =>
        isSlotInPeriod(slot.time, period),
    );

    if (slots.length === 0) {
        const alternative: DayPeriod =
            period === "morning" ? "afternoon" : "morning";
        const alternativeSlots = windowSlots.filter((slot) =>
            isSlotInPeriod(slot.time, alternative),
        );

        if (alternativeSlots.length === 0) {
            return offerAvailabilityWindow(
                session,
                stage,
                unit,
                addDays(windowEnd, 1),
            );
        }

        return schedulingReply(
            session,
            buildChatbotReply({
                action: "show_menu",
                route: "deterministic",
                stage,
                reply: `Não encontrei horários ${period === "morning" ? "pela manhã" : "à tarde"} nessa semana. Tenho ${alternative === "morning" ? "pela manhã" : "à tarde"}. Serve para você?`,
                options: [
                    {
                        id: `schedule:period:${alternative}`,
                        label:
                            alternative === "morning"
                                ? "Sim, pela manhã"
                                : "Sim, à tarde",
                    },
                    {
                        id: "schedule:availability:no",
                        label: "Outra semana",
                    },
                    {
                        id: "schedule:change_unit",
                        label: "Escolher outra unidade",
                    },
                ],
            }),
        );
    }

    const updated = await updateSession(session.session_key, {
        step: "time",
    });

    return schedulingReply(
        updated,
        buildChatbotReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply: `Perfeito. Estes são os horários disponíveis ${period === "morning" ? "pela manhã" : "à tarde"}:`,
            options: slots.slice(0, 10).map((slot) => ({
                id: slotOptionId(slot),
                label: slotLabel(slot),
            })),
        }),
    );
}

async function handleDateStep(
    session: SchedulingSessionRow,
    message: string,
    stage: ChatbotStage,
) {
    if (!session.unit_id || !session.scheduling_date) {
        return restartAtUnit(session, stage);
    }

    if (isPositiveAvailabilityResponse(message)) {
        const updated = await updateSession(session.session_key, {
            step: "doctor",
        });
        return askDayPeriod(updated, stage);
    }

    if (isNegativeAvailabilityResponse(message)) {
        const unit = await loadUnit(session.unit_id);
        if (!unit) return restartAtUnit(session, stage);

        return offerAvailabilityWindow(
            session,
            stage,
            unit,
            addDays(endOfWeek(session.scheduling_date), 1),
        );
    }

    return schedulingReply(
        session,
        buildChatbotReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply: availabilityQuestionForWindow(session.scheduling_date),
            options: availabilityQuestionOptions(),
        }),
    );
}

async function handleTimeStep(
    session: SchedulingSessionRow,
    message: string,
    stage: ChatbotStage,
) {
    if (!session.unit_id || !session.scheduling_date) {
        return restartAtUnit(session, stage);
    }

    const selected = parseSlotOption(message);
    if (!selected) {
        return schedulingReply(
            session,
            buildChatbotReply({
                action: "reply",
                route: "deterministic",
                stage,
                reply: "Escolha um dos horários disponíveis.",
                options: [],
            }),
        );
    }

    const doctor = await loadDoctor(session.unit_id, selected.doctorId);
    if (!doctor) {
        const unit = await loadUnit(session.unit_id);
        return unit
            ? offerAvailabilityWindow(session, stage, unit)
            : restartAtUnit(session, stage);
    }

    const currentSlots = await loadAvailableSlots(
        session.unit_id,
        selected.doctorId,
        selected.date,
    );
    if (!currentSlots.some((slot) => slot.time === selected.time)) {
        const unit = await loadUnit(session.unit_id);
        if (!unit) return restartAtUnit(session, stage);

        return offerAvailabilityWindow(session, stage, unit);
    }

    const updated = await updateSession(session.session_key, {
        doctor_id: selected.doctorId,
        scheduling_date: selected.date,
        scheduling_time: selected.time,
        step: "name",
    });

    return schedulingReply(
        updated,
        buildChatbotReply({
            action: "reply",
            route: "deterministic",
            stage,
            reply: "Ótimo. Qual é o nome completo da pessoa que fará a consulta?",
            options: [{ id: "schedule:cancel", label: "Cancelar agendamento" }],
        }),
    );
}

async function handleNameStep(
    session: SchedulingSessionRow,
    message: string,
    stage: ChatbotStage,
) {
    const name = message.trim();
    if (name.length < 5 || name.split(/\s+/).length < 2) {
        return schedulingReply(
            session,
            buildChatbotReply({
                action: "reply",
                route: "deterministic",
                stage,
                reply: "Por favor, informe o nome completo.",
                options: [{ id: "schedule:cancel", label: "Cancelar agendamento" }],
            }),
        );
    }

    const updated = await updateSession(session.session_key, {
        patient_name: name,
        step: "confirm",
    });
    return confirmReply(updated, stage);
}

async function handleConfirmStep(
    session: SchedulingSessionRow,
    message: string,
    stage: ChatbotStage,
) {
    const normalized = normalizeText(message);
    if (!isConfirmRequest(normalized)) {
        return confirmReply(session, stage);
    }

    if (!CHATBOT_APPOINTMENT_CREATION_ENABLED) {
        const blocked = await updateSession(session.session_key, {
            step: "blocked",
        });
        return blockedCreationReply(blocked, stage);
    }

    const created = await createAppointment(session);
    const completed = await updateSession(session.session_key, {
        step: "completed",
    });

    return schedulingReply(
        completed,
        buildChatbotReply({
            action: "reply",
            route: "deterministic",
            stage,
            reply: `Agendamento confirmado para ${formatDate(session.scheduling_date!)} às ${session.scheduling_time}. Código do agendamento: ${created.externalId}.`,
            options: [{ id: "common:menu", label: "Voltar ao menu" }],
        }),
    );
}

async function createAppointment(session: SchedulingSessionRow) {
    if (
        !session.unit_id ||
        !session.doctor_id ||
        !session.scheduling_date ||
        !session.scheduling_time ||
        !session.patient_name
    ) {
        throw new Error("O agendamento ainda não possui todos os dados necessários.");
    }

    const [unit, doctor] = await Promise.all([
        loadUnit(session.unit_id),
        loadDoctor(session.unit_id, session.doctor_id),
    ]);
    if (!unit || !doctor) {
        throw new Error("Unidade ou médico não está mais disponível.");
    }

    const slots = await loadAvailableSlots(
        session.unit_id,
        session.doctor_id,
        session.scheduling_date,
    );
    if (!slots.some((slot) => slot.time === session.scheduling_time)) {
        throw new Error("O horário escolhido não está mais disponível.");
    }

    const startsAt = new Date(
        `${session.scheduling_date}T${session.scheduling_time}:00-03:00`,
    );
    const endsAt = new Date(
        startsAt.getTime() + APPOINTMENT_DURATION_MINUTES * 60_000,
    );
    const clientId = await findClientIdByPhone(session.phone);
    const appointmentId = randomUUID();

    const { error: insertError } = await supabase.from("appointments").insert({
        id: appointmentId,
        source: "hub",
        source_external_id: null,
        client_id: clientId,
        thread_id: null,
        unit_id: session.unit_id,
        doctor_id: session.doctor_id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "scheduled",
        format:
            normalizeChatbotStage(session.topic_stage) === "congelamento"
                ? "congelamento"
                : "casal",
        procedure_name: PROCEDURE_NAME,
        patient_name: session.patient_name,
        patient_phone: session.phone,
        notes: "Agendamento criado pelo chatbot Engravida.",
        created_by: null,
        created_by_attendant_id: null,
    });

    if (insertError) throw insertError;

    const appointment = await fetchAppointmentById(supabase, appointmentId);
    if (!appointment) {
        await supabase.from("appointments").delete().eq("id", appointmentId);
        throw new Error("O agendamento não pôde ser recarregado.");
    }

    const integration = await sendAppointmentIntegration(
        buildAppointmentIntegrationPayload("appointment.created", appointment),
    );

    if (!integration.ok || !integration.externalId) {
        await supabase.from("appointments").delete().eq("id", appointmentId);
        throw new Error(
            integration.error ?? "Não foi possível concluir o agendamento.",
        );
    }

    return { id: appointmentId, externalId: integration.externalId };
}

async function confirmReply(
    session: SchedulingSessionRow,
    stage: ChatbotStage,
): Promise<ChatbotSchedulingReply> {
    const [unit, doctor] = await Promise.all([
        session.unit_id ? loadUnit(session.unit_id) : null,
        session.unit_id && session.doctor_id
            ? loadDoctor(session.unit_id, session.doctor_id)
            : null,
    ]);

    return schedulingReply(
        session,
        buildChatbotReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply: [
                "Confirme os dados do agendamento:",
                `Paciente: ${session.patient_name ?? "—"}`,
                `Unidade: ${unit?.name ?? "—"}`,
                `Médico: ${doctor?.name ?? "—"}`,
                `Data: ${session.scheduling_date ? formatDate(session.scheduling_date) : "—"}`,
                `Horário: ${session.scheduling_time ?? "—"}`,
            ].join("\n"),
            options: [
                { id: "schedule:confirm", label: "Confirmar agendamento" },
                { id: "schedule:cancel", label: "Cancelar" },
            ],
        }),
    );
}

async function blockedCreationReply(
    session: SchedulingSessionRow,
    stage: ChatbotStage,
): Promise<ChatbotSchedulingReply> {
    return schedulingReply(
        session,
        buildChatbotReply({
            action: "queue_human",
            route: "deterministic",
            stage,
            reply:
                "Ainda não consigo concluir o agendamento por aqui. Nenhum agendamento foi criado. Nosso time pode concluir para você.",
            options: [],
        }),
        true,
    );
}

async function offerAvailabilityWindow(
    session: SchedulingSessionRow,
    stage: ChatbotStage,
    unit: UnitOption,
    searchFrom?: string,
) {
    const slots = await loadUnitAvailableSlots(unit.id);
    const today = todayInBrazil();
    const minimumDate =
        searchFrom && searchFrom > today ? searchFrom : today;
    const available = slots.filter((slot) => slot.date >= minimumDate);

    if (available.length === 0) {
        const updated = await updateSession(session.session_key, {
            unit_id: unit.id,
            doctor_id: null,
            scheduling_date: null,
            scheduling_time: null,
            step: "unit",
        });

        return schedulingReply(
            updated,
            buildChatbotReply({
                action: "show_menu",
                route: "deterministic",
                stage,
                reply:
                    "No momento não encontrei horários disponíveis nessa unidade. Você pode escolher outra unidade ou aguardar nosso time.",
                options: [
                    {
                        id: "schedule:change_unit",
                        label: "Escolher outra unidade",
                    },
                    {
                        id: "schedule:cancel",
                        label: "Cancelar",
                    },
                ],
            }),
        );
    }

    const thisWeekEnd = endOfWeek(today);
    const nextWeekStart = addDays(thisWeekEnd, 1);
    const nextWeekEnd = endOfWeek(nextWeekStart);
    let windowStart: string;

    if (
        minimumDate <= thisWeekEnd &&
        available.some(
            (slot) => slot.date >= today && slot.date <= thisWeekEnd,
        )
    ) {
        windowStart = today;
    } else if (
        minimumDate <= nextWeekEnd &&
        available.some(
            (slot) =>
                slot.date >= nextWeekStart && slot.date <= nextWeekEnd,
        )
    ) {
        windowStart = nextWeekStart;
    } else {
        windowStart = startOfWeek(available[0].date);
    }

    const updated = await updateSession(session.session_key, {
        unit_id: unit.id,
        doctor_id: null,
        scheduling_date: windowStart,
        scheduling_time: null,
        step: "date",
    });

    return schedulingReply(
        updated,
        buildChatbotReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply: availabilityQuestionForWindow(windowStart),
            options: availabilityQuestionOptions(),
        }),
    );
}

async function askDayPeriod(
    session: SchedulingSessionRow,
    stage: ChatbotStage,
) {
    return schedulingReply(
        session,
        buildChatbotReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply: "Você prefere manhã ou tarde?",
            options: [
                { id: "schedule:period:morning", label: "Manhã" },
                { id: "schedule:period:afternoon", label: "Tarde" },
                {
                    id: "schedule:change_unit",
                    label: "Escolher outra unidade",
                },
            ],
        }),
    );
}

async function restartAtUnit(
    session: SchedulingSessionRow,
    stage: ChatbotStage,
) {
    const units = await loadUnits();
    const updated = await updateSession(session.session_key, {
        step: "unit",
        unit_id: null,
        doctor_id: null,
        scheduling_date: null,
        scheduling_time: null,
    });
    return schedulingReply(
        updated,
        buildChatbotReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply: "Vamos recomeçar a escolha do horário. Em qual unidade você quer ser atendido?",
            options: units.slice(0, 10).map((unit) => ({
                id: `schedule:unit:${unit.id}`,
                label: unitLabel(unit),
            })),
        }),
    );
}

async function loadSession(sessionKey: string) {
    const { data, error } = await supabase
        .from("chatbot_scheduling_sessions")
        .select(
            "session_key, phone, topic_stage, step, unit_id, doctor_id, scheduling_date, scheduling_time, patient_name, created_at, updated_at",
        )
        .eq("session_key", sessionKey)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const session = data as SchedulingSessionRow;
    const updatedAt = new Date(session.updated_at).getTime();
    if (
        Number.isFinite(updatedAt) &&
        Date.now() - updatedAt > SESSION_MAX_AGE_MS
    ) {
        await resetChatbotSchedulingSession(sessionKey);
        return null;
    }

    return session;
}

async function updateSession(
    sessionKey: string,
    values: Partial<
        Pick<
            SchedulingSessionRow,
            | "phone"
            | "topic_stage"
            | "step"
            | "unit_id"
            | "doctor_id"
            | "scheduling_date"
            | "scheduling_time"
            | "patient_name"
        >
    >,
) {
    const { data, error } = await supabase
        .from("chatbot_scheduling_sessions")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("session_key", sessionKey)
        .select(
            "session_key, phone, topic_stage, step, unit_id, doctor_id, scheduling_date, scheduling_time, patient_name, created_at, updated_at",
        )
        .single();

    if (error) throw error;
    return data as SchedulingSessionRow;
}

async function loadUnits(): Promise<UnitOption[]> {
    const { data, error } = await supabase
        .from("units")
        .select("id, name, city, state")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []) as UnitOption[];
}

async function loadUnit(unitId: string): Promise<UnitOption | null> {
    const { data, error } = await supabase
        .from("units")
        .select("id, name, city, state")
        .eq("id", unitId)
        .eq("active", true)
        .maybeSingle();

    if (error) throw error;
    return (data as UnitOption | null) ?? null;
}

async function loadDoctors(unitId: string): Promise<DoctorOption[]> {
    const { data, error } = await supabase
        .from("doctor_units")
        .select(
            "unit_id, doctor:doctors!inner(id, name, specialty, active)",
        )
        .eq("unit_id", unitId)
        .eq("active", true)
        .eq("doctor.active", true);

    if (error) throw error;

    return (data ?? [])
        .flatMap((row) => {
            const doctor = Array.isArray(row.doctor)
                ? row.doctor[0]
                : row.doctor;
            if (!doctor) return [];
            return [
                {
                    id: doctor.id,
                    unit_id: row.unit_id,
                    name: doctor.name,
                    specialty: doctor.specialty ?? null,
                } satisfies DoctorOption,
            ];
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function loadDoctor(unitId: string, doctorId: string) {
    return (
        (await loadDoctors(unitId)).find((doctor) => doctor.id === doctorId) ??
        null
    );
}

async function loadUnitAvailableSlots(
    unitId: string,
): Promise<UnitAvailabilitySlot[]> {
    const [unit, doctors] = await Promise.all([
        loadUnit(unitId),
        loadDoctors(unitId),
    ]);
    if (!unit || doctors.length === 0) return [];

    const results = await Promise.allSettled(
        doctors.map(async (doctor) => {
            const slots = await listClinisysAvailability({
                unitId,
                doctorId: doctor.id,
                unitName: unit.name,
                doctorName: doctor.name,
                procedureName: PROCEDURE_NAME,
            });

            return (slots as AvailabilitySlot[]).flatMap((slot) => {
                const date = toIsoDate(slot.data ?? "");
                const time = normalizeTime(slot.inicio ?? "");
                if (!validIsoDate(date) || !time) return [];
                return [
                    {
                        date,
                        time,
                        doctorId: doctor.id,
                    } satisfies UnitAvailabilitySlot,
                ];
            });
        }),
    );

    const unique = new Map<string, UnitAvailabilitySlot>();
    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const slot of result.value) {
            const key = `${slot.date}|${slot.time}`;
            if (!unique.has(key)) unique.set(key, slot);
        }
    }

    return [...unique.values()].sort(
        (left, right) =>
            left.date.localeCompare(right.date) ||
            left.time.localeCompare(right.time),
    );
}

async function loadAvailableSlots(
    unitId: string,
    doctorId: string,
    date: string,
) {
    const [unit, doctor] = await Promise.all([
        loadUnit(unitId),
        loadDoctor(unitId, doctorId),
    ]);
    if (!unit || !doctor) return [];

    const slots = await listClinisysAvailability({
        unitId,
        doctorId,
        unitName: unit.name,
        doctorName: doctor.name,
        procedureName: PROCEDURE_NAME,
    });

    const unique = new Map<string, { time: string; raw: AvailabilitySlot }>();
    for (const slot of slots as AvailabilitySlot[]) {
        if (toIsoDate(slot.data ?? "") !== date) continue;
        const time = normalizeTime(slot.inicio ?? "");
        if (!time || unique.has(time)) continue;
        unique.set(time, { time, raw: slot });
    }

    return [...unique.values()].sort((a, b) => a.time.localeCompare(b.time));
}

async function loadKnownUnitForPhone(phone: string | null) {
    const identity = normalizePhoneIdentity(phone);
    if (!identity) return null;

    const { data, error } = await supabase
        .from("clients")
        .select("unit_id")
        .eq("phone_identity", identity)
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (!data?.unit_id) return null;

    return loadUnit(data.unit_id);
}

async function findClientIdByPhone(phone: string | null) {
    const identity = normalizePhoneIdentity(phone);
    if (!identity) return null;

    const { data, error } = await supabase
        .from("clients")
        .select("id")
        .eq("phone_identity", identity)
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data?.id ?? null;
}

function selectUnit(message: string, units: UnitOption[]) {
    const id = message.trim().match(/^schedule:unit:([0-9a-f-]{36})$/i)?.[1];
    if (id) return units.find((unit) => unit.id === id) ?? null;

    const wanted = normalizeText(message);
    const exactName = units.find((unit) => normalizeText(unit.name) === wanted);
    if (exactName) return exactName;

    const cityMatches = units.filter(
        (unit) => normalizeText(unit.city ?? "") === wanted,
    );
    return cityMatches.length === 1 ? cityMatches[0] : null;
}

function selectDoctor(message: string, doctors: DoctorOption[]) {
    const id = message.trim().match(/^schedule:doctor:([0-9a-f-]{36})$/i)?.[1];
    if (id) return doctors.find((doctor) => doctor.id === id) ?? null;

    const wanted = normalizeText(message).replace(
        /^(dr|dra|doutor|doutora)\s+/,
        "",
    );
    const matches = doctors.filter((doctor) =>
        normalizeText(doctor.name)
            .replace(/^(dr|dra|doutor|doutora)\s+/, "")
            .includes(wanted),
    );
    return matches.length === 1 ? matches[0] : null;
}

function parseDayPeriod(value: string): DayPeriod | null {
    const normalized = normalizeText(value);
    if (
        normalized === "schedule:period:morning" ||
        /^(manha|de manha|pela manha|prefiro manha)$/.test(normalized)
    ) {
        return "morning";
    }
    if (
        normalized === "schedule:period:afternoon" ||
        /^(tarde|a tarde|de tarde|pela tarde|prefiro tarde)$/.test(normalized)
    ) {
        return "afternoon";
    }
    return null;
}

function isPositiveAvailabilityResponse(value: string) {
    const normalized = normalizeText(value);
    return (
        normalized === "schedule:availability:yes" ||
        /^(sim|tenho|tenho sim|sim tenho|pode ser|consigo|sim consigo|claro|essa semana serve|semana que vem serve)$/.test(
            normalized,
        )
    );
}

function isNegativeAvailabilityResponse(value: string) {
    const normalized = normalizeText(value);
    return (
        normalized === "schedule:availability:no" ||
        /^(nao|acho que nao|nao consigo|essa semana nao|semana que vem nao|outra semana|prefiro outra semana)$/.test(
            normalized,
        )
    );
}

function availabilityQuestionOptions() {
    return [
        { id: "schedule:availability:yes", label: "Sim" },
        { id: "schedule:availability:no", label: "Não" },
        { id: "schedule:change_unit", label: "Escolher outra unidade" },
    ];
}

function availabilityQuestionForWindow(windowStart: string) {
    const today = todayInBrazil();
    const thisWeekEnd = endOfWeek(today);
    const nextWeekStart = addDays(thisWeekEnd, 1);

    if (windowStart >= today && windowStart <= thisWeekEnd) {
        return "Você tem disponibilidade para esta semana?";
    }
    if (windowStart === nextWeekStart) {
        return "Você tem disponibilidade para semana que vem?";
    }
    return `Encontrei horários na semana de ${formatDate(windowStart)}. Você tem disponibilidade nessa semana?`;
}

function slotOptionId(slot: UnitAvailabilitySlot) {
    return `schedule:slot:${slot.doctorId}:${slot.date}:${slot.time.replace(":", "")}`;
}

function parseSlotOption(value: string): UnitAvailabilitySlot | null {
    const match = /^schedule:slot:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}):(\d{2})(\d{2})$/i.exec(
        value.trim(),
    );
    if (!match) return null;

    const time = `${match[3]}:${match[4]}`;
    return validIsoDate(match[2]) && normalizeTime(time)
        ? {
              doctorId: match[1],
              date: match[2],
              time,
          }
        : null;
}

function slotLabel(slot: UnitAvailabilitySlot) {
    const date = new Date(`${slot.date}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        timeZone: "UTC",
    })
        .format(date)
        .replace(".", "");
    return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${formatDate(slot.date)} às ${slot.time}`;
}

function isSlotInPeriod(time: string, period: DayPeriod) {
    const hour = Number(time.slice(0, 2));
    return period === "morning" ? hour < 12 : hour >= 12;
}

function startOfWeek(value: string) {
    const date = new Date(`${value}T12:00:00Z`);
    const day = date.getUTCDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    return date.toISOString().slice(0, 10);
}

function endOfWeek(value: string) {
    return addDays(startOfWeek(value), 6);
}

function parseRequestedDate(value: string) {
    const normalized = normalizeText(value);
    if (normalized === "hoje") return todayInBrazil();
    if (normalized === "amanha") return addDays(todayInBrazil(), 1);

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (iso && validIsoDate(iso[0])) return withinSchedulingWindow(iso[0]);

    const brazil = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(
        value.trim(),
    );
    if (!brazil) return null;

    let year = brazil[3] ? Number(brazil[3]) : Number(todayInBrazil().slice(0, 4));
    const month = Number(brazil[2]);
    const day = Number(brazil[1]);
    let candidate = isoDate(year, month, day);
    if (!candidate) return null;

    if (!brazil[3] && candidate < todayInBrazil()) {
        year += 1;
        candidate = isoDate(year, month, day);
    }

    return candidate ? withinSchedulingWindow(candidate) : null;
}

function withinSchedulingWindow(value: string) {
    const today = todayInBrazil();
    const max = addDays(today, 180);
    return value >= today && value <= max ? value : null;
}

function parseRequestedTime(value: string) {
    const option = /^schedule:time:(\d{2}:\d{2})$/i.exec(value.trim());
    if (option) return option[1];
    return normalizeTime(value);
}

function normalizeTime(value: string) {
    const match = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/.exec(value.trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function unitLabel(unit: UnitOption) {
    if (unit.city && normalizeText(unit.city) !== normalizeText(unit.name)) {
        return `${unit.name} — ${unit.city}`;
    }
    return unit.name;
}

function schedulingReply(
    session: SchedulingSessionRow,
    response: OutOfHoursChatbotReply,
    blocked = false,
): ChatbotSchedulingReply {
    return {
        ...response,
        scheduling: metadata(session, true, blocked),
    };
}

function metadata(
    session: SchedulingSessionRow,
    active: boolean,
    blocked = session.step === "blocked",
): ChatbotSchedulingMetadata {
    return {
        active,
        step: session.step,
        creation_enabled: CHATBOT_APPOINTMENT_CREATION_ENABLED,
        creation_blocked: blocked,
        unit_id: session.unit_id,
        doctor_id: session.doctor_id,
        scheduling_date: session.scheduling_date,
        scheduling_time: session.scheduling_time,
        patient_name: session.patient_name,
    };
}

function isConfirmRequest(value: string) {
    return (
        value === "schedule:confirm" ||
        /^(sim|confirmar|confirmo|pode confirmar|confirmar agendamento)$/.test(
            value,
        )
    );
}

function isCancelRequest(value: string) {
    return (
        value === "schedule:cancel" ||
        value === "common:menu" ||
        value === "menu" ||
        /^(cancelar|cancela|cancelar agendamento|desistir)$/.test(value)
    );
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9:]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function todayInBrazil() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function addDays(value: string, days: number) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function isoDate(year: number, month: number, day: number) {
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

function validIsoDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return Boolean(
        match &&
            isoDate(Number(match[1]), Number(match[2]), Number(match[3])) ===
                value,
    );
}

function formatDate(value: string) {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
}

function toIsoDate(value: string) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
    return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}
