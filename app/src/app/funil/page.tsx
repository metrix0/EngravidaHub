// app/src/app/funil/page.tsx
"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
    CalendarCheck,
    ExternalLink,
    Filter,
    MapPin,
    Search,
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
    Pagination,
    Skeleton,
} from "@engravida/components";

import SidePanelCRM from "../../components/layout/SidePanelCRM";

import {
    applyArrayParams,
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@engravida/components/ui/CalendarButton";
import { InitialsAvatar } from "@engravida/components/conversations/InitialsAvatar";
import { Modal } from "@engravida/components/ui/Modal";

type Pipeline = {
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
    pipeline_stage_id: string | null;
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
    stages: PipelineStage[];
};

type PipelineStage = {
    id: string;
    pipeline_id: string;
    name: string;
    position: number;
    color: string | null;
};

type Client = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    pipeline_stage_id: string | null;
    unit_id: string | null;
    last_interaction_at: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    updated_at: string;
};

type PipelineKpis = {
    pipeline_entries: number;
    evaluations_done: number;
    procedures_scheduled: number;
    procedure_conversion_rate: number;
};

type PipelineResponse = {
    pipelines: Pipeline[];
    stages: PipelineStage[];
    units: Unit[];
    clients: Client[];
    kpis: PipelineKpis;
    previous_kpis: PipelineKpis;
};

const DEFAULT_PIPELINE_ID = "22222222-2222-2222-2222-222222222222";

const EMPTY_PIPELINE_KPIS: PipelineKpis = {
    pipeline_entries: 0,
    evaluations_done: 0,
    procedures_scheduled: 0,
    procedure_conversion_rate: 0,
};

