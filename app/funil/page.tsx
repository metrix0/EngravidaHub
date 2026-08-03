// app/funil/page.tsx
"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
    CalendarDays,
    CalendarCheck,
    CircleAlert,
    ExternalLink,
    Trash2,
    TrendingUp,
    UserCheck,
    Users,
} from "lucide-react";

import {
    AdvancedFilterButton,
    Badge,
    Card,
    DashboardHeader,
    HorizontalScroller,
    KpiCard,
    MainFilters,
    Pagination,
    Skeleton,
    SearchFilter,
} from "@/components";

import SidePanel from "@/components/layout/SidePanel";

import {
    applyArrayParams,
    applyCalendarDateParams,
} from "@/components/ui/CalendarButton";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import ClientPanel from "@/components/clientes/ClientPanel";
import SchedulingPanel from "@/components/inbox/SchedulingPanel";
import AppointmentDetailsPanel from "@/components/scheduling/AppointmentDetailsPanel";
import { Modal } from "@/components/ui/Modal";
import type { FiltersResponse } from "@/types";
import type {
    AppointmentStatus,
    CalendarAppointment,
    SchedulingDoctorOption,
    SchedulingUnitOption,
} from "@/types/scheduling";

type Funnel = {
    id: string;
    name: string;
    active: boolean;
};

type Unit = {
    id: string;
    name: string;
    active: boolean;
};

type AvailableClient = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    unit_id: string | null;
    first_seen_at: string;
    last_interaction_at: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    created_at: string;
    updated_at: string;
};

type AvailableClientsResponse = {
    clients: AvailableClient[];
    stages: FunnelStage[];
};

type FunnelStage = {
    id: string;
    funnel_id: string;
    name: string;
    position: number;
    color: string | null;
};

type FunnelScheduleSummary = {
    id: string;
    scheduled_for: string;
    procedure_name: string | null;
    status: string | null;
    status_group: string;
    event_kind: "evaluation" | "procedure" | null;
    attention: boolean;
    attention_label: "Cancelou" | "Faltou" | null;
};

type Client = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    unit_id: string | null;
    last_interaction_at: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    updated_at: string;
    schedule_summary: FunnelScheduleSummary | null;
    appointment: CalendarAppointment | null;
};

type FunnelKpis = {
    evaluations_scheduled: number;
    evaluation_show_rate: number;
    procedures_scheduled: number;
    procedure_show_rate: number;
};

type FunnelResponse = {
    funnels: Funnel[];
    stages: FunnelStage[];
    units: Unit[];
    clients: Client[];
    kpis: FunnelKpis;
    previous_kpis: FunnelKpis;
};

const DEFAULT_FUNNEL_ID = "22222222-2222-2222-2222-222222222222";

const EMPTY_FUNNEL_KPIS: FunnelKpis = {
    evaluations_scheduled: 0,
    evaluation_show_rate: 0,
    procedures_scheduled: 0,
    procedure_show_rate: 0,
};

