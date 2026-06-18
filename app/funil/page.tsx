// app/funil/page.tsx
"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
    CalendarCheck,
    ExternalLink,
    Trash2,
    TrendingUp,
    Users,
} from "lucide-react";

import {
    AdvancedFilterButton,
    Card,
    DashboardHeader,
    FilterButton,
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
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { Modal } from "@/components/ui/Modal";
import type { FiltersResponse } from "@/types";

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
};

type FunnelKpis = {
    funnel_entries: number;
    evaluations_done: number;
    procedures_scheduled: number;
    procedure_conversion_rate: number;
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
    funnel_entries: 0,
    evaluations_done: 0,
    procedures_scheduled: 0,
    procedure_conversion_rate: 0,
};

export default function FunnelPage() {
    const [funnels, setFunnels] = useState<Funnel[]>([]);
    const [stages, setStages] = useState<FunnelStage[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [kpis, setKpis] = useState<FunnelKpis>(EMPTY_FUNNEL_KPIS);
    const [previousKpis, setPreviousKpis] =
        useState<FunnelKpis>(EMPTY_FUNNEL_KPIS);

    const [loading, setLoading] = useState(true);
    const [loadingFilters, setLoadingFilters] = useState(true);
    const [period, setPeriod] = useState<CalendarPresetValue | null>("30");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });

    const [addClientModalOpen, setAddClientModalOpen] = useState(false);
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
        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units,origins"
                );
                const json: FiltersResponse = await response.json();

                setFilters(json);
            } finally {
                setLoadingFilters(false);
            }
        }

        loadFilters();
    }, []);

    const loadFunnelData = useCallback(
        async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
            if (showLoading) {
                setLoading(true);
            }

            const params = new URLSearchParams();

            applyCalendarDateParams({
                params,
                selectedRange,
                selectedPreset: period,
            });

            applyArrayParams(params, {
                unit_ids: unitIds,
            });

            params.set("funnel_id", selectedFunnelId ?? DEFAULT_FUNNEL_ID);

            const response = await fetch(`/api/funnel?${params.toString()}`, {
                cache: "no-store",
            });

            if (!response.ok) {
                if (showLoading) {
                    setLoading(false);
                }

                console.error(await response.json());
                return;
            }

            const data = (await response.json()) as FunnelResponse;

            setFunnels(data.funnels ?? []);
            setStages(data.stages ?? []);
            setUnits(data.units ?? []);
            setClients(data.clients ?? []);
            setKpis(data.kpis ?? EMPTY_FUNNEL_KPIS);
            setPreviousKpis(data.previous_kpis ?? EMPTY_FUNNEL_KPIS);

            const defaultFunnel =
                data.funnels?.find((funnel) => funnel.id === DEFAULT_FUNNEL_ID) ??
                data.funnels?.[0];

            const selectedFunnelStillExists = data.funnels?.some(
                (funnel) => funnel.id === selectedFunnelId
            );

            if (!selectedFunnelStillExists && defaultFunnel?.id) {
                setFunnelIds([defaultFunnel.id]);
            }

            if (showLoading) {
                setLoading(false);
            }
        },
        [
            period,
            unitIds,
            selectedRange.start,
            selectedRange.end,
            selectedFunnelId,
        ]
    );

    useEffect(() => {
        loadFunnelData();
    }, [loadFunnelData]);

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
            grouped[stage.id] = filteredClients.filter(
                (client) => client.funnel_stage_id === stage.id
            );
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

    useEffect(() => {
        setAvailableClientsPage(1);
    }, [clientSearch]);

    const selectedFunnel = funnels.find(
        (funnel) => funnel.id === selectedFunnelId
    );

    const totalClients = filteredClients.length;

    function getStageNameById(stageId: string | null) {
        if (!stageId) return "";

        return normalize(stages.find((stage) => stage.id === stageId)?.name ?? "");
    }

    function calculateProcedureConversionRate(nextKpis: FunnelKpis) {
        if (nextKpis.evaluations_done === 0) return 0;

        return Math.round(
            (nextKpis.procedures_scheduled / nextKpis.evaluations_done) * 1000
        ) / 10;
    }

    function incrementLiveKpis({
                                   fromStageId,
                                   toStageId,
                               }: {
        fromStageId: string | null;
        toStageId: string | null;
    }) {
        const fromStageName = getStageNameById(fromStageId);
        const toStageName = getStageNameById(toStageId);

        setKpis((current) => {
            const next = { ...current };

            if (!fromStageId && toStageId) {
                next.funnel_entries += 1;
            }

            if (toStageName.includes("avaliacao realizada")) {
                next.evaluations_done += 1;
            }

            if (
                fromStageName.includes("avaliacao realizada") &&
                toStageName.includes("procedimento agendado")
            ) {
                next.procedures_scheduled += 1;
            }

            next.procedure_conversion_rate = calculateProcedureConversionRate(next);

            return next;
        });
    }

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

            incrementLiveKpis({
                fromStageId: client.funnel_stage_id,
                toStageId: firstStageInSelectedFunnel.id,
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

        incrementLiveKpis({
            fromStageId,
            toStageId,
        });

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
        window.location.href = `/clientes?client_id=${clientId}`;
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

        incrementLiveKpis({
            fromStageId: client.funnel_stage_id,
            toStageId: firstStageInSelectedFunnel.id,
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
                    <div className="mb-8">
                        <Skeleton className="h-10 w-48" />
                        <Skeleton className="mt-3 h-5 w-96" />
                    </div>

                    <div className="grid grid-cols-4 gap-5">
                        <Skeleton className="h-32 rounded-2xl" />
                        <Skeleton className="h-32 rounded-2xl" />
                        <Skeleton className="h-32 rounded-2xl" />
                        <Skeleton className="h-32 rounded-2xl" />
                    </div>
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
                                icon={<Users size={26} />}
                                label="Entradas no funil"
                                currentValue={kpis.funnel_entries}
                                previousValue={previousKpis.funnel_entries}
                                color="purple"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<CalendarCheck size={26} />}
                                label="Avaliações realizadas"
                                currentValue={kpis.evaluations_done}
                                previousValue={previousKpis.evaluations_done}
                                color="green"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<TrendingUp size={26} />}
                                label="Conversão p/ procedimento"
                                currentValue={kpis.procedure_conversion_rate}
                                previousValue={previousKpis.procedure_conversion_rate}
                                suffix="%"
                                color="pink"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<TrendingUp size={26} />}
                                label="Procedimentos agendados"
                                currentValue={kpis.procedures_scheduled}
                                previousValue={previousKpis.procedures_scheduled}
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
                setSearch={setClientSearch}
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
        </main>
    );
}