export default function PipelinePage() {
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [stages, setStages] = useState<PipelineStage[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [kpis, setKpis] = useState<PipelineKpis>(EMPTY_PIPELINE_KPIS);
    const [previousKpis, setPreviousKpis] =
        useState<PipelineKpis>(EMPTY_PIPELINE_KPIS);

    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<CalendarPresetValue | null>("30");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });

    const [addClientModalOpen, setAddClientModalOpen] = useState(false);
    const [availableClients, setAvailableClients] = useState<AvailableClient[]>([]);
    const [availableStages, setAvailableStages] = useState<PipelineStage[]>([]);
    const [availableClientsLoading, setAvailableClientsLoading] = useState(false);
    const [clientSearch, setClientSearch] = useState("");
    const [addingClientId, setAddingClientId] = useState<string | null>(null);
    const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
    const [addingManyClients, setAddingManyClients] = useState(false);
    const [availableClientsPage, setAvailableClientsPage] = useState(1);

    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [pipelineIds, setPipelineIds] = useState<string[]>([]);
    const [sourceValues, setSourceValues] = useState<string[]>([]);
    const [search, setSearch] = useState("");

    const defaultPipelineId =
        pipelines.find((pipeline) => pipeline.id === DEFAULT_PIPELINE_ID)?.id ??
        pipelines[0]?.id ??
        null;

    const selectedPipelineId = pipelineIds[0] ?? defaultPipelineId;

    const unitOptions = useMemo(() => {
        return units.map((unit) => ({
            label: unit.name,
            value: unit.id,
        }));
    }, [units]);

    const loadPipelineData = useCallback(
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

            params.set("pipeline_id", selectedPipelineId ?? DEFAULT_PIPELINE_ID);

            const response = await fetch(`/api/pipeline?${params.toString()}`, {
                cache: "no-store",
            });

            if (!response.ok) {
                if (showLoading) {
                    setLoading(false);
                }

                console.error(await response.json());
                return;
            }

            const data = (await response.json()) as PipelineResponse;

            setPipelines(data.pipelines ?? []);
            setStages(data.stages ?? []);
            setUnits(data.units ?? []);
            setClients(data.clients ?? []);
            setKpis(data.kpis ?? EMPTY_PIPELINE_KPIS);
            setPreviousKpis(data.previous_kpis ?? EMPTY_PIPELINE_KPIS);

            const defaultPipeline =
                data.pipelines?.find((pipeline) => pipeline.id === DEFAULT_PIPELINE_ID) ??
                data.pipelines?.[0];

            const selectedPipelineStillExists = data.pipelines?.some(
                (pipeline) => pipeline.id === selectedPipelineId
            );

            if (!selectedPipelineStillExists && defaultPipeline?.id) {
                setPipelineIds([defaultPipeline.id]);
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
            selectedPipelineId,
        ]
    );

    useEffect(() => {
        loadPipelineData();
    }, [loadPipelineData]);

    const visibleStages = useMemo(() => {
        if (!selectedPipelineId) return [];

        return stages.filter((stage) => stage.pipeline_id === selectedPipelineId);
    }, [stages, selectedPipelineId]);

    const visibleStageIds = useMemo(() => {
        return new Set(visibleStages.map((stage) => stage.id));
    }, [visibleStages]);

    const filteredClients = useMemo(() => {
        const term = search.trim().toLowerCase();

        return clients.filter((client) => {
            if (!client.pipeline_stage_id) return false;
            if (!visibleStageIds.has(client.pipeline_stage_id)) return false;

            if (
                sourceValues.length > 0 &&
                !sourceValues.includes(client.utm_source ?? "direct")
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
                (client) => client.pipeline_stage_id === stage.id
            );
        }

        return grouped;
    }, [filteredClients, visibleStages]);

    const firstStageInSelectedPipeline = visibleStages[0] ?? null;

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

    const selectedPipeline = pipelines.find(
        (pipeline) => pipeline.id === selectedPipelineId
    );

    const totalClients = filteredClients.length;

    function getStageNameById(stageId: string | null) {
        if (!stageId) return "";

        return normalize(stages.find((stage) => stage.id === stageId)?.name ?? "");
    }

    function calculateProcedureConversionRate(nextKpis: PipelineKpis) {
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
                next.pipeline_entries += 1;
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

    async function addSelectedClientsToPipeline() {
        if (!selectedPipelineId || !firstStageInSelectedPipeline) return;
        if (selectedClientIds.length === 0) return;

        const selectedClients = availableClients.filter((client) =>
            selectedClientIds.includes(client.id)
        );

        setAddingManyClients(true);

        for (const client of selectedClients) {
            const alreadyInCurrentPipeline = visibleStageIds.has(
                client.pipeline_stage_id ?? ""
            );

            if (alreadyInCurrentPipeline) continue;

            const response = await fetch("/api/pipeline/client-stage", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    client_id: client.id,
                    pipeline_id: selectedPipelineId,
                    from_stage_id: client.pipeline_stage_id,
                    to_stage_id: firstStageInSelectedPipeline.id,
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
                pipeline_stage_id: firstStageInSelectedPipeline.id,
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
                fromStageId: client.pipeline_stage_id,
                toStageId: firstStageInSelectedPipeline.id,
            });
        }

        setAddingManyClients(false);
        closeAddClientModal();

        await loadPipelineData({ showLoading: false });
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
            `/api/pipeline/available-clients${queryString ? `?${queryString}` : ""}`,
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
        if (!selectedPipelineId) return;

        const client = clients.find((client) => client.id === clientId);

        if (!client) return;

        const fromStageId = client.pipeline_stage_id;

        if (fromStageId === toStageId) return;

        const previousClients = clients;
        const now = new Date().toISOString();

        setClients((current) =>
            current.map((client) =>
                client.id === clientId
                    ? {
                        ...client,
                        pipeline_stage_id: toStageId,
                        updated_at: now,
                    }
                    : client
            )
        );

        incrementLiveKpis({
            fromStageId,
            toStageId,
        });

        const response = await fetch("/api/pipeline/client-stage", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: clientId,
                pipeline_id: selectedPipelineId,
                from_stage_id: fromStageId,
                to_stage_id: toStageId,
                moved_by_attendant_id: null,
            }),
        });

        if (!response.ok) {
            setClients(previousClients);
            await loadPipelineData({ showLoading: false });
            console.error(await response.json());
            return;
        }

        await loadPipelineData({ showLoading: false });
    }

    function openClientProfile(clientId: string) {
        window.location.href = `/clientes?client_id=${clientId}`;
    }

    async function removeClientFromPipeline(clientId: string) {
        if (!selectedPipelineId) return;

        const client = clients.find((client) => client.id === clientId);

        if (!client?.pipeline_stage_id) return;

        const previousClients = clients;
        const fromStageId = client.pipeline_stage_id;

        setClients((current) =>
            current.map((client) =>
                client.id === clientId
                    ? {
                        ...client,
                        pipeline_stage_id: null,
                        updated_at: new Date().toISOString(),
                    }
                    : client
            )
        );

        const response = await fetch("/api/pipeline/client-stage", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: clientId,
                pipeline_id: selectedPipelineId,
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

        await loadPipelineData({ showLoading: false });
    }

    async function addClientToPipeline(client: AvailableClient) {
        if (!selectedPipelineId || !firstStageInSelectedPipeline) return;

        const alreadyInCurrentPipeline = visibleStageIds.has(
            client.pipeline_stage_id ?? ""
        );

        if (alreadyInCurrentPipeline) return;

        setAddingClientId(client.id);

        const response = await fetch("/api/pipeline/client-stage", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: client.id,
                pipeline_id: selectedPipelineId,
                from_stage_id: client.pipeline_stage_id,
                to_stage_id: firstStageInSelectedPipeline.id,
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
            pipeline_stage_id: firstStageInSelectedPipeline.id,
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
            fromStageId: client.pipeline_stage_id,
            toStageId: firstStageInSelectedPipeline.id,
        });

        setAddingClientId(null);
        closeAddClientModal();

        await loadPipelineData({ showLoading: false });
    }

    if (loading) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanelCRM />

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
            <SidePanelCRM />

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
                    {/*    label={selectedPipeline?.name ?? "Funil Comercial Principal"}*/}
                    {/*    values={pipelineIds}*/}
                    {/*    onChange={(values) => {*/}
                    {/*        setPipelineIds(values.slice(0, 1));*/}
                    {/*    }}*/}
                    {/*    options={pipelines.map((pipeline) => ({*/}
                    {/*        label: pipeline.name,*/}
                    {/*        value: pipeline.id,*/}
                    {/*    }))}*/}
                    {/*    widthClassName="w-[260px]"*/}
                    {/*/>*/}

                    {/*<FilterButton*/}
                    {/*    icon={<User size={16}/>}*/}
                    {/*    label="Todos os atendentes"*/}
                    {/*    options={[]}*/}
                    {/*    widthClassName="w-[230px]"*/}
                    {/*/>*/}

                    <FilterButton
                        icon={<MapPin size={16} />}
                        label="Todas as unidades"
                        values={unitIds}
                        onChange={setUnitIds}
                        options={unitOptions}
                        widthClassName="w-[230px]"
                    />
                </div>

                <section className="mb-8 grid grid-cols-1 gap-5">
                    <HorizontalScroller scrollAmount={400}>
                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<Users size={26} />}
                                label="Entradas no funil"
                                currentValue={kpis.pipeline_entries}
                                previousValue={previousKpis.pipeline_entries}
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
                                {selectedPipeline?.name ?? "Funil FIV"}
                            </h2>

                            <p className="mt-1 text-sm text-muted">
                                {totalClients} clientes distribuídos em{" "}
                                {visibleStages.length} etapas
                            </p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-[360px] items-center gap-3 rounded-xl border border-border bg-white px-4 shadow-sm">
                                <Search size={17} className="text-muted" />

                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Buscar cliente ou telefone..."
                                    className="w-full bg-transparent text-sm text-text outline-none placeholder:text-slate-400"
                                />
                            </div>

                            <AdvancedFilterButton
                                icon={<Filter size={16} />}
                                sections={[
                                    {
                                        id: "source",
                                        title: "Origem",
                                        values: sourceValues,
                                        onChange: setSourceValues,
                                        options: [
                                            { label: "Meta Ads", value: "meta_ads" },
                                            { label: "Instagram", value: "instagram" },
                                            { label: "Google", value: "google" },
                                            { label: "Direto", value: "direct" },
                                        ],
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
                                    <PipelineColumn
                                        key={stage.id}
                                        stage={stage}
                                        clients={stageClients}
                                        onMoveClient={moveClient}
                                        onRemoveClient={removeClientFromPipeline}
                                        onOpenClientProfile={openClientProfile}
                                    />
                                );
                            })}
                        </HorizontalScroller>
                    </div>
                </section>
            </section>

            <AddClientToPipelineModal
                open={addClientModalOpen}
                clients={filteredAvailableClients}
                stageById={availableStageById}
                selectedPipelineStageIds={visibleStageIds}
                selectedClientIds={selectedClientIds}
                currentPage={availableClientsPage}
                onPageChange={setAvailableClientsPage}
                search={clientSearch}
                setSearch={setClientSearch}
                loading={availableClientsLoading}
                addingClientId={addingClientId}
                addingManyClients={addingManyClients}
                firstStageName={firstStageInSelectedPipeline?.name ?? null}
                onClose={closeAddClientModal}
                onExitComplete={resetAddClientModal}
                onAddClient={addClientToPipeline}
                onToggleClient={toggleSelectedClient}
                onAddSelectedClients={addSelectedClientsToPipeline}
            />
        </main>
    );
}

