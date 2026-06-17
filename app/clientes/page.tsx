// app/clientes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CalendarCheck,
    ChevronRight,
    Clock,
    Filter,
    Search,
    Users,
} from "lucide-react";

import {
    AdvancedFilterButton,
    DashboardHeader,
    FilterButton,
    HorizontalScroller,
    KpiCard,
    MainFilters,
    Pagination,
    Skeleton,
    DataTable,
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
import ThreadConversationPanel from "@/components/clientes/ThreadConversationPanel";

type PipelineStage = {
    id: string;
    pipeline_id: string;
    name: string;
    position: number;
    color: string | null;
    pipeline_name?: string | null;
    pipeline?: {
        id: string;
        name: string | null;
    } | null;
};

type Client = {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    pipeline_stage_id: string | null;
    first_seen_at: string;
    last_interaction_at: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    attendant_name: string | null;
};

type ClientsResponse = {
    clients: Client[];
    stages: PipelineStage[];
};

type ClientTableRow = {
    client: Client;
    stage: PipelineStage | null;
};

type BadgeTone = {
    bg: string;
    text: string;
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
                    <Chip
                        label={stage?.name ?? "-"}
                        tone={getStageVariant(stage?.name ?? null)}
                    />
                </div>
            );
        },
    },
    {
        id: "origin",
        label: "Origem",
        width: "12%",
        render: ({client}) => (
            <Chip
                label={sourceLabel(client.utm_source)}
                tone={getSourceVariant(client.utm_source)}
            />
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
    const [stages, setStages] = useState<PipelineStage[]>([]);
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingFilters, setLoadingFilters] = useState(true);

    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

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
                (!client.pipeline_stage_id ||
                    !stageValues.includes(client.pipeline_stage_id))
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
            stage: client.pipeline_stage_id
                ? stageById.get(client.pipeline_stage_id) ?? null
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
        if (!client.pipeline_stage_id) return true;

        return !stageById.has(client.pipeline_stage_id);
    }).length;

    const scheduled = filteredClients.filter((client) => {
        const stage = client.pipeline_stage_id
            ? stageById.get(client.pipeline_stage_id)
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
                    <div className="mb-5 flex items-center justify-between gap-6">
                        <h2 className="text-lg font-bold text-text">
                            Clientes <span className={"text-slate-500"}>({totalClients})</span>
                        </h2>

                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-[360px] items-center gap-3 rounded-xl border border-border bg-white px-4 shadow-sm">
                                <Search size={17} className="text-muted" />

                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Buscar por cliente ou telefone..."
                                    className="w-full bg-transparent text-sm text-text outline-none placeholder:text-slate-400"
                                />
                            </div>

                            <AdvancedFilterButton
                                icon={<Filter size={16} />}
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
                        </div>
                    </div>

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
                onOpenThread={setSelectedThreadId}
            />

            <ConversationPanel
                conversationId={selectedConversationId}
                onClose={() => setSelectedConversationId(null)}
            />

            <ThreadConversationPanel
                threadId={selectedThreadId}
                onClose={() => setSelectedThreadId(null)}
            />
        </main>
    );
}

function getFunnelName(stage: PipelineStage | null) {
    if (!stage) return "Sem funil";

    return stage.pipeline_name ?? stage.pipeline?.name ?? "Funil não informado";
}

function Chip({ label, tone }: { label: string; tone: BadgeTone }) {
    return (
        <span
            className={[
                "inline-flex max-w-full truncate rounded-md px-2.5 py-1 text-xs font-bold",
                tone.bg,
                tone.text,
            ].join(" ")}
        >
      {label}
    </span>
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

function getSourceVariant(source: string | null): BadgeTone {
    const normalized = normalize(source ?? "direct");

    if (normalized.includes("meta_ads") || normalized.includes("facebook")) {
        return { bg: "bg-soft-purple", text: "text-purple" };
    }

    if (normalized.includes("google")) {
        return { bg: "bg-soft-blue", text: "text-blue" };
    }

    if (normalized.includes("instagram")) {
        return { bg: "bg-soft-pink", text: "text-pink" };
    }

    return { bg: "bg-slate-100", text: "text-slate-500" };
}

function getStageVariant(stageName: string | null): BadgeTone {
    const stage = normalize(stageName ?? "");

    if (stage.includes("novo")) {
        return { bg: "bg-soft-blue", text: "text-blue" };
    }

    if (stage.includes("tentando")) {
        return { bg: "bg-soft-yellow", text: "text-yellow" };
    }

    if (stage.includes("atendimento")) {
        return { bg: "bg-soft-purple", text: "text-purple" };
    }

    if (stage.includes("interessado")) {
        return { bg: "bg-soft-yellow", text: "text-yellow" };
    }

    if (stage.includes("agend")) {
        return { bg: "bg-soft-blue", text: "text-blue" };
    }

    if (stage.includes("realizad") || stage.includes("compareceu")) {
        return { bg: "bg-soft-green", text: "text-green" };
    }

    if (stage.includes("perdid")) {
        return { bg: "bg-soft-red", text: "text-red" };
    }

    return { bg: "bg-slate-100", text: "text-slate-500" };
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

function formatSince(date: string) {
    return new Intl.DateTimeFormat("pt-BR", {
        month: "short",
        year: "numeric",
    }).format(new Date(date));
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

