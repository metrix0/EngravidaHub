// app/conversas/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, CircleAlert } from "lucide-react";
import { ConversationPanel } from "@/components/conversations/ConversationPanel";
import {
    applyArrayParams,
    applyCalendarDateParams,
    type CalendarPresetValue,
    type DateRange,
} from "@/components/ui/CalendarButton";
import type { FiltersResponse } from "@/types";
import {
    Badge,
    MainFilters,
    DashboardHeader,
    SidePanel,
    Skeleton,
    Pagination,
    DataTable,
    TableHeaderPreset,
    type ConversationResult,
    type DataTableColumn,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import AdvancedFilterButton from "@/components/ui/AdvancedFilterButton";
import {
    CONVERSATION_GOAL_OPTIONS,
    DROPOFF_MOMENT_OPTIONS,
} from "@/lib/conversationAnalysisLabels";

type ConversationRow = {
    id: string;
    attendant_name: string;
    phone: string;
    started_at: string;
    ended_at: string | null;
    client_name: string;
    objective: string;
    result: ConversationResult;
    notable: boolean;
};

type ConversationsResponse = {
    items: ConversationRow[];
    total: number;
    page: number;
    page_size: number;
};

const PAGE_SIZE = 50;

const CONVERSATION_COLUMNS: DataTableColumn<ConversationRow>[] = [
    {
        id: "client",
        label: "Cliente",
        width: "15%",
        render: (conversation) => (
            <div className="flex min-w-0 items-center gap-3">
                <InitialsAvatar name={conversation.client_name}/>
                <span title={conversation.client_name} className="truncate font-medium text-slate-700">
                    {conversation.client_name}
                </span>
            </div>
        ),
    },
    {
        id: "phone",
        label: "Telefone",
        width: "11%",
        render: (conversation) => (
            <div title={formatPhone(conversation.phone)} className="truncate text-slate-600">
                {formatPhone(conversation.phone)}
            </div>
        ),
    },
    {
        id: "date",
        label: "Data",
        width: "21%",
        render: (conversation) => <DateRangeCell start={conversation.started_at} end={conversation.ended_at}/>,
    },
    {
        id: "attendant",
        label: "Atendente",
        width: "15%",
        render: (conversation) => (
            <div title={conversation.attendant_name} className="truncate text-slate-700">{conversation.attendant_name}</div>
        ),
    },
    {
        id: "objective",
        label: "Objetivo",
        width: "15%",
        render: (conversation) => (
            <div title={conversation.objective} className="truncate text-slate-700">{conversation.objective}</div>
        ),
    },
    {
        id: "result",
        label: "Resultado",
        width: "11%",
        render: (conversation) => <Badge value={conversation.result}/>,
    },
    {
        id: "notable",
        label: "Notável",
        width: "6%",
        render: (conversation) => <NotableBadge notable={conversation.notable}/>,
    },
    {
        id: "action",
        label: "",
        width: "6%",
        align: "right",
        render: () => (
            <div className="flex justify-end">
                <ChevronRight size={16} className="text-slate-400 transition-colors group-hover:text-slate-700"/>
            </div>
        ),
    },
];

export default function MessagesPage() {
    return (
        <Suspense fallback={<MessagesPageLoading />}>
            <MessagesPageContent />
        </Suspense>
    );
}

function MessagesPageContent() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const requestedConversationId = searchParams.get("conversation_id");
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [attendantIds, setAttendantIds] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const [goalValues, setGoalValues] = useState<string[]>([]);
    const [dropoffMomentValues, setDropoffMomentValues] = useState<string[]>([]);
    const [resultValues, setResultValues] = useState<string[]>([]);
    const [notableValues, setNotableValues] = useState<string[]>([]);
    const [period, setPeriod] = useState<CalendarPresetValue | null>("yesterday");
    const [selectedRange, setSelectedRange] = useState<DateRange>({ start: null, end: null });
    const [search, setSearch] = useState("");
    const [conversations, setConversations] = useState<ConversationRow[]>([]);
    const [totalConversations, setTotalConversations] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [loadingFilters, setLoadingFilters] = useState(true);
    const [loadingConversations, setLoadingConversations] = useState(true);

    function resetPageAndSet<T>(setter: (value: T) => void) {
        return (value: T) => {
            setCurrentPage(1);
            setter(value);
        };
    }

    useEffect(() => {
        async function loadFilters() {
            try {
                const response = await fetch("/api/dashboard/filters?entities=units,attendants,tunnels,origins");
                setFilters(await response.json());
            } finally {
                setLoadingFilters(false);
            }
        }
        void loadFilters();
    }, []);

    useEffect(() => {
        async function loadConversations() {
            setLoadingConversations(true);
            const params = new URLSearchParams();
            params.set("page", String(currentPage));
            params.set("page_size", String(PAGE_SIZE));
            applyCalendarDateParams({ params, selectedRange, selectedPreset: period });
            if (search.trim()) params.set("search", search.trim());
            applyArrayParams(params, {
                unit_ids: unitIds,
                attendant_ids: attendantIds,
                tunnels: tunnelValues,
                origins: originValues,
            });
            if (goalValues.length > 0) params.set("conversation_goals", goalValues.join(","));
            if (dropoffMomentValues.length > 0) params.set("dropoff_moments", dropoffMomentValues.join(","));
            if (resultValues.length > 0) params.set("results", resultValues.join(","));
            if (notableValues.length > 0) params.set("notable", notableValues[0]);

            try {
                const response = await fetch(`/api/dashboard/conversas?${params.toString()}`);
                const json: ConversationsResponse = await response.json();
                setConversations(json.items ?? []);
                setTotalConversations(json.total ?? 0);
            } finally {
                setLoadingConversations(false);
            }
        }
        void loadConversations();
    }, [
        currentPage, period, selectedRange, search, unitIds, attendantIds,
        tunnelValues, originValues, goalValues, dropoffMomentValues,
        resultValues, notableValues,
    ]);

    const totalPages = Math.max(1, Math.ceil(totalConversations / PAGE_SIZE));
    const firstItem = totalConversations === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const lastItem = Math.min(currentPage * PAGE_SIZE, totalConversations);

    function handleOpenConversation(conversationId: string) {
        const nextSearchParams = new URLSearchParams(searchParams.toString());
        nextSearchParams.set("conversation_id", conversationId);
        router.replace(`${pathname}?${nextSearchParams.toString()}`, {
            scroll: false,
        });
    }

    function handleCloseConversationPanel() {
        if (!requestedConversationId) return;

        const nextSearchParams = new URLSearchParams(searchParams.toString());
        nextSearchParams.delete("conversation_id");
        const query = nextSearchParams.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, {
            scroll: false,
        });
    }

    if (loadingFilters && loadingConversations) {
        return (
            <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
                <SidePanel/>
                <section className="flex-1 px-8 py-8"><MessagesSkeleton/></section>
                <ConversationPanel
                    conversationId={requestedConversationId}
                    onClose={handleCloseConversationPanel}
                />
            </main>
        );
    }

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel/>
            <section className="flex-1 px-8 py-8">
                <DashboardHeader
                    title="Conversas"
                    description="Visualize e explore todas as conversas com seus clientes"
                    period={period}
                    setPeriod={resetPageAndSet(setPeriod)}
                    selectedRange={selectedRange}
                    setSelectedRange={resetPageAndSet(setSelectedRange)}
                />

                <div className="mb-8 flex justify-end gap-3">
                    <MainFilters
                        units={filters?.units}
                        attendants={filters?.attendants}
                        tunnels={filters?.tunnels}
                        origins={filters?.origins}
                        unitValues={unitIds}
                        setUnitValues={resetPageAndSet(setUnitIds)}
                        attendantValues={attendantIds}
                        setAttendantValues={resetPageAndSet(setAttendantIds)}
                        tunnelValues={tunnelValues}
                        setTunnelValues={resetPageAndSet(setTunnelValues)}
                        originValues={originValues}
                        setOriginValues={resetPageAndSet(setOriginValues)}
                    />
                </div>

                <TableHeaderPreset
                    title="Conversas"
                    count={totalConversations}
                    searchValue={search}
                    onSearchChange={resetPageAndSet(setSearch)}
                >
                    <AdvancedFilterButton
                        sections={[
                            {
                                id: "goal",
                                title: "Objetivo",
                                values: goalValues,
                                onChange: resetPageAndSet(setGoalValues),
                                options: CONVERSATION_GOAL_OPTIONS,
                            },
                            {
                                id: "dropoff-moment",
                                title: "Motivo da perda",
                                values: dropoffMomentValues,
                                onChange: resetPageAndSet(setDropoffMomentValues),
                                options: DROPOFF_MOMENT_OPTIONS,
                            },
                            {
                                id: "result",
                                title: "Resultado",
                                values: resultValues,
                                onChange: resetPageAndSet(setResultValues),
                                options: [
                                    { label: "Resolvida", value: "resolvida" },
                                    { label: "Parcial", value: "parcial" },
                                    { label: "Não resolvida", value: "nao_resolvida" },
                                    { label: "Pendente", value: "pendente" },
                                ],
                            },
                            {
                                id: "notable",
                                title: "Notável",
                                values: notableValues,
                                onChange: resetPageAndSet(setNotableValues),
                                multi: false,
                                options: [
                                    { label: "Notáveis", value: "true" },
                                    { label: "Não notáveis", value: "false" },
                                ],
                            },
                        ]}
                    />
                </TableHeaderPreset>

                {loadingConversations ? (
                    <MessagesTableSkeleton/>
                ) : (
                    <DataTable
                        columns={CONVERSATION_COLUMNS}
                        rows={conversations}
                        getRowKey={(conversation) => conversation.id}
                        onRowClick={(conversation) => handleOpenConversation(conversation.id)}
                    />
                )}

                <div className="flex items-center justify-between border-t border-slate-100 px-6 py-5">
                    <div className="text-sm text-slate-500">
                        Mostrando {firstItem} a {lastItem} de {totalConversations} conversas
                    </div>
                    <Pagination totalPages={totalPages} currentPage={currentPage} onPageChange={setCurrentPage}/>
                    <button type="button" className="flex h-11 cursor-pointer items-center gap-3 rounded-xl px-4 text-sm text-slate-500">
                        50 por página
                    </button>
                </div>
            </section>

            <ConversationPanel
                conversationId={requestedConversationId}
                onClose={handleCloseConversationPanel}
            />
        </main>
    );
}