export default function FunnelPage() {
    const [funnels, setFunnels] = useState<Funnel[]>([]);
    const [stages, setStages] = useState<FunnelStage[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [kpis, setKpis] = useState<FunnelKpis>(EMPTY_FUNNEL_KPIS);
    const [previousKpis, setPreviousKpis] =
        useState<FunnelKpis>(EMPTY_FUNNEL_KPIS);

    const [loading, setLoading] = useState(true);
    const [loadingFilters, setLoadingFilters] = useState(true);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("30");

    const [addClientModalOpen, setAddClientModalOpen] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [selectedAppointment, setSelectedAppointment] =
        useState<CalendarAppointment | null>(null);
    const [schedulingClientId, setSchedulingClientId] =
        useState<string | null>(null);
    const [schedulingUnits, setSchedulingUnits] = useState<
        SchedulingUnitOption[]
    >([]);
    const [schedulingDoctors, setSchedulingDoctors] = useState<
        SchedulingDoctorOption[]
    >([]);
    const [availableClients, setAvailableClients] = useState<AvailableClient[]>([]);
    const [availableStages, setAvailableStages] = useState<FunnelStage[]>([]);
    const [availableClientsLoading, setAvailableClientsLoading] = useState(false);
    const [clientSearch, setClientSearch] = useState("");
    const [addingClientId, setAddingClientId] = useState<string | null>(null);
    const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
    const [addingManyClients, setAddingManyClients] = useState(false);
    const [availableClientsPage, setAvailableClientsPage] = useState(1);

    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [funnelIds, setFunnelIds] = useState<string[]>([]);
    const [sourceValues, setSourceValues] = useState<string[]>([]);
    const [search, setSearch] = useState("");

    const defaultFunnelId =
        funnels.find((funnel) => funnel.id === DEFAULT_FUNNEL_ID)?.id ??
        funnels[0]?.id ??
        null;

    const selectedFunnelId = funnelIds[0] ?? defaultFunnelId;


    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();

        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units,origins",
                    { signal: controller.signal },
                );
                if (!response.ok) {
                    throw new Error("Falha ao carregar filtros do funil.");
                }
                const json: FiltersResponse = await response.json();

                setFilters(json);
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[funil] filters failed", error);
            } finally {
                if (!controller.signal.aborted) setLoadingFilters(false);
            }
        }

        void loadFilters();
        return () => controller.abort();
    }, [dateFilterReady]);

    const loadFunnelData = useCallback(
        async ({
            showLoading = true,
            signal,
        }: {
            showLoading?: boolean;
            signal?: AbortSignal;
        } = {}) => {
            if (showLoading) {
                setLoading(true);
            }

            try {
                const params = new URLSearchParams();

                applyCalendarDateParams({
                    params,
                    selectedRange,
                    selectedPreset: period,
                });

                applyArrayParams(params, {
                    unit_ids: unitIds,
                });

                const response = await fetch(`/api/funnel?${params.toString()}`, {
                    cache: "no-store",
                    signal,
                });

                if (!response.ok) {
                    const body = await response.json().catch(() => null);
                    throw new Error(
                        body?.error ?? "Falha ao carregar o funil.",
                    );
                }

                const data = (await response.json()) as FunnelResponse;

                setFunnels(data.funnels ?? []);
                setStages(data.stages ?? []);
                setClients(data.clients ?? []);
                setKpis(data.kpis ?? EMPTY_FUNNEL_KPIS);
                setPreviousKpis(data.previous_kpis ?? EMPTY_FUNNEL_KPIS);

                const defaultFunnel =
                    data.funnels?.find(
                        (funnel) => funnel.id === DEFAULT_FUNNEL_ID,
                    ) ?? data.funnels?.[0];

                setFunnelIds((current) => {
                    const currentId = current[0];
                    const selectedFunnelStillExists = data.funnels?.some(
                        (funnel) => funnel.id === currentId,
                    );
                    return !selectedFunnelStillExists && defaultFunnel?.id
                        ? [defaultFunnel.id]
                        : current;
                });
            } catch (error) {
                if (signal?.aborted) return;
                console.error("[funil] load failed", error);
            } finally {
                if (showLoading && !signal?.aborted) {
                    setLoading(false);
                }
            }
        },
        [period, unitIds, selectedRange],
    );

    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();
        const debounceId = window.setTimeout(() => {
            void loadFunnelData({ signal: controller.signal });
        }, 150);

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [dateFilterReady, loadFunnelData]);

    const visibleStages = useMemo(() => {
        if (!selectedFunnelId) return [];

        return stages.filter((stage) => stage.funnel_id === selectedFunnelId);
    }, [stages, selectedFunnelId]);

    const visibleStageIds = useMemo(() => {
        return new Set(visibleStages.map((stage) => stage.id));
    }, [visibleStages]);

    const filteredClients = useMemo(() => {
        const term = search.trim().toLowerCase();

        return clients.filter((client) => {
            if (!client.funnel_stage_id) return false;
            if (!visibleStageIds.has(client.funnel_stage_id)) return false;

            if (
                sourceValues.length > 0 &&
                !sourceValues.includes(client.utm_source ?? "-")
            ) {
                return false;
            }

            if (!term) return true;

            return (
                client.name?.toLowerCase().includes(term) ||
                client.phone?.toLowerCase().includes(term) ||
                client.email?.toLowerCase().includes(term)
            );
        });
    }, [clients, search, sourceValues, visibleStageIds]);

    const clientsByStage = useMemo(() => {
        const grouped: Record<string, Client[]> = {};

        for (const stage of visibleStages) {
            grouped[stage.id] = filteredClients
                .filter((client) => client.funnel_stage_id === stage.id)
                .sort(sortFunnelClients);
        }

        return grouped;
    }, [filteredClients, visibleStages]);

    const firstStageInSelectedFunnel = visibleStages[0] ?? null;

    const availableStageById = useMemo(() => {
        return new Map(availableStages.map((stage) => [stage.id, stage]));
    }, [availableStages]);

    const filteredAvailableClients = useMemo(() => {
        const term = clientSearch.trim().toLowerCase();

        return availableClients
            .filter((client) => {
                if (!term) return true;

                return (
                    client.name?.toLowerCase().includes(term) ||
                    client.phone?.toLowerCase().includes(term) ||
                    client.email?.toLowerCase().includes(term)
                );
            })
            .sort(
                (a, b) =>
                    new Date(b.last_interaction_at).getTime() -
                    new Date(a.last_interaction_at).getTime()
            );
    }, [availableClients, clientSearch]);

    const selectedFunnel = funnels.find(
        (funnel) => funnel.id === selectedFunnelId
    );

    const totalClients = filteredClients.length;
    const schedulingClient = schedulingClientId
        ? clients.find((client) => client.id === schedulingClientId) ?? null
        : null;
    const schedulingInitialSchedule = useMemo(() => {
        const schedule = schedulingClient?.schedule_summary;
        if (!schedule) return null;

        return {
            scheduledFor: schedule.scheduled_for,
            procedureName: schedule.procedure_name,
        };
    }, [schedulingClient?.schedule_summary]);

    const toggleSelectedClient = useCallback((clientId: string) => {
        setSelectedClientIds((current) =>
            current.includes(clientId)
                ? current.filter((id) => id !== clientId)
                : [...current, clientId]
        );
    }, []);

    const clearSelectedClients = useCallback(() => {
        setSelectedClientIds([]);
    }, []);

    async function addSelectedClientsToFunnel() {
        if (!selectedFunnelId || !firstStageInSelectedFunnel) return;
        if (selectedClientIds.length === 0) return;

        const selectedClients = availableClients.filter((client) =>
            selectedClientIds.includes(client.id)
        );

        setAddingManyClients(true);

        for (const client of selectedClients) {
            const alreadyInCurrentFunnel = visibleStageIds.has(
                client.funnel_stage_id ?? ""
            );

            if (alreadyInCurrentFunnel) continue;

            const response = await fetch("/api/funnel/client-stage", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    client_id: client.id,
                    funnel_id: selectedFunnelId,
                    from_stage_id: client.funnel_stage_id,
                    to_stage_id: firstStageInSelectedFunnel.id,
                    moved_by_attendant_id: null,
                }),
            });

            if (!response.ok) {
                console.error("Failed to add selected client", {
                    status: response.status,
                    statusText: response.statusText,
                    body: await readJsonSafely(response),
                    client,
                });
                continue;
            }

            const updatedClient = {
                ...client,
                funnel_stage_id: firstStageInSelectedFunnel.id,
                updated_at: new Date().toISOString(),
                schedule_summary: null,
                appointment: null,
            };

            setAvailableClients((current) =>
                current.map((item) => (item.id === client.id ? updatedClient : item))
            );

            setClients((current) => {
                const exists = current.some((item) => item.id === client.id);

                if (exists) {
                    return current.map((item) =>
                        item.id === client.id ? updatedClient : item
                    );
                }

                return [updatedClient, ...current];
            });

        }

        setAddingManyClients(false);
        closeAddClientModal();

        await loadFunnelData({ showLoading: false });
    }

    function closeAddClientModal() {
        setAddClientModalOpen(false);
    }

    function resetAddClientModal() {
        setClientSearch("");
        clearSelectedClients();
        setAvailableClientsPage(1);
    }

    async function openAddClientModal() {
        setAddClientModalOpen(true);
        setAvailableClientsLoading(true);

        const params = new URLSearchParams();

        applyArrayParams(params, {
            unit_ids: unitIds,
        });

        const queryString = params.toString();

        const response = await fetch(
            `/api/funnel/available-clients${queryString ? `?${queryString}` : ""}`,
            {
                cache: "no-store",
            }
        );

        if (!response.ok) {
            setAvailableClientsLoading(false);
            console.error(await response.json());
            return;
        }

        const data = (await response.json()) as AvailableClientsResponse;

        setAvailableClients(data.clients ?? []);
        setAvailableStages(data.stages ?? []);
        setAvailableClientsLoading(false);
    }

    async function moveClient(clientId: string, toStageId: string) {
        if (!selectedFunnelId) return;

        const client = clients.find((client) => client.id === clientId);

        if (!client) return;

        const fromStageId = client.funnel_stage_id;

        if (fromStageId === toStageId) return;

        const previousClients = clients;
        const now = new Date().toISOString();

        setClients((current) =>
            current.map((client) =>
                client.id === clientId
                    ? {
                        ...client,
                        funnel_stage_id: toStageId,
                        updated_at: now,
                    }
                    : client
            )
        );


        const response = await fetch("/api/funnel/client-stage", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: clientId,
                funnel_id: selectedFunnelId,
                from_stage_id: fromStageId,
                to_stage_id: toStageId,
                moved_by_attendant_id: null,
            }),
        });

        if (!response.ok) {
            setClients(previousClients);
            await loadFunnelData({ showLoading: false });
            console.error(await response.json());
            return;
        }

        await loadFunnelData({ showLoading: false });
    }

    function openClientProfile(clientId: string) {
        setSelectedClientId(clientId);
    }

    async function openClientSchedule(clientId: string) {
        const client = clients.find((item) => item.id === clientId);
        if (!client) return;

        if (!client.appointment) {
            setSchedulingClientId(clientId);
            return;
        }

        if (schedulingUnits.length === 0 || schedulingDoctors.length === 0) {
            try {
                const response = await fetch("/api/scheduling/options", {
                    cache: "no-store",
                });
                const json = await response.json();
                if (!response.ok) {
                    throw new Error(
                        json?.error ??
                            "Não foi possível carregar as opções do agendamento.",
                    );
                }

                setSchedulingUnits(json.units ?? []);
                setSchedulingDoctors(json.doctors ?? []);
            } catch (optionsError) {
                window.alert(
                    optionsError instanceof Error
                        ? optionsError.message
                        : "Não foi possível abrir o agendamento.",
                );
                return;
            }
        }

        setSelectedAppointment(client.appointment);
    }

    async function saveAppointment(
        appointment: CalendarAppointment,
        input: {
            startsAt: string;
            endsAt: string;
            unitId: string;
            doctorId: string;
            status: AppointmentStatus;
            procedureName: string;
            notes: string;
        },
    ) {
        const response = await fetch(
            `/api/scheduling/appointments/${appointment.id}`,
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            },
        );
        const json = await response.json();

        if (!response.ok) {
            throw new Error(
                json?.error ?? "Não foi possível atualizar o agendamento.",
            );
        }

        const saved = json.appointment as CalendarAppointment;
        setSelectedAppointment(saved);
        setClients((current) =>
            current.map((client) =>
                client.id === saved.client_id
                    ? { ...client, appointment: saved }
                    : client,
            ),
        );
        await loadFunnelData({ showLoading: false });
    }

    async function deleteAppointment(appointment: CalendarAppointment) {
        const response = await fetch(
            `/api/scheduling/appointments/${appointment.id}`,
            { method: "DELETE" },
        );
        const json = await response.json();

        if (!response.ok) {
            throw new Error(
                json?.error ?? "Não foi possível excluir o agendamento.",
            );
        }

        setSelectedAppointment(null);
        await loadFunnelData({ showLoading: false });
    }

    async function removeClientFromFunnel(clientId: string) {
        if (!selectedFunnelId) return;

        const client = clients.find((client) => client.id === clientId);

        if (!client?.funnel_stage_id) return;

        const previousClients = clients;
        const fromStageId = client.funnel_stage_id;

        setClients((current) =>
            current.map((client) =>
                client.id === clientId
                    ? {
                        ...client,
                        funnel_stage_id: null,
                        updated_at: new Date().toISOString(),
                    }
                    : client
            )
        );

        const response = await fetch("/api/funnel/client-stage", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: clientId,
                funnel_id: selectedFunnelId,
                from_stage_id: fromStageId,
                to_stage_id: null,
                moved_by_attendant_id: null,
            }),
        });

        if (!response.ok) {
            setClients(previousClients);
            console.error(await response.json());
            return;
        }

        await loadFunnelData({ showLoading: false });
    }

    async function addClientToFunnel(client: AvailableClient) {
        if (!selectedFunnelId || !firstStageInSelectedFunnel) return;

        const alreadyInCurrentFunnel = visibleStageIds.has(
            client.funnel_stage_id ?? ""
        );

        if (alreadyInCurrentFunnel) return;

        setAddingClientId(client.id);

        const response = await fetch("/api/funnel/client-stage", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: client.id,
                funnel_id: selectedFunnelId,
                from_stage_id: client.funnel_stage_id,
                to_stage_id: firstStageInSelectedFunnel.id,
                moved_by_attendant_id: null,
            }),
        });

        if (!response.ok) {
            setAddingClientId(null);
            console.error("Failed to add client", {
                status: response.status,
                statusText: response.statusText,
                body: await readJsonSafely(response),
                client,
            });
            return;
        }

        const updatedClient = {
            ...client,
            funnel_stage_id: firstStageInSelectedFunnel.id,
            updated_at: new Date().toISOString(),
            schedule_summary: null,
            appointment: null,
        };

        setAvailableClients((current) =>
            current.map((item) => (item.id === client.id ? updatedClient : item))
        );

        setClients((current) => {
            const exists = current.some((item) => item.id === client.id);

            if (exists) {
                return current.map((item) =>
                    item.id === client.id ? updatedClient : item
                );
            }

            return [updatedClient, ...current];
        });


        setAddingClientId(null);
        closeAddClientModal();

        await loadFunnelData({ showLoading: false });
    }

    if (loading || loadingFilters) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel />

                <section className="min-w-0 flex-1 px-8 py-8">
                    <div className="mb-8 flex items-start justify-between">
                        <div>
                            <Skeleton className="h-10 w-48" />
                            <Skeleton className="mt-3 h-5 w-96" />
                        </div>
                        <Skeleton className="h-12 w-[310px] rounded-xl" />
                    </div>

                    <div className="mb-8 flex justify-end">
                        <Skeleton className="h-12 w-[230px] rounded-xl" />
                    </div>

                    <section className="mb-8 grid grid-cols-1 gap-5">
                        <HorizontalScroller scrollAmount={400}>
                            {Array.from({length: 4}).map((_, index) => (
                                <Skeleton key={index} className="h-32 min-w-[310px] rounded-2xl" />
                            ))}
                        </HorizontalScroller>
                    </section>

                    <section>
                        <div className="mb-5 flex items-center justify-between gap-6">
                            <div>
                                <Skeleton className="h-7 w-[180px]" />
                                <Skeleton className="mt-2 h-4 w-[250px]" />
                            </div>
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-11 w-[360px] rounded-xl" />
                                <Skeleton className="h-11 w-[120px] rounded-xl" />
                                <Skeleton className="h-11 w-[105px] rounded-xl" />
                            </div>
                        </div>

                        <div className="overflow-hidden pb-16">
                            <HorizontalScroller scrollAmount={520}>
                                {Array.from({length: 4}).map((_, columnIndex) => (
                                    <div key={columnIndex} className="min-h-[560px] w-[260px] shrink-0 rounded-xl border border-border bg-slate-50 p-3">
                                        <div className="mb-4 flex items-center justify-between">
                                            <Skeleton className="h-4 w-[120px]" />
                                            <Skeleton className="h-6 w-8 rounded-md" />
                                        </div>
                                        <div className="space-y-3">
                                            {Array.from({length: 4}).map((_, cardIndex) => (
                                                <div key={cardIndex} className="rounded-xl border border-slate-100 bg-white p-3">
                                                    <div className="flex gap-3">
                                                        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                                                        <div className="min-w-0 flex-1">
                                                            <Skeleton className="h-4 w-[75%]" />
                                                            <Skeleton className="mt-2 h-3 w-[58%]" />
                                                            <div className="mt-3 flex justify-between">
                                                                <Skeleton className="h-6 w-16 rounded-md" />
                                                                <Skeleton className="h-3 w-12" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </HorizontalScroller>
                        </div>
                    </section>
                </section>
            </main>
        );
    }

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />

            <section className="min-w-0 flex-1 px-8 py-8">
                <DashboardHeader
                    title="Funil"
                    description="Acompanhe e mova clientes pelo funil comercial"
                    period={period}
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    storageManaged
                    storageReady={dateFilterReady}
                />

                <div className="mb-8 flex justify-end gap-3">
                    {/*<FilterButton*/}
                    {/*    label={selectedFunnel?.name ?? "Funnel Comercial Principal"}*/}
                    {/*    values={funnelIds}*/}
                    {/*    onChange={(values) => {*/}
                    {/*        setFunnelIds(values.slice(0, 1));*/}
                    {/*    }}*/}
                    {/*    options={funnels.map((funnel) => ({*/}
                    {/*        label: funnel.name,*/}
                    {/*        value: funnel.id,*/}
                    {/*    }))}*/}
                    {/*    widthClassName="w-[260px]"*/}
                    {/*/>*/}

                    <MainFilters
                        units={filters?.units}
                        unitValues={unitIds}
                        setUnitValues={setUnitIds}
                        show={{
                            attendants: false,
                            tunnels: false,
                            origins: false,
                        }}
                    />
                </div>

                <section className="mb-8 grid grid-cols-1 gap-5">
                    <HorizontalScroller scrollAmount={400}>
                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<CalendarCheck size={26} />}
                                label="Avaliações agendadas"
                                currentValue={kpis.evaluations_scheduled}
                                previousValue={previousKpis.evaluations_scheduled}
                                color="purple"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<UserCheck size={26} />}
                                label="Comparecimento avaliação"
                                currentValue={kpis.evaluation_show_rate}
                                previousValue={previousKpis.evaluation_show_rate}
                                suffix="%"
                                color="green"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<TrendingUp size={26} />}
                                label="Procedimentos agendados"
                                currentValue={kpis.procedures_scheduled}
                                previousValue={previousKpis.procedures_scheduled}
                                color="pink"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<Users size={26} />}
                                label="Comparecimento procedimento"
                                currentValue={kpis.procedure_show_rate}
                                previousValue={previousKpis.procedure_show_rate}
                                suffix="%"
                                color="blue"
                            />
                        </div>
                    </HorizontalScroller>
                </section>

                <section>
                    <div className="mb-5 flex items-center justify-between gap-6">
                        <div>
                            <h2 className="text-xl font-bold text-text">
                                {selectedFunnel?.name ?? "Funil FIV"}
                            </h2>

                            <p className="mt-1 text-sm text-muted">
                                {totalClients} clientes distribuídos em{" "}
                                {visibleStages.length} etapas
                            </p>
                        </div>

                        <div className="flex items-center gap-3">
                            <SearchFilter
                                value={search}
                                onChange={setSearch}
                                placeholder="Buscar cliente ou telefone..."
                                widthClassName="w-[360px]"
                            />

                            <AdvancedFilterButton
                                sections={[
                                    {
                                        id: "source",
                                        title: "Origem",
                                        values: sourceValues,
                                        onChange: setSourceValues,
                                        options: filters?.origins ?? [],
                                    },
                                ]}
                            />

                            <button
                                type="button"
                                onClick={openAddClientModal}
                                className="flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                            >
                                + Cliente
                            </button>
                        </div>
                    </div>

                    <div className="max-w-[calc(100vw-320px)] overflow-hidden pb-16">
                        <HorizontalScroller scrollAmount={520}>
                            {visibleStages.map((stage) => {
                                const stageClients = clientsByStage[stage.id] ?? [];

                                return (
                                    <FunnelColumn
                                        key={stage.id}
                                        stage={stage}
                                        clients={stageClients}
                                        onMoveClient={moveClient}
                                        onRemoveClient={removeClientFromFunnel}
                                        onOpenClientProfile={openClientProfile}
                                        onOpenClientSchedule={openClientSchedule}
                                    />
                                );
                            })}
                        </HorizontalScroller>
                    </div>
                </section>
            </section>

            <AddClientToFunnelModal
                open={addClientModalOpen}
                clients={filteredAvailableClients}
                stageById={availableStageById}
                selectedFunnelStageIds={visibleStageIds}
                selectedClientIds={selectedClientIds}
                currentPage={availableClientsPage}
                onPageChange={setAvailableClientsPage}
                search={clientSearch}
                setSearch={(value) => {
                    setClientSearch(value);
                    setAvailableClientsPage(1);
                }}
                loading={availableClientsLoading}
                addingClientId={addingClientId}
                addingManyClients={addingManyClients}
                firstStageName={firstStageInSelectedFunnel?.name ?? null}
                onClose={closeAddClientModal}
                onExitComplete={resetAddClientModal}
                onAddClient={addClientToFunnel}
                onToggleClient={toggleSelectedClient}
                onAddSelectedClients={addSelectedClientsToFunnel}
            />

            <ClientPanel
                clientId={selectedClientId}
                onClose={() => setSelectedClientId(null)}
            />

            <SchedulingPanel
                open={Boolean(schedulingClientId)}
                clientId={schedulingClientId}
                initialSchedule={schedulingInitialSchedule}
                onClose={() => setSchedulingClientId(null)}
                onCreated={async () => {
                    setSchedulingClientId(null);
                    await loadFunnelData({ showLoading: false });
                }}
                onOpenClientProfile={openClientProfile}
            />

            <AppointmentDetailsPanel
                appointment={selectedAppointment}
                units={schedulingUnits}
                doctors={schedulingDoctors}
                onClose={() => setSelectedAppointment(null)}
                onSave={saveAppointment}
                onDelete={deleteAppointment}
            />
        </main>
    );
}

