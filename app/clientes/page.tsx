// app/clientes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
    FilterButton,
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

import type {
    CalendarPresetValue,
    CalendarPreset,
    DateRange,
} from "@/components/ui/CalendarButton";
import type { FiltersResponse } from "@/types";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { ConversationPanel } from "@/components/conversations/ConversationPanel";
import ClientPanel from "@/components/clientes/ClientPanel";

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
    first_seen_at: string;
    last_interaction_at: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
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
        label: "90 dias",
        value: "90",
        startOffsetDays: -89,
        endOffsetDays: 0,
    },
];


const CLIENT_COLUMNS: DataTableColumn<ClientTableRow>[] = [
    {
        id: "client",
        label: "Cliente",
        width: "24%",
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
        width: "13%",
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
        width: "12%",
        render: ({client}) => (
            <Badge value={client.utm_source} />
        ),
    },
    {
        id: "last_interaction",
        label: "Última interação",
        width: "16%",
        render: ({client}) => (
            <div className="truncate text-slate-700">
                {timeAgo(client.last_interaction_at)}
            </div>
        ),
    },
    {
        id: "attendant",
        label: "Último Atendente",
        width: "17%",
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

    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

    const [period, setPeriod] = useState<CalendarPresetValue | null>("always");
    const [selectedRange, setSelectedRange] = useState<DateRange>({
        start: null,
        end: null,
    });

    const [currentPage, setCurrentPage] = useState(1);

    const [stageValues, setStageValues] = useState<string[]>([]);
    const [sourceValues, setSourceValues] = useState<string[]>([]);
    const [search, setSearch] = useState("");

    async function load() {
        setLoading(true);

        try {
            const response = await fetch("/api/clientes", {
                cache: "no-store",
            });

            const text = await response.text();
            const data = text ? (JSON.parse(text) as ClientsResponse) : null;

            if (!response.ok) {
                console.error("[clientes] failed to load", {
                    status: response.status,
                    statusText: response.statusText,
                    data,
                });
                return;
            }

            setClients(data?.clients ?? []);
            setStages(data?.stages ?? []);
        } catch (error) {
            console.error("[clientes] unexpected load error", error);
            setClients([]);
            setStages([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=attendants,origins"
                );
                const json: FiltersResponse = await response.json();

                setFilters(json);
            } finally {
                setLoadingFilters(false);
            }
        }

        loadFilters();
    }, []);

    useEffect(() => {
        load();
    }, []);

    const stageById = useMemo(() => {
        return new Map(stages.map((stage) => [stage.id, stage]));
    }, [stages]);

    const interactionDateRange = useMemo(() => {
        return getInteractionDateRange(period, selectedRange);
    }, [period, selectedRange]);

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
                sourceValues.length > 0 &&
                !sourceValues.includes(client.utm_source ?? "direct")
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
    }, [clients, search, sourceValues, stageValues, interactionDateRange]);

    const totalClients = filteredClients.length;

    useEffect(() => {
        setCurrentPage(1);
    }, [
        search,
        stageValues,
        sourceValues,
        period,
        selectedRange.start,
        selectedRange.end,
    ]);

    const totalPages = Math.max(
        1,
        Math.ceil(filteredClients.length / CLIENTS_PER_PAGE),
    );

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const paginatedClients = useMemo(() => {
        const start = (currentPage - 1) * CLIENTS_PER_PAGE;
        const end = start + CLIENTS_PER_PAGE;

        return filteredClients.slice(start, end);
    }, [filteredClients, currentPage]);

    const paginatedClientRows = useMemo(() => {
        return paginatedClients.map((client) => ({
            client,
            stage: client.funnel_stage_id
                ? stageById.get(client.funnel_stage_id) ?? null
                : null,
        }));
    }, [paginatedClients, stageById]);

    const pageStart =
        filteredClients.length === 0 ? 0 : (currentPage - 1) * CLIENTS_PER_PAGE + 1;

    const pageEnd = Math.min(
        currentPage * CLIENTS_PER_PAGE,
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
        const diff = Date.now() - new Date(client.last_interaction_at).getTime();
        return diff > 24 * 60 * 60 * 1000;
    }).length;

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

                    <div className="mb-8 flex justify-end gap-3">
                        {Array.from({length: 3}).map((_, index) => (
                            <Skeleton key={index} className="h-12 w-[230px] rounded-xl" />
                        ))}
                    </div>

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

                        <div className="grid grid-cols-[1.8fr_1fr_1.1fr_0.9fr_1.2fr_1.3fr_48px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3">
                            {Array.from({length: 7}).map((_, index) => (
                                <Skeleton key={index} className="h-3 w-[70%]" />
                            ))}
                        </div>

                        {Array.from({length: 7}).map((_, rowIndex) => (
                            <div key={rowIndex} className="grid grid-cols-[1.8fr_1fr_1.1fr_0.9fr_1.2fr_1.3fr_48px] items-center gap-4 border-b border-slate-100 px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-9 w-9 rounded-full" />
                                    <Skeleton className="h-4 w-[110px]" />
                                </div>
                                <Skeleton className="h-4 w-[90px]" />
                                <Skeleton className="h-6 w-[88px] rounded-lg" />
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
                    setPeriod={setPeriod}
                    selectedRange={selectedRange}
                    setSelectedRange={setSelectedRange}
                    presets={CLIENTES_DATE_PRESETS}
                />

                <div className="mb-8 flex justify-end gap-3">
                    <MainFilters
                        attendants={filters?.attendants}
                        origins={filters?.origins}
                        originValues={sourceValues}
                        setOriginValues={setSourceValues}
                        show={{
                            units: false,
                            attendants: true,
                            tunnels: false,
                            origins: true,
                        }}
                        widths={{
                            attendants: "w-[230px]",
                            origins: "w-[230px]",
                        }}
                    />

                    <FilterButton
                        icon={<Filter size={16} />}
                        label="Todos os estágios"
                        values={stageValues}
                        onChange={setStageValues}
                        options={stages.map((stage) => ({
                            label: stage.name,
                            value: stage.id,
                        }))}
                        widthClassName="w-[230px]"
                    />
                </div>

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
                        onSearchChange={setSearch}
                        searchPlaceholder="Buscar por cliente ou telefone..."
                    >
                        <AdvancedFilterButton
                            sections={[
                                {
                                    id: "stage",
                                    title: "Estágio",
                                    values: stageValues,
                                    onChange: setStageValues,
                                    options: stages.map((stage) => ({
                                        label: stage.name,
                                        value: stage.id,
                                    })),
                                },
                                {
                                    id: "source",
                                    title: "Origem",
                                    values: sourceValues,
                                    onChange: setSourceValues,
                                    options: filters?.origins ?? [],
                                },
                            ]}
                        />
                    </TableHeaderPreset>

                    <DataTable
                        columns={CLIENT_COLUMNS}
                        rows={paginatedClientRows}
                        getRowKey={({client}) => client.id}
                        onRowClick={({client}) => setSelectedClientId(client.id)}
                    />
                    {filteredClients.length > CLIENTS_PER_PAGE ? (
                        <div className="mt-5 flex items-center justify-between pb-16">
                            <p className="text-sm font-medium text-muted">
                                Mostrando {pageStart}–{pageEnd} de {filteredClients.length}{" "}
                                clientes
                            </p>

                            <Pagination
                                totalPages={totalPages}
                                currentPage={currentPage}
                                onPageChange={setCurrentPage}
                            />
                        </div>
                    ) : (
                        <div className="pb-12" />
                    )}
                </section>
            </section>

            <ClientPanel
                clientId={selectedClientId}
                onClose={() => setSelectedClientId(null)}
                onOpenConversation={setSelectedConversationId}
            />

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

    if (period === "yesterday") {
        const date = getDateWithOffset(-1);

        return {
            start: date,
            end: date,
        };
    }

    const days = Number(period);

    if (!Number.isFinite(days)) {
        return null;
    }

    return {
        start: getDateWithOffset(-(days - 1)),
        end: getDateWithOffset(0),
    };
}

function getDateWithOffset(offsetDays: number) {
    const date = new Date();

    date.setDate(date.getDate() + offsetDays);

    return toDateString(date.toISOString());
}

function toDateString(date: string) {
    return new Date(date).toISOString().slice(0, 10);
}