function FunnelColumn({
                            stage,
                            clients,
                            onMoveClient,
                            onRemoveClient,
                            onOpenClientProfile,
                        }: {
    stage: FunnelStage;
    clients: Client[];
    onMoveClient: (clientId: string, stageId: string) => void;
    onRemoveClient: (clientId: string) => void;
    onOpenClientProfile: (clientId: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    const visibleClients = expanded ? clients : clients.slice(0, 5);
    const hiddenClientsCount = clients.length - 5;

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
                    />
                ))}
            </div>

            {clients.length > 5 && (
                <button
                    type="button"
                    onClick={() => setExpanded((current) => !current)}
                    className="mt-5 w-full cursor-pointer text-center text-sm font-semibold text-blue"
                >
                    {expanded
                        ? "− Ver menos"
                        : `+ Ver mais ${hiddenClientsCount}`}
                </button>
            )}
        </div>
    );
}

function FunnelClientCard({
                                client,
                                onRemoveClient,
                                onOpenClientProfile,
                            }: {
    client: Client;
    onRemoveClient: (clientId: string) => void;
    onOpenClientProfile: (clientId: string) => void;
}) {
    return (
        <Card className="group relative rounded-xl p-3">
            <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
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

                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-text">
                        {client.name ?? "Cliente sem nome"}
                    </div>

                    <div className="mt-1 truncate text-xs text-muted">
                        {client.phone ?? "Sem telefone"}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                        <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${sourceBadgeClass(client.utm_source)}`}>
                            {sourceLabel(client.utm_source)}
                        </span>

                        <span className="text-[11px] font-medium text-muted">
                            {timeAgo(client.last_interaction_at)}
                        </span>
                    </div>
                </div>
            </div>
        </Card>
    );
}

function sourceLabel(source: string | null) {
    const normalized = normalize(source ?? "");

    if (!normalized || normalized === "direct" || normalized === "direto") {
        return "—";
    }

    const map: Record<string, string> = {
        meta_ads: "Meta Ads",
        facebook: "Meta Ads",
        instagram: "Instagram",
        google: "Google",
    };

    return map[normalized] ?? source ?? "—";
}

function sourceBadgeClass(source: string | null) {
    return sourceLabel(source) === "—"
        ? "bg-slate-100 text-slate-500"
        : "bg-blue-soft text-blue";
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

function normalize(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
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
                <span className={`inline-flex max-w-full truncate rounded-md px-2 py-1 text-xs font-bold ${sourceBadgeClass(client.utm_source)}`}>
                    {sourceLabel(client.utm_source)}
                </span>
            </div>

            <div className="min-w-0 pr-3">
                <span className="inline-flex max-w-full truncate rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                    {currentStageName}
                </span>
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