function FunnelColumn({
                            stage,
                            clients,
                            onMoveClient,
                            onRemoveClient,
                            onOpenClientProfile,
                            onOpenClientSchedule,
                        }: {
    stage: FunnelStage;
    clients: Client[];
    onMoveClient: (clientId: string, stageId: string) => void;
    onRemoveClient: (clientId: string) => void;
    onOpenClientProfile: (clientId: string) => void;
    onOpenClientSchedule: (clientId: string) => void;
}) {
    const COLLAPSED_CLIENTS = 5;
    const CLIENTS_PER_BATCH = 20;
    const [visibleLimit, setVisibleLimit] = useState(COLLAPSED_CLIENTS);
    const visibleClients = clients.slice(0, visibleLimit);
    const hiddenClientsCount = Math.max(0, clients.length - visibleLimit);

    return (
        <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                const clientId = event.dataTransfer.getData("client_id");
                if (clientId) onMoveClient(clientId, stage.id);
            }}
            className="min-h-[560px] w-[260px] shrink-0 rounded-xl border border-border bg-slate-50 p-3"
        >
            <div className="mb-3 flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: stage.color ?? "#64748b" }}
                    />

                    <h3 className="truncate text-sm font-bold text-text">
                        {stage.name}
                    </h3>
                </div>

                <span className="rounded-md bg-slate-200 px-2 py-1 text-xs font-bold text-muted">
                    {clients.length}
                </span>
            </div>

            <div className="space-y-3">
                {visibleClients.map((client) => (
                    <FunnelClientCard
                        key={client.id}
                        client={client}
                        onRemoveClient={onRemoveClient}
                        onOpenClientProfile={onOpenClientProfile}
                        onOpenClientSchedule={onOpenClientSchedule}
                    />
                ))}
            </div>

            {clients.length > COLLAPSED_CLIENTS ? (
                <div className="mt-5 flex items-center justify-center gap-3 text-sm font-semibold">
                    {hiddenClientsCount > 0 ? (
                        <button
                            type="button"
                            onClick={() =>
                                setVisibleLimit((current) =>
                                    Math.min(
                                        clients.length,
                                        current + CLIENTS_PER_BATCH,
                                    ),
                                )
                            }
                            className="cursor-pointer text-blue"
                        >
                            + Ver mais{" "}
                            {Math.min(
                                CLIENTS_PER_BATCH,
                                hiddenClientsCount,
                            )}
                        </button>
                    ) : null}
                    {visibleLimit > COLLAPSED_CLIENTS ? (
                        <button
                            type="button"
                            onClick={() =>
                                setVisibleLimit(COLLAPSED_CLIENTS)
                            }
                            className="cursor-pointer text-slate-500"
                        >
                            − Ver menos
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function FunnelClientCard({
                                client,
                                onRemoveClient,
                                onOpenClientProfile,
                                onOpenClientSchedule,
                            }: {
    client: Client;
    onRemoveClient: (clientId: string) => void;
    onOpenClientProfile: (clientId: string) => void;
    onOpenClientSchedule: (clientId: string) => void;
}) {
    const schedule = client.schedule_summary;

    return (
        <Card
            className={[
                "group relative overflow-hidden rounded-xl p-3",
                schedule?.attention ? "ring-2 ring-red-200" : "",
            ].join(" ")}
        >
            {schedule?.attention && (
                <span className="absolute inset-y-0 left-0 w-1 bg-red" />
            )}

            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                    type="button"
                    title="Remover do funil"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemoveClient(client.id);
                    }}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-red-50 text-slate-500 shadow-sm transition hover:bg-soft-red hover:text-red"
                >
                    <Trash2 size={14} />
                </button>

                <button
                    type="button"
                    title={
                        client.appointment
                            ? "Editar agendamento"
                            : "Agendar cliente"
                    }
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpenClientSchedule(client.id);
                    }}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-blue-50 text-slate-500 shadow-sm transition hover:bg-blue-100 hover:text-blue-700"
                >
                    <CalendarDays size={14} />
                </button>

                <button
                    type="button"
                    title="Abrir perfil do cliente"
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpenClientProfile(client.id);
                    }}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-slate-100 text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-700"
                >
                    <ExternalLink size={14} />
                </button>
            </div>

            <div
                draggable
                onDragStart={(event) => {
                    event.dataTransfer.setData("client_id", client.id);
                }}
                className="flex cursor-grab gap-3 active:cursor-grabbing"
            >
                <InitialsAvatar name={client.name ?? "Cliente"} />

                <div className="min-w-0 flex-1 pr-1">
                    <div className="truncate text-sm font-bold text-text">
                        {client.name ?? "Cliente sem nome"}
                    </div>

                    <div className="mt-1 truncate text-xs text-muted">
                        {client.phone ?? "Sem telefone"}
                    </div>

                    {schedule?.attention_label && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red">
                            <CircleAlert size={11} />
                            {schedule.attention_label}
                        </div>
                    )}

                    <div
                        className="mt-3 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-muted"
                        title={
                            schedule
                                ? `${schedule.procedure_name ?? "Agendamento"} · ${
                                      schedule.status ?? "Sem status"
                                  }`
                                : "Nenhum agendamento ligado ao cliente"
                        }
                    >
                        <CalendarDays size={12} className="shrink-0" />
                        <span className="truncate">
                            {schedule
                                ? formatScheduleDate(schedule.scheduled_for)
                                : "Sem agendamento"}
                        </span>
                    </div>
                </div>
            </div>
        </Card>
    );
}

