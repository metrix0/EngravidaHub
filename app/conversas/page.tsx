// app/conversas/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, CircleAlert } from "lucide-react";
import { ConversationPanel } from "@/components/conversations/ConversationPanel";
import {
    applyArrayParams,
    applyCalendarDateParams,
} from "@/components/ui/CalendarButton";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
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
import { ConversationChannelBadge } from "@/components/conversations/ConversationChannelBadge";
import AdvancedFilterButton from "@/components/ui/AdvancedFilterButton";
import {
    CONVERSATION_GOAL_OPTIONS,
    DROPOFF_MOMENT_OPTIONS,
} from "@/lib/conversationAnalysisLabels";

type ConversationRow = {
    id: string;
    item_type: "conversation" | "thread";
    attendant_name: string;
    phone: string;
    started_at: string;
    ended_at: string | null;
    client_name: string;
    channel: "WhatsApp" | "Instagram" | "Facebook";
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
        width: "14%",
        render: (conversation) => (
            <div className="flex min-w-0 items-center gap-3">
                <InitialsAvatar
                    name={conversation.client_name}
                    conversationState={
                        conversation.item_type === "thread"
                            ? "live"
                            : undefined
                    }
                />
                <span title={conversation.client_name} className="truncate font-medium text-slate-700">
                    {conversation.client_name}
                </span>
            </div>
        ),
    },
    {
        id: "platform",
        label: "Plataforma",
        width: "9%",
        align: "center",
        render: (conversation) => (
            <ConversationChannelBadge channel={conversation.channel} />
        ),
    },
    {
        id: "phone",
        label: "Telefone",
        width: "10%",
        render: (conversation) => (
            <div title={formatPhone(conversation.phone)} className="truncate text-slate-600">
                {formatPhone(conversation.phone)}
            </div>
        ),
    },
    {
        id: "date",
        label: "Data",
        width: "18%",
        render: (conversation) => <DateRangeCell start={conversation.started_at} end={conversation.ended_at}/>,
    },
    {
        id: "attendant",
        label: "Atendente",
        width: "13%",
        render: (conversation) => (
            <div title={conversation.attendant_name} className="truncate text-slate-700">{conversation.attendant_name}</div>
        ),
    },
    {
        id: "objective",
        label: "Objetivo",
        width: "11%",
        render: (conversation) => (
            <div title={conversation.objective} className="truncate text-slate-700">{conversation.objective}</div>
        ),
    },
    {
        id: "result",
        label: "Resultado",
        width: "12%",
        render: (conversation) => (
            <ConversationResultCell conversation={conversation} />
        ),
    },
    {
        id: "notable",
        label: "Notável",
        width: "8%",
        render: (conversation) => <NotableBadge notable={conversation.notable}/>,
    },
    {
        id: "action",
        label: "",
        width: "5%",
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
    const requestedThreadId = searchParams.get("thread_id");
    const [filters, setFilters] = useState<FiltersResponse | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [attendantIds, setAttendantIds] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const [goalValues, setGoalValues] = useState<string[]>([]);
    const [dropoffMomentValues, setDropoffMomentValues] = useState<string[]>([]);
    const [resultValues, setResultValues] = useState<string[]>([]);
    const [notableValues, setNotableValues] = useState<string[]>([]);
    const [platformValues, setPlatformValues] = useState<string[]>([]);
    const [analysisStatusValues, setAnalysisStatusValues] = useState<string[]>([]);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("yesterday");
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
        if (!dateFilterReady) return;
        const controller = new AbortController();

        async function loadFilters() {
            try {
                const response = await fetch(
                    "/api/dashboard/filters?entities=units,attendants,tunnels,origins",
                    { signal: controller.signal },
                );
                if (!response.ok) {
                    throw new Error("Falha ao carregar filtros de conversas.");
                }
                setFilters(await response.json());
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[conversas] filters failed", error);
            } finally {
                if (!controller.signal.aborted) setLoadingFilters(false);
            }
        }
        void loadFilters();
        return () => controller.abort();
    }, [dateFilterReady]);

    useEffect(() => {
        if (!dateFilterReady) return;
        const controller = new AbortController();

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
            if (platformValues.length > 0) params.set("platforms", platformValues.join(","));
            if (analysisStatusValues.length > 0) {
                params.set("analysis_status", analysisStatusValues[0]);
            }

            try {
                const response = await fetch(
                    `/api/dashboard/conversas?${params.toString()}`,
                    { signal: controller.signal },
                );
                const json = (await response.json()) as ConversationsResponse & {
                    error?: string;
                };
                if (!response.ok) {
                    throw new Error(json.error ?? "Falha ao carregar conversas.");
                }
                setConversations(json.items ?? []);
                setTotalConversations(json.total ?? 0);
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("[conversas] load failed", error);
                setConversations([]);
                setTotalConversations(0);
            } finally {
                if (!controller.signal.aborted) {
                    setLoadingConversations(false);
                }
            }
        }

        const debounceId = window.setTimeout(() => {
            void loadConversations();
        }, 150);

        return () => {
            window.clearTimeout(debounceId);
            controller.abort();
        };
    }, [
        currentPage, period, selectedRange, search, unitIds, attendantIds,
        tunnelValues, originValues, goalValues, dropoffMomentValues,
        resultValues, notableValues, platformValues, analysisStatusValues,
        dateFilterReady,
    ]);

    const totalPages = Math.max(1, Math.ceil(totalConversations / PAGE_SIZE));
    const firstItem = totalConversations === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const lastItem = Math.min(currentPage * PAGE_SIZE, totalConversations);

    function handleOpenConversation(conversation: ConversationRow) {
        const nextSearchParams = new URLSearchParams(searchParams.toString());
        nextSearchParams.delete("conversation_id");
        nextSearchParams.delete("thread_id");
        nextSearchParams.set(
            conversation.item_type === "thread"
                ? "thread_id"
                : "conversation_id",
            conversation.id,
        );
        router.replace(`${pathname}?${nextSearchParams.toString()}`, {
            scroll: false,
        });
    }

    function handleCloseConversationPanel() {
        if (!requestedConversationId && !requestedThreadId) return;

        const nextSearchParams = new URLSearchParams(searchParams.toString());
        nextSearchParams.delete("conversation_id");
        nextSearchParams.delete("thread_id");
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
                    threadId={requestedThreadId}
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
                    storageManaged
                    storageReady={dateFilterReady}
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
                                id: "platform",
                                title: "Plataforma",
                                values: platformValues,
                                onChange: resetPageAndSet(setPlatformValues),
                                options: [
                                    { label: "WhatsApp", value: "WhatsApp" },
                                    { label: "Instagram", value: "Instagram" },
                                    { label: "Messenger", value: "Facebook" },
                                ],
                            },
                            {
                                id: "analysis-status",
                                title: "Análise",
                                values: analysisStatusValues,
                                onChange: resetPageAndSet(setAnalysisStatusValues),
                                multi: false,
                                options: [
                                    { label: "Analisadas", value: "analyzed" },
                                    {
                                        label: "Não analisadas",
                                        value: "not_analyzed",
                                    },
                                ],
                            },
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
                                    {
                                        label: "Pendente",
                                        value: "pendente",
                                    },
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
                        getRowKey={(conversation) =>
                            `${conversation.item_type}:${conversation.id}`
                        }
                        onRowClick={handleOpenConversation}
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
                threadId={requestedThreadId}
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

function ConversationResultCell({
    conversation,
}: {
    conversation: ConversationRow;
}) {
    if (conversation.item_type === "thread") {
        return (
            <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                Ao vivo
            </span>
        );
    }


    return (
        <span className="inline-flex min-w-max">
            <Badge value={conversation.result} />
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
            <div className="grid grid-cols-[1.35fr_0.85fr_1fr_1.55fr_1.35fr_1.15fr_1.2fr_0.8fr_48px] border-b border-slate-100 bg-slate-50 px-6 py-3">
                {Array.from({ length: 9 }).map((_, index) => <Skeleton key={index} className="h-3 w-[70%]"/>)}
            </div>
            {Array.from({ length: 8 }).map((_, rowIndex) => (
                <div key={rowIndex} className="grid grid-cols-[1.35fr_0.85fr_1fr_1.55fr_1.35fr_1.15fr_1.2fr_0.8fr_48px] items-center border-b border-slate-100 px-6 py-4">
                    {Array.from({ length: 9 }).map((_, index) => <Skeleton key={index} className="h-4 w-[75%]"/>)}
                </div>
            ))}
        </div>
    );
}
