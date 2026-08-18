// app/clientes/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    CalendarCheck,
    ChevronRight,
    Clock,
    Filter,
    Users,
} from "lucide-react";

import {
    AdvancedFilterButton,
    Badge,
    DashboardHeader,
    DashboardFilterBar,
    DashboardFilterBarSkeleton,
    HorizontalScroller,
    KpiCard,
    MainFilters,
    Pagination,
    Skeleton,
    DataTable,
    TableHeaderPreset,
    type DataTableColumn,
} from "@/components";

import SidePanel from "@/components/layout/SidePanel";

import {
    getDateRangeFromPreset,
    type CalendarPreset,
    CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import type { FiltersResponse } from "@/types";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { ConversationPanel } from "@/components/conversations/ConversationPanel";
import { openClientProfile } from "@/components/clientes/PermanentClientProfilePanel";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import {
    getNormalizedUrlOptionNames,
    normalizeUrlFilterName,
    readUrlFilterValue,
    readUrlFilterValues,
    replaceUrlFilterParams,
    resolveUrlOptionValues,
} from "@/lib/dashboard/urlFilterParams";

type FunnelStage = {
    id: string;
    funnel_id: string;
    name: string;
    position: number;
    color: string | null;
    funnel_name?: string | null;
    funnel?: {
        id: string;
        name: string | null;
    } | null;
};

type Client = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    funnel_stage_id: string | null;
    unit_id: string | null;
    last_closing_tag: string | null;
    first_seen_at: string;
    last_interaction_at: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    last_tunnel: string | null;
    attendant_name: string | null;
};

type ClientsResponse = {
    clients: Client[];
    stages: FunnelStage[];
};

type ClientTableRow = {
    client: Client;
    stage: FunnelStage | null;
};

const CLIENTS_PER_PAGE = 100;

const CLIENTES_DATE_PRESETS: CalendarPreset[] = [
    {
        label: "Sempre",
        value: "always",
        startOffsetDays: 0,
        endOffsetDays: 0,
    },
    {
        label: "Ontem",
        value: "yesterday",
        startOffsetDays: -1,
        endOffsetDays: -1,
    },
    {
        label: "7 dias",
        value: "7",
        startOffsetDays: -6,
        endOffsetDays: 0,
    },
    {
        label: "30 dias",
        value: "30",
        startOffsetDays: -29,
        endOffsetDays: 0,
    },
    {
        label: "Mês atual",
        value: "current_month",
        startOffsetDays: 0,
        endOffsetDays: 0,
    },
    {
        label: "Mês anterior",
        value: "previous_month",
        startOffsetDays: 0,
        endOffsetDays: 0,
    },
];


const CLIENT_COLUMNS: DataTableColumn<ClientTableRow>[] = [
    {
        id: "client",
        label: "Cliente",
        width: "22%",
        render: ({client}) => (
            <div className="flex min-w-0 items-center gap-3">
                <InitialsAvatar name={client.name ?? "Cliente"}/>

                <span
                    title={client.name ?? "Cliente sem nome"}
                    className="truncate font-medium text-slate-700"
                >
                    {client.name ?? "Cliente sem nome"}
                </span>
            </div>
        ),
    },
    {
        id: "phone",
        label: "Telefone",
        width: "12%",
        render: ({client}) => (
            <div className="truncate text-slate-700">
                {formatPhone(client.phone)}
            </div>
        ),
    },
    {
        id: "funnel",
        label: "Funil",
        width: "14%",
        render: ({stage}) => {
            const funnelName = getFunnelName(stage);

            return (
                <div title={funnelName} className="min-w-0">
                    <Badge value={stage?.name ?? null} />
                </div>
            );
        },
    },
    {
        id: "origin",
        label: "Origem",
        width: "11%",
        render: ({client}) => (
            <Badge value={client.utm_source} />
        ),
    },
    {
        id: "tunnel",
        label: "Túnel",
        width: "11%",
        render: ({client}) => <Badge value={client.last_tunnel} />,
    },
    {
        id: "last_interaction",
        label: "Última interação",
        width: "15%",
        render: ({client}) => (
            <div className="truncate text-slate-700">
                {timeAgo(client.last_interaction_at)}
            </div>
        ),
    },
    {
        id: "attendant",
        label: "Último Atendente",
        width: "15%",
        render: ({client}) => (
            <div className="truncate text-slate-700">
                {client.attendant_name ?? "—"}
            </div>
        ),
    },
    {
        id: "action",
        label: "",
        width: "4%",
        align: "right",
        render: () => (
            <div className="flex justify-end">
                <ChevronRight
                    size={16}
                    className="text-slate-400 transition-colors group-hover:text-slate-700"
                />
            </div>
        ),
    },
];

export default function ClientesPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [stages, setStages] = useState<FunnelStage[]>([]);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingFilters, setLoadingFilters] = useState(true);
    const [interactionReferenceTime, setInteractionReferenceTime] = useState(0);

    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("always", CLIENTES_DATE_PRESETS, {
        syncUrl: true,
    });

    const [currentPage, setCurrentPage] = useState(1);
    const [urlFiltersReady, setUrlFiltersReady] = useState(false);
    const initialUnitUrlValuesRef = useRef<string[]>([]);
    const initialClosingTagUrlValuesRef = useRef<string[]>([]);

    const [stageValues, setStageValues] = useState<string[]>([]);
    const [unitValues, setUnitValues] = useState<string[]>([]);
    const [closingTagValues, setClosingTagValues] = useState<string[]>([]);
    const [sourceValues, setSourceValues] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [search, setSearch] = useState("");

    function resetPageAndSet<T>(setter: (value: T) => void) {
        return (value: T) => {
            setCurrentPage(1);
            setter(value);
        };
    }

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        initialUnitUrlValuesRef.current = readUrlFilterValues(params, [
            "unit",
            "units",
            "unit_id",
            "unit_ids",
        ]);
        setStageValues(
            readUrlFilterValues(params, [
                "stage",
                "stages",
                "stage_id",
                "stage_ids",
            ]),
        );
        initialClosingTagUrlValuesRef.current = readUrlFilterValues(
            params,
            ["closing_tag", "closing_tags"],
        );
        setSourceValues(
            readUrlFilterValues(params, ["origin", "origins"]),
        );
        setTunnelValues(
            readUrlFilterValues(params, ["tunnel", "tunnels"]),
        );
        setSearch(readUrlFilterValue(params, ["search", "q"]) ?? "");
    }, []);

    const normalizedUnitUrlValues = useMemo(
        () =>
            getNormalizedUrlOptionNames(
                unitValues,
                filters?.units ?? [],
            ),
        [filters?.units, unitValues],
    );

    useEffect(() => {
        if (!urlFiltersReady || !dateFilterReady) return;

        replaceUrlFilterParams([
            {
                key: "unit",
                value: normalizedUnitUrlValues,
                aliases: ["units", "unit_id", "unit_ids"],
            },
            {
                key: "stage",
                value: stageValues,
                aliases: ["stages", "stage_id", "stage_ids"],
            },
            {
                key: "closing_tag",
                value: closingTagValues,
                aliases: ["closing_tags"],
            },
            {
                key: "origin",
                value: sourceValues,
                aliases: ["origins"],
            },
            {
                key: "tunnel",
                value: tunnelValues,
                aliases: ["tunnels"],
            },
            {
                key: "search",
                value: search.trim() || null,
                aliases: ["q"],
            },
        ]);
    }, [
        closingTagValues,
        dateFilterReady,
        search,
        sourceValues,
        stageValues,
        tunnelValues,
        normalizedUnitUrlValues,
        urlFiltersReady,
    ]);

    useEffect(() => {
        const controller = new AbortController();

        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units,attendants,origins,tunnels",
                    { signal: controller.signal },
                );
                if (!response.ok) {
                    throw new Error("Falha ao carregar filtros de clientes.");
                }
                const json: FiltersResponse = await response.json();

                setFilters(json);
                setUnitValues(
                    resolveUrlOptionValues(
                        initialUnitUrlValuesRef.current,
                        json.units ?? [],
                    ),
                );
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[clientes] filters failed", error);
            } finally {
                if (!controller.signal.aborted) {
                    setUrlFiltersReady(true);
                    setLoadingFilters(false);
                }
            }
        }

        void loadFilters();
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const controller = new AbortController();

        async function loadClients() {
            try {
                const response = await fetch("/api/clientes", {
                    cache: "no-store",
                    signal: controller.signal,
                });
                const text = await response.text();
                const data = text
                    ? (JSON.parse(text) as ClientsResponse)
                    : null;

                if (!response.ok) {
                    throw new Error(
                        "Não foi possível carregar os clientes.",
                    );
                }

                const loadedClients = data?.clients ?? [];
                const loadedClosingTags = [...new Set(
                    loadedClients
                        .map((client) => client.last_closing_tag?.trim())
                        .filter((value): value is string => Boolean(value)),
                )].map((label) => ({
                    label,
                    value: normalizeUrlFilterName(label),
                }));

                setClients(loadedClients);
                setStages(data?.stages ?? []);
                setClosingTagValues(
                    resolveUrlOptionValues(
                        initialClosingTagUrlValuesRef.current,
                        loadedClosingTags,
                    ),
                );
                setInteractionReferenceTime(Date.now());
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[clientes] unexpected load error", error);
                setClients([]);
                setStages([]);
                setInteractionReferenceTime(Date.now());
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        void loadClients();
        return () => controller.abort();
    }, []);

    const stageById = useMemo(() => {
        return new Map(stages.map((stage) => [stage.id, stage]));
    }, [stages]);

    const interactionDateRange = useMemo(() => {
        return getInteractionDateRange(period, selectedRange);
    }, [period, selectedRange]);

    const closingTagOptions = useMemo(() => {
        const labelByNormalizedName = new Map<string, string>();

        for (const client of clients) {
            const label = client.last_closing_tag?.trim();
            if (!label) continue;

            const normalizedName = normalizeUrlFilterName(label);
            if (normalizedName && !labelByNormalizedName.has(normalizedName)) {
                labelByNormalizedName.set(normalizedName, label);
            }
        }

        return [...labelByNormalizedName.entries()]
            .sort(([, firstLabel], [, secondLabel]) =>
                firstLabel.localeCompare(secondLabel, "pt-BR"),
            )
            .map(([value, label]) => ({ label, value }));
    }, [clients]);

    const stageFilterSections = useMemo(() => {
        const groups = new Map<
            string,
            {
                funnelId: string;
                funnelName: string;
                stages: FunnelStage[];
            }
        >();

        for (const stage of stages) {
            const funnelId = stage.funnel_id || "without-funnel";
            const current = groups.get(funnelId) ?? {
                funnelId,
                funnelName: getFunnelName(stage),
                stages: [],
            };

            current.stages.push(stage);
            groups.set(funnelId, current);
        }

        return [...groups.values()]
            .sort((first, second) =>
                first.funnelName.localeCompare(second.funnelName, "pt-BR"),
            )
            .map((group) => {
                const stageIds = new Set(
                    group.stages.map((stage) => stage.id),
                );

                return {
                    id: `funnel-${group.funnelId}`,
                    title: `${group.funnelName} — Estágios`,
                    values: stageValues.filter((stageId) =>
                        stageIds.has(stageId),
                    ),
                    onChange: (nextValues: string[]) => {
                        setCurrentPage(1);
                        setStageValues((currentValues) => [
                            ...currentValues.filter(
                                (stageId) => !stageIds.has(stageId),
                            ),
                            ...nextValues,
                        ]);
                    },
                    options: [...group.stages]
                        .sort(
                            (first, second) =>
                                first.position - second.position,
                        )
                        .map((stage) => ({
                            label: stage.name,
                            value: stage.id,
                        })),
                };
            });
    }, [stages, stageValues]);

    const filteredClients = useMemo(() => {
        const term = search.trim().toLowerCase();

        return clients.filter((client) => {
            if (
                stageValues.length > 0 &&
                (!client.funnel_stage_id ||
                    !stageValues.includes(client.funnel_stage_id))
            ) {
                return false;
            }

            if (
                unitValues.length > 0 &&
                (!client.unit_id || !unitValues.includes(client.unit_id))
            ) {
                return false;
            }

            if (
                closingTagValues.length > 0 &&
                !closingTagValues.includes(
                    normalizeUrlFilterName(client.last_closing_tag || ""),
                )
            ) {
                return false;
            }

            if (
                sourceValues.length > 0 &&
                !sourceValues.includes(client.utm_source ?? "direct")
            ) {
                return false;
            }

            if (
                tunnelValues.length > 0 &&
                !tunnelValues.includes(client.last_tunnel ?? "__NULL__")
            ) {
                return false;
            }
            if (interactionDateRange) {
                const interactionDate = toDateString(client.last_interaction_at);

                if (
                    interactionDate < interactionDateRange.start ||
                    interactionDate > interactionDateRange.end
                ) {
                    return false;
                }
            }

            if (!term) return true;

            return (
                client.name?.toLowerCase().includes(term) ||
                client.phone?.toLowerCase().includes(term) ||
                client.email?.toLowerCase().includes(term)
            );
        });
    }, [
        clients,
        closingTagValues,
        interactionDateRange,
        search,
        sourceValues,
        stageValues,
        tunnelValues,
        unitValues,
    ]);

    const totalClients = filteredClients.length;

    const totalPages = Math.max(
        1,
        Math.ceil(filteredClients.length / CLIENTS_PER_PAGE),
    );
    const visiblePage = Math.min(currentPage, totalPages);

    const paginatedClients = useMemo(() => {
        const start = (visiblePage - 1) * CLIENTS_PER_PAGE;
        const end = start + CLIENTS_PER_PAGE;
        return filteredClients.slice(start, end);
    }, [filteredClients, visiblePage]);

    const paginatedClientRows = useMemo(() => {
        return paginatedClients.map((client) => ({
            client,
            stage: client.funnel_stage_id
                ? stageById.get(client.funnel_stage_id) ?? null
                : null,
        }));
    }, [paginatedClients, stageById]);

    const pageStart =
        filteredClients.length === 0 ? 0 : (visiblePage - 1) * CLIENTS_PER_PAGE + 1;

    const pageEnd = Math.min(
        visiblePage * CLIENTS_PER_PAGE,
        filteredClients.length,
    );

    const withoutFunnel = filteredClients.filter((client) => {
        if (!client.funnel_stage_id) return true;

        return !stageById.has(client.funnel_stage_id);
    }).length;

    const scheduled = filteredClients.filter((client) => {
        const stage = client.funnel_stage_id
            ? stageById.get(client.funnel_stage_id)
            : null;

        return normalize(stage?.name ?? "").includes("agend");
    }).length;

    const withoutInteraction = filteredClients.filter((client) => {
        const diff =
            interactionReferenceTime -
            new Date(client.last_interaction_at).getTime();
        return diff > 24 * 60 * 60 * 1000;
    }).length;

    if (
        loading ||
        loadingFilters ||
        !dateFilterReady ||
        !urlFiltersReady
    ) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel />

                <section className="min-w-0 flex-1 px-8 py-8">
                    <DashboardHeader title="Clientes" description="Visualize e gerencie todos os clientes do CRM" period={period} setPeriod={resetPageAndSet(setPeriod)} selectedRange={selectedRange} setSelectedRange={resetPageAndSet(setSelectedRange)} presets={CLIENTES_DATE_PRESETS} storageManaged storageReady />
                    <DashboardFilterBarSkeleton widths={["w-[230px]", "w-[230px]", "w-[150px]", "w-[150px]"]} />

                    <section className="mb-8 grid grid-cols-1 gap-5">
                        <HorizontalScroller scrollAmount={400}>
                            {Array.from({length: 4}).map((_, index) => (
                                <Skeleton key={index} className="h-32 min-w-[310px] rounded-2xl" />
                            ))}
                        </HorizontalScroller>
                    </section>

                    <section className="overflow-hidden rounded-2xl border border-slate-100">
                        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                            <Skeleton className="h-6 w-[150px]" />
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-11 w-[310px] rounded-xl" />
                                <Skeleton className="h-11 w-[120px] rounded-xl" />
                            </div>
                        </div>

                        <div className="grid grid-cols-[1.6fr_0.9fr_1fr_0.8fr_0.8fr_1.1fr_1.1fr_48px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3">
                            {Array.from({length: 8}).map((_, index) => (
                                <Skeleton key={index} className="h-3 w-[70%]" />
                            ))}
                        </div>

                        {Array.from({length: 7}).map((_, rowIndex) => (
                            <div key={rowIndex} className="grid grid-cols-[1.6fr_0.9fr_1fr_0.8fr_0.8fr_1.1fr_1.1fr_48px] items-center gap-4 border-b border-slate-100 px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-9 w-9 rounded-full" />
                                    <Skeleton className="h-4 w-[110px]" />
                                </div>
                                <Skeleton className="h-4 w-[90px]" />
                                <Skeleton className="h-6 w-[88px] rounded-lg" />
                                <Skeleton className="h-6 w-[72px] rounded-lg" />
                                <Skeleton className="h-6 w-[72px] rounded-lg" />
                                <Skeleton className="h-4 w-[90px]" />
                                <Skeleton className="h-4 w-[105px]" />
                                <Skeleton className="ml-auto h-5 w-5 rounded-full" />
                            </div>
                        ))}
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
                    title="Clientes"
                    description="Visualize e gerencie todos os clientes do CRM"
                    period={period}
                    setPeriod={resetPageAndSet(setPeriod)}
                    selectedRange={selectedRange}
                    setSelectedRange={resetPageAndSet(setSelectedRange)}
                    presets={CLIENTES_DATE_PRESETS}
                    storageManaged
                    storageReady={dateFilterReady}
                />

                <DashboardFilterBar>
                    <MainFilters
                        units={filters?.units}
                        attendants={filters?.attendants}
                        tunnels={filters?.tunnels}
                        origins={filters?.origins}
                        unitValues={unitValues}
                        setUnitValues={resetPageAndSet(setUnitValues)}
                        originValues={sourceValues}
                        setOriginValues={resetPageAndSet(setSourceValues)}
                        tunnelValues={tunnelValues}
                        setTunnelValues={resetPageAndSet(setTunnelValues)}
                        show={{
                            units: true,
                            attendants: true,
                            tunnels: true,
                            origins: true,
                        }}
                        widths={{
                            units: "w-[230px]",
                            attendants: "w-[230px]",
                            tunnels: "w-[230px]",
                            origins: "w-[230px]",
                        }}
                    />

                    <AdvancedFilterButton
                        dropdownWidthClassName="w-[360px]"
                        sections={[
                            ...stageFilterSections,
                            {
                                id: "closing-tag",
                                title: "Tag de fechamento",
                                values: closingTagValues,
                                onChange: resetPageAndSet(setClosingTagValues),
                                options: closingTagOptions,
                            },
                        ]}
                    />
                </DashboardFilterBar>

                <section className="mb-8 grid grid-cols-1 gap-5">
                    <HorizontalScroller scrollAmount={400}>
                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<Users size={26} />}
                                label="Clientes totais"
                                currentValue={totalClients}
                                previousValue={null}
                                color="pink"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<Filter size={26} />}
                                label="Sem funil"
                                currentValue={withoutFunnel}
                                previousValue={null}
                                color="green"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<CalendarCheck size={26} />}
                                label="Agendados"
                                currentValue={scheduled}
                                previousValue={null}
                                color="blue"
                            />
                        </div>

                        <div className="min-w-[310px]">
                            <KpiCard
                                icon={<Clock size={26} />}
                                label="Sem interação"
                                currentValue={withoutInteraction}
                                previousValue={null}
                                color="orange"
                            />
                        </div>
                    </HorizontalScroller>
                </section>

                <section>
                    <TableHeaderPreset
                        title="Clientes"
                        count={totalClients}
                        searchValue={search}
                        onSearchChange={resetPageAndSet(setSearch)}
                        searchPlaceholder="Buscar por cliente ou telefone..."
                    />

                    <DataTable
                        columns={CLIENT_COLUMNS}
                        rows={paginatedClientRows}
                        getRowKey={({client}) => client.id}
                        onRowClick={({client}) => openClientProfile(client.id)}
                    />
                    {filteredClients.length > CLIENTS_PER_PAGE ? (
                        <div className="mt-5 flex items-center justify-between pb-16">
                            <p className="text-sm font-medium text-muted">
                                Mostrando {pageStart}–{pageEnd} de {filteredClients.length}{" "}
                                clientes
                            </p>

                            <Pagination
                                totalPages={totalPages}
                                currentPage={visiblePage}
                                onPageChange={setCurrentPage}
                            />
                        </div>
                    ) : (
                        <div className="pb-12" />
                    )}
                </section>
            </section>

            <ConversationPanel
                conversationId={selectedConversationId}
                onClose={() => setSelectedConversationId(null)}
            />


        </main>
    );
}

function getFunnelName(stage: FunnelStage | null) {
    if (!stage) return "Sem funil";

    return stage.funnel_name ?? stage.funnel?.name ?? "Funil não informado";
}

function formatPhone(phone: string | null) {
    if (!phone) return "Sem telefone";

    return phone.split("+55")[1] ?? phone;
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

function getInteractionDateRange(
    period: CalendarPresetValue | null,
    selectedRange: DateRange,
): { start: string; end: string } | null {
    if (selectedRange.start) {
        return {
            start: selectedRange.start,
            end: selectedRange.end ?? selectedRange.start,
        };
    }

    if (!period || period === "always") {
        return null;
    }

    const preset = CLIENTES_DATE_PRESETS.find(
        (candidate) => candidate.value === period,
    );
    return preset ? getDateRangeFromPreset(preset) : null;
}

function toDateString(date: string) {
    return new Date(date).toISOString().slice(0, 10);
}