function MessagesPageLoading() {
    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />
            <section className="flex-1 px-8 py-8">
                <MessagesSkeleton />
            </section>
        </main>
    );
}

function formatPhone(phone: string) {
    return phone.split("+55")[1] ?? phone;
}

function DateRangeCell({ start, end }: { start: string; end: string | null }) {
    const label = formatConversationDateRange(start, end);
    return <div title={label} className="truncate text-slate-600">{label}</div>;
}

function formatConversationDateRange(startValue: string, endValue: string | null) {
    const start = new Date(startValue);
    const end = endValue ? new Date(endValue) : null;
    if (!end) return formatDate(start);
    if (start.toDateString() === end.toDateString()) {
        return `${formatDate(start)} ${formatTime(start)} às ${formatTime(end)}`;
    }
    return `de ${formatDate(start)} a ${formatDate(end)}`;
}

function formatDate(date: Date) {
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTime(date: Date) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function NotableBadge({ notable }: { notable: boolean }) {
    if (!notable) return <span className="ml-2 text-sm text-slate-400"/>;
    return (
        <span className="inline-flex w-full justify-center font-bold text-slate-500">
            <CircleAlert className="h-4 w-4"/>
        </span>
    );
}

function MessagesSkeleton() {
    return (
        <>
            <div className="mb-8 flex items-start justify-between">
                <div><Skeleton className="h-9 w-[220px]"/><Skeleton className="mt-3 h-4 w-[360px]"/></div>
                <Skeleton className="h-12 w-[310px]"/>
            </div>
            <div className="mb-8 flex justify-end gap-3">
                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-[220px]"/>)}
            </div>
            <MessagesTableSkeleton/>
        </>
    );
}

function MessagesTableSkeleton() {
    return (
        <div className="overflow-hidden">
            <div className="grid grid-cols-[1.35fr_1fr_1.55fr_1.35fr_1.35fr_1fr_0.7fr_48px] border-b border-slate-100 bg-slate-50 px-6 py-3">
                {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-3 w-[70%]"/>)}
            </div>
            {Array.from({ length: 8 }).map((_, rowIndex) => (
                <div key={rowIndex} className="grid grid-cols-[1.35fr_1fr_1.55fr_1.35fr_1.35fr_1fr_0.7fr_48px] items-center border-b border-slate-100 px-6 py-4">
                    {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-4 w-[75%]"/>)}
                </div>
            ))}
        </div>
    );
}