function sortFunnelClients(left: Client, right: Client) {
    const attentionDifference =
        Number(Boolean(right.schedule_summary?.attention)) -
        Number(Boolean(left.schedule_summary?.attention));
    if (attentionDifference !== 0) return attentionDifference;

    const leftDistance = scheduleDistanceFromToday(
        left.schedule_summary?.scheduled_for,
    );
    const rightDistance = scheduleDistanceFromToday(
        right.schedule_summary?.scheduled_for,
    );
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;

    return (
        dateOnlyTime(right.schedule_summary?.scheduled_for) -
        dateOnlyTime(left.schedule_summary?.scheduled_for)
    );
}

function scheduleDistanceFromToday(value: string | null | undefined) {
    if (!value) return Number.POSITIVE_INFINITY;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.abs(dateOnlyTime(value) - today.getTime());
}

function dateOnlyTime(value: string | null | undefined) {
    if (!value) return 0;
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day, 12).getTime();
}

function formatScheduleDate(value: string) {
    const [year, month, day] = value.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
}

function timeAgo(date: string) {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 60) return `${Math.max(minutes, 1)} min`;
    if (hours < 24) return `${hours} h`;
    return `${days} dia${days > 1 ? "s" : ""}`;
}

function AddClientToFunnelModal({
                                      open,
                                      clients,
                                      stageById,
                                      selectedFunnelStageIds,
                                      selectedClientIds,
                                      currentPage,
                                      onPageChange,
                                      search,
                                      setSearch,
                                      loading,
                                      addingClientId,
                                      addingManyClients,
                                      firstStageName,
                                      onClose,
                                      onExitComplete,
                                      onAddClient,
                                      onToggleClient,
                                      onAddSelectedClients,
                                  }: {
    open: boolean;
    clients: AvailableClient[];
    stageById: Map<string, FunnelStage>;
    selectedFunnelStageIds: Set<string>;
    selectedClientIds: string[];
    currentPage: number;
    onPageChange: (page: number) => void;
    search: string;
    setSearch: (value: string) => void;
    loading: boolean;
    addingClientId: string | null;
    addingManyClients: boolean;
    firstStageName: string | null;
    onClose: () => void;
    onExitComplete: () => void;
    onAddClient: (client: AvailableClient) => void;
    onToggleClient: (clientId: string) => void;
    onAddSelectedClients: () => void;
}) {
    const selectedCount = selectedClientIds.length;

    const selectedIdsSet = useMemo(() => {
        return new Set(selectedClientIds);
    }, [selectedClientIds]);

    const clientsPerPage = 10;

    const totalPages = Math.max(1, Math.ceil(clients.length / clientsPerPage));

    const safeCurrentPage = Math.min(currentPage, totalPages);

    const paginatedClients = clients.slice(
        (safeCurrentPage - 1) * clientsPerPage,
        safeCurrentPage * clientsPerPage
    );

    const gridTemplateColumns = "44px minmax(0, 1fr) 150px 140px 85px 120px";

    return (
        <Modal
            open={open}
            onClose={onClose}
            onExitComplete={onExitComplete}
            width={920}
            maxWidth="calc(100vw - 48px)"
            height="82vh"
            maxHeight="82vh"
        >
            <div className="flex shrink-0 items-start justify-between border-border px-6 pt-5 pb-2 pr-16">
                <div>
                    <h2 className="text-2xl font-bold text-text">
                        Adicionar cliente
                    </h2>

                    <p className="mt-1 text-sm text-muted">
                        Selecione clientes para adicionar em{" "}
                        <span className="font-bold text-text">
                            {firstStageName ?? "primeira etapa"}
                        </span>
                        .
                    </p>
                </div>
            </div>

            <div className="shrink-0 border-b border-border px-6 py-4">
                <SearchFilter
                    value={search}
                    onChange={setSearch}
                    placeholder="Buscar por nome, telefone ou email..."
                    widthClassName="w-full"
                />
            </div>

            <div
                className="grid shrink-0 items-center border-b border-border bg-slate-50 px-4 py-3 text-xs font-bold tracking-wide text-muted"
                style={{ gridTemplateColumns }}
            >
                <div />
                <div>Cliente</div>
                <div>Origem</div>
                <div>Estágio atual</div>
                <div className="whitespace-nowrap">Último contato</div>
                <div className="text-center">Ação</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {loading ? (
                    <div className="space-y-3 p-6">
                        <Skeleton className="h-16 rounded-xl" />
                        <Skeleton className="h-16 rounded-xl" />
                        <Skeleton className="h-16 rounded-xl" />
                    </div>
                ) : clients.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-6">
                        <div className="flex h-52 w-full items-center justify-center rounded-xl border border-dashed border-border bg-slate-50 text-sm font-medium text-muted">
                            Nenhum cliente encontrado.
                        </div>
                    </div>
                ) : (
                    <div>
                        {paginatedClients.map((client) => {
                            const currentStage = client.funnel_stage_id
                                ? stageById.get(client.funnel_stage_id)
                                : null;

                            const alreadyInCurrentFunnel =
                                selectedFunnelStageIds.has(
                                    client.funnel_stage_id ?? ""
                                );

                            return (
                                <SelectableClientRow
                                    key={client.id}
                                    client={client}
                                    currentStageName={
                                        currentStage?.name ?? "Sem funil"
                                    }
                                    checked={selectedIdsSet.has(client.id)}
                                    alreadyInCurrentFunnel={
                                        alreadyInCurrentFunnel
                                    }
                                    addingClientId={addingClientId}
                                    addingManyClients={addingManyClients}
                                    onToggleClient={onToggleClient}
                                    onAddClient={onAddClient}
                                />
                            );
                        })}
                    </div>
                )}

                <div className="flex justify-center pt-12 pb-8">
                    {totalPages > 1 && (
                        <Pagination
                            totalPages={totalPages}
                            currentPage={safeCurrentPage}
                            onPageChange={onPageChange}
                        />
                    )}
                </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-white px-6 py-4">
                <div className="min-w-[220px]">
                    <p className="text-sm text-muted">
                        {clients.length} cliente
                        {clients.length === 1 ? "" : "s"} encontrado
                        {clients.length === 1 ? "" : "s"}

                        {selectedCount > 0 && (
                            <span className="font-semibold text-text">
                                {" "}
                                • {selectedCount} selecionado
                                {selectedCount === 1 ? "" : "s"}
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex min-w-[290px] items-center justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-10 cursor-pointer rounded-xl border border-border bg-white px-5 text-sm font-semibold text-text shadow-sm transition hover:bg-slate-50"
                    >
                        Fechar
                    </button>

                    <button
                        type="button"
                        disabled={selectedCount === 0 || addingManyClients}
                        onClick={onAddSelectedClients}
                        className={[
                            "h-10 rounded-xl px-5 text-sm font-semibold shadow-sm transition",
                            selectedCount === 0 || addingManyClients
                                ? "cursor-not-allowed bg-slate-100 text-slate-400"
                                : "cursor-pointer bg-brand text-white hover:opacity-90",
                        ].join(" ")}
                    >
                        {addingManyClients
                            ? "Adicionando..."
                            : `Adicionar selecionados${
                                selectedCount > 0 ? ` (${selectedCount})` : ""
                            }`}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

const SelectableClientRow = memo(function SelectableClientRow({
                                                                  client,
                                                                  currentStageName,
                                                                  checked,
                                                                  alreadyInCurrentFunnel,
                                                                  addingClientId,
                                                                  addingManyClients,
                                                                  onToggleClient,
                                                                  onAddClient,
                                                              }: {
    client: AvailableClient;
    currentStageName: string;
    checked: boolean;
    alreadyInCurrentFunnel: boolean;
    addingClientId: string | null;
    addingManyClients: boolean;
    onToggleClient: (clientId: string) => void;
    onAddClient: (client: AvailableClient) => void;
}) {
    const gridTemplateColumns = "44px minmax(0, 1fr) 150px 140px 85px 120px";

    return (
        <div
            className={[
                "grid min-h-[76px] items-center border-b border-slate-100 px-4 py-3",
                alreadyInCurrentFunnel
                    ? "bg-slate-50 opacity-55"
                    : "hover:bg-slate-50",
            ].join(" ")}
            style={{ gridTemplateColumns }}
        >
            <div>
                <button
                    type="button"
                    disabled={alreadyInCurrentFunnel}
                    onClick={() => onToggleClient(client.id)}
                    className={[
                        "flex h-5 w-5 items-center justify-center rounded-md border text-[13px] font-bold leading-none",
                        checked
                            ? "border-brand bg-brand text-white"
                            : "border-slate-300 bg-white text-transparent hover:border-brand",
                        alreadyInCurrentFunnel
                            ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                            : "cursor-pointer bg-brand text-white shadow-sm hover:opacity-90",
                    ].join(" ")}
                >
                    ✓
                </button>
            </div>

            <div className="min-w-0 pr-3">
                <div className="flex min-w-0 items-center gap-3">
                    <InitialsAvatar name={client.name ?? "Cliente"} />

                    <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-text">
                            {client.name ?? "Cliente sem nome"}
                        </div>

                        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted">
                            <span className="truncate">
                                {client.phone ?? "Sem telefone"}
                            </span>

                            {client.email && (
                                <>
                                    <span className="text-slate-300">•</span>
                                    <span className="truncate">{client.email}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="min-w-0 pr-3">
                <Badge value={client.utm_source} />
            </div>

            <div className="min-w-0 pr-3">
                <Badge value={currentStageName} />
            </div>

            <div className="flex justify-center whitespace-nowrap text-sm text-slate-700">
                {timeAgo(client.last_interaction_at)}
            </div>

            <div className="text-right">
                <button
                    type="button"
                    disabled={
                        alreadyInCurrentFunnel ||
                        addingClientId === client.id ||
                        addingManyClients
                    }
                    onClick={() => onAddClient(client)}
                    className={[
                        "h-9 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition",
                        alreadyInCurrentFunnel
                            ? "cursor-not-allowed bg-slate-100 text-slate-400"
                            : "cursor-pointer bg-brand text-white shadow-sm hover:opacity-90",
                    ].join(" ")}
                >
                    {alreadyInCurrentFunnel
                        ? "Adicionado"
                        : addingClientId === client.id
                            ? "..."
                            : "Adicionar"}
                </button>
            </div>
        </div>
    );
});

async function readJsonSafely(response: Response) {
    const text = await response.text();

    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