function PipelineColumn({
                            stage,
                            clients,
                            onMoveClient,
                            onRemoveClient,
                            onOpenClientProfile,
                        }: {
    stage: PipelineStage;
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
                    <PipelineClientCard
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

function PipelineClientCard({
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
                    title="Remover do pipeline"
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
                        <span className="rounded-md bg-blue-soft px-2 py-1 text-[11px] font-bold text-blue">
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
    const map: Record<string, string> = {
        meta_ads: "Meta Ads",
        facebook: "Meta Ads",
        instagram: "Instagram",
        google: "Google",
        direct: "Direto",
    };

    return map[source ?? "direct"] ?? source ?? "Direto";
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

function AddClientToPipelineModal({
                                      open,
                                      clients,
                                      stageById,
                                      selectedPipelineStageIds,
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
    stageById: Map<string, PipelineStage>;
    selectedPipelineStageIds: Set<string>;
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
                <div className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-4 shadow-sm">
                    <Search size={17} className="shrink-0 text-muted" />

                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Buscar por nome, telefone ou email..."
                        className="w-full bg-transparent text-sm text-text outline-none placeholder:text-slate-400"
                    />
                </div>
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
                            const currentStage = client.pipeline_stage_id
                                ? stageById.get(client.pipeline_stage_id)
                                : null;

                            const alreadyInCurrentPipeline =
                                selectedPipelineStageIds.has(
                                    client.pipeline_stage_id ?? ""
                                );

                            return (
                                <SelectableClientRow
                                    key={client.id}
                                    client={client}
                                    currentStageName={
                                        currentStage?.name ?? "Sem pipeline"
                                    }
                                    checked={selectedIdsSet.has(client.id)}
                                    alreadyInCurrentPipeline={
                                        alreadyInCurrentPipeline
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
                                                                  alreadyInCurrentPipeline,
                                                                  addingClientId,
                                                                  addingManyClients,
                                                                  onToggleClient,
                                                                  onAddClient,
                                                              }: {
    client: AvailableClient;
    currentStageName: string;
    checked: boolean;
    alreadyInCurrentPipeline: boolean;
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
                alreadyInCurrentPipeline
                    ? "bg-slate-50 opacity-55"
                    : "hover:bg-slate-50",
            ].join(" ")}
            style={{ gridTemplateColumns }}
        >
            <div>
                <button
                    type="button"
                    disabled={alreadyInCurrentPipeline}
                    onClick={() => onToggleClient(client.id)}
                    className={[
                        "flex h-5 w-5 items-center justify-center rounded-md border text-[13px] font-bold leading-none",
                        checked
                            ? "border-brand bg-brand text-white"
                            : "border-slate-300 bg-white text-transparent hover:border-brand",
                        alreadyInCurrentPipeline
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
                {client.utm_source !== null && (
                    <span className="inline-flex max-w-full truncate rounded-md bg-blue-soft px-2 py-1 text-xs font-bold text-blue">
                        {sourceLabel(client.utm_source)}
                    </span>
                )}
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
                        alreadyInCurrentPipeline ||
                        addingClientId === client.id ||
                        addingManyClients
                    }
                    onClick={() => onAddClient(client)}
                    className={[
                        "h-9 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition",
                        alreadyInCurrentPipeline
                            ? "cursor-not-allowed bg-slate-100 text-slate-400"
                            : "cursor-pointer bg-brand text-white shadow-sm hover:opacity-90",
                    ].join(" ")}
                >
                    {alreadyInCurrentPipeline
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