// app/mensagem-ativa/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import {
    Check,
    ChartNoAxesCombined,
    ChevronDown,
    Clock3,
    FileText,
    FileUp,
    Info,
    LoaderCircle,
    MessageSquareText,
    Minus,
    Send,
    Users,
    X,
} from "lucide-react";

import {
    AdvancedFilterButton,
    Badge,
    CalendarButton,
    DataTable,
    DropdownSelect,
    HoverBadgeList,
    Modal,
    Pagination,
    SearchFilter,
    SidePanel,
    Skeleton,
    type DataTableColumn,
    type DateRange,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import { openFloatingConversation } from "@/components/conversations/FloatingConversationPanel";
import {
    SpreadsheetImportModal,
    type SpreadsheetImportSendPayload,
} from "@/components/active-messages/SpreadsheetImportModal";
import { useDashboardDateFilter } from "@/components/dashboard/DashboardHeader";
import ButtonGroup from "@/components/ui/ButtonGroup";
import {
    DEFAULT_CALENDAR_PRESETS,
    applyCalendarDateParams,
} from "@/components/ui/CalendarButton";
import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";
import type {
    ActiveMessageClient,
    ActiveMessageFunnelStage,
    ActiveMessageSendHistory,
    ActiveMessageSendResponse,
    ActiveMessageTemplateSender,
    ActiveMessageTemplateSenderOption,
    ActiveMessagesPageResponse,
} from "@/types/activeMessages";

const CLIENTS_PER_PAGE = 10;
const HISTORY_PER_PAGE = 10;
const MAX_CLIENTS_PER_SEND = 500;

type ClientRow = {
    client: ActiveMessageClient;
    stage: ActiveMessageFunnelStage | null;
};

type SendFeedback = {
    tone: "success" | "warning" | "error";
    title: string;
    description: string;
};

type DynamicTemplateField = {
    key: string;
    field_id: string;
    label: string;
    placeholder?: string;
    default_value?: string;
    required?: boolean;
};

type SpreadsheetImportClientsResponse = {
    ok: boolean;
    requested_count: number;
    created_count: number;
    existing_count: number;
    client_ids: string[];
};

type ActiveMessageAnalyticsHistoryItem = {
    id: string;
    template_id: string;
    template_name: string;
    sent_count: number;
    response_count: number;
    schedule_count: number;
    created_at: string;
};

type ActiveMessageAnalyticsResponse = {
    history: ActiveMessageAnalyticsHistoryItem[];
};

export default function MensagemAtivaPage() {
    const [data, setData] = useState<ActiveMessagesPageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [templateId, setTemplateId] = useState("");
    const [templateSender, setTemplateSender] =
        useState<ActiveMessageTemplateSender>("secondary");
    const [dynamicValuesByTemplate, setDynamicValuesByTemplate] = useState<
        Record<string, Record<string, string>>
    >({});
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(
        () => new Set(),
    );

    const [search, setSearch] = useState("");
    const [stageValues, setStageValues] = useState<string[]>([]);
    const [tunnelValues, setTunnelValues] = useState<string[]>([]);
    const [originValues, setOriginValues] = useState<string[]>([]);
    const [closingTagValues, setClosingTagValues] = useState<string[]>([]);
    const [lastClientMessageRange, setLastClientMessageRange] =
        useState<DateRange>({
            start: null,
            end: null,
        });
    const [windowValues, setWindowValues] = useState<string[]>([]);
    const [activeSendValues, setActiveSendValues] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(1);

    const [confirmationOpen, setConfirmationOpen] = useState(false);
    const [spreadsheetImportOpen, setSpreadsheetImportOpen] = useState(false);
    const [spreadsheetPreparing, setSpreadsheetPreparing] = useState(false);
    const [sending, setSending] = useState(false);
    const [feedback, setFeedback] = useState<SendFeedback | null>(null);
    const deepLinkAppliedRef = useRef(false);

    function resetPageAndSet<T>(setter: (value: T) => void) {
        return (value: T) => {
            setCurrentPage(1);
            setter(value);
        };
    }

    async function loadPage({
        silent = false,
        refresh = false,
        signal,
    }: {
        silent?: boolean;
        refresh?: boolean;
        signal?: AbortSignal;
    } = {}) {
        if (!silent) {
            setLoading(true);
        }

        try {
            setLoadError(null);

            const response = await fetch(
                refresh ? "/api/mensagem-ativa?refresh=1" : "/api/mensagem-ativa",
                {
                credentials: "include",
                cache: "no-store",
                    signal,
                },
            );
            const json = (await response.json()) as
                | ActiveMessagesPageResponse
                | { error?: string };

            if (!response.ok) {
                throw new Error(
                    "error" in json && json.error
                        ? json.error
                        : "Não foi possível carregar a Mensagem Ativa",
                );
            }

            const nextData = json as ActiveMessagesPageResponse;

            setData(nextData);
            setTemplateId((current) =>
                current &&
                nextData.templates.some((item) => item.id === current)
                    ? current
                    : nextData.templates[0]?.id ?? "",
            );
            setTemplateSender((current) =>
                nextData.template_senders.some(
                    (option) => option.value === current,
                )
                    ? current
                    : nextData.template_senders[0]?.value ?? "secondary",
            );
        } catch (error) {
            if (signal?.aborted) return;
            console.error("[mensagem-ativa] failed to load", error);
            setLoadError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível carregar a Mensagem Ativa",
            );
        } finally {
            if (!silent && !signal?.aborted) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        const controller = new AbortController();
        void loadPage({ signal: controller.signal });

        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!data || deepLinkAppliedRef.current) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const requestedPhone = params.get("phone")?.trim() ?? "";
        const requestedClientId = params.get("client_id")?.trim() ?? "";

        if (!requestedPhone && !requestedClientId) {
            deepLinkAppliedRef.current = true;
            return;
        }

        const requestedPhoneDigits = normalizePhone(requestedPhone);
        const requestedClient =
            data.clients.find((client) => client.id === requestedClientId) ??
            data.clients.find(
                (client) =>
                    requestedPhoneDigits.length > 0 &&
                    normalizePhone(client.phone) === requestedPhoneDigits,
            ) ??
            null;

        const phoneForSearch =
            requestedPhone || requestedClient?.phone?.trim() || "";

        if (phoneForSearch) {
            setSearch(phoneForSearch);
        }

        if (requestedClient?.phone?.trim()) {
            setSelectedClientIds(new Set([requestedClient.id]));
        }

        deepLinkAppliedRef.current = true;
    }, [data]);

    const stageById = useMemo(
        () =>
            new Map(
                (data?.stages ?? []).map((stage) => [stage.id, stage]),
            ),
        [data?.stages],
    );

    const selectedTemplate = useMemo(
        () =>
            data?.templates.find(
                (template) => template.id === templateId,
            ) ?? null,
        [data?.templates, templateId],
    );

    const dynamicFields = useMemo(
        () => getTemplateDynamicFields(selectedTemplate),
        [selectedTemplate],
    );

    const dynamicValues = templateId
        ? dynamicValuesByTemplate[templateId] ?? {}
        : {};

    const templateFieldsComplete = dynamicFields.every((field) =>
        field.required
            ? Boolean(
                  dynamicValues[field.field_id]?.trim() ||
                      field.default_value?.trim(),
              )
            : true,
    );

    const tunnelOptions = useMemo(() => {
        const values = new Set<string>();

        for (const client of data?.clients ?? []) {
            const tunnel = client.last_tunnel?.trim();
            if (tunnel) values.add(tunnel);
        }

        return [...values]
            .sort((first, second) =>
                first.localeCompare(second, "pt-BR"),
            )
            .map((value) => ({ label: value, value }));
    }, [data?.clients]);

    const originOptions = useMemo(() => {
        const values = new Set<string>();

        for (const client of data?.clients ?? []) {
            values.add(client.last_origin?.trim() || "__NULL__");
        }

        return [...values]
            .sort((first, second) =>
                first.localeCompare(second, "pt-BR"),
            )
            .map((value) => ({
                label: value === "__NULL__" ? "Sem origem" : value,
                value,
            }));
    }, [data?.clients]);

    const closingTagOptions = useMemo(() => {
        const values = new Set<string>();

        for (const client of data?.clients ?? []) {
            const closingTag = client.last_closing_tag?.trim();

            if (closingTag) {
                values.add(closingTag);
            }
        }

        return [...values]
            .sort((first, second) =>
                first.localeCompare(second, "pt-BR"),
            )
            .map((value) => ({
                label: value,
                value,
            }));
    }, [data?.clients]);

    const stageFilterSections = useMemo(() => {
        const groups = new Map<
            string,
            {
                funnelId: string;
                funnelName: string;
                stages: ActiveMessageFunnelStage[];
            }
        >();

        for (const stage of data?.stages ?? []) {
            const funnelId = stage.funnel_id || "without-funnel";
            const current = groups.get(funnelId) ?? {
                funnelId,
                funnelName: stage.funnel_name?.trim() || "Sem funil",
                stages: [],
            };

            current.stages.push(stage);
            groups.set(funnelId, current);
        }

        return [...groups.values()]
            .sort((first, second) =>
                first.funnelName.localeCompare(
                    second.funnelName,
                    "pt-BR",
                ),
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
    }, [data?.stages, stageValues]);

    const filteredClients = useMemo(() => {
        const term = normalize(search);

        return (data?.clients ?? []).filter((client) => {
            if (
                stageValues.length > 0 &&
                (!client.funnel_stage_id ||
                    !stageValues.includes(client.funnel_stage_id))
            ) {
                return false;
            }

            if (
                tunnelValues.length > 0 &&
                !tunnelValues.includes(client.last_tunnel?.trim() || "")
            ) {
                return false;
            }

            if (
                originValues.length > 0 &&
                !originValues.includes(
                    client.last_origin?.trim() || "__NULL__",
                )
            ) {
                return false;
            }

            if (
                closingTagValues.length > 0 &&
                !closingTagValues.includes(
                    client.last_closing_tag?.trim() || "",
                )
            ) {
                return false;
            }

            if (
                !isTimestampInsideDateRange(
                    client.last_client_message_at,
                    lastClientMessageRange,
                )
            ) {
                return false;
            }

            if (windowValues.length > 0) {
                const windowStatus = client.whatsapp_window_open
                    ? "open"
                    : "expired";

                if (!windowValues.includes(windowStatus)) {
                    return false;
                }
            }

            if (activeSendValues.length > 0) {
                const sentStatus = client.last_active_message_sent_at
                    ? "sent"
                    : "never";

                if (!activeSendValues.includes(sentStatus)) {
                    return false;
                }
            }

            if (!term) {
                return true;
            }

            return [client.name, client.phone, client.email]
                .filter(Boolean)
                .some((value) =>
                    normalize(String(value)).includes(term),
                );
        });
    }, [
        activeSendValues,
        closingTagValues,
        data?.clients,
        lastClientMessageRange,
        search,
        originValues,
        stageValues,
        tunnelValues,
        windowValues,
    ]);

    const totalPages = Math.max(
        1,
        Math.ceil(filteredClients.length / CLIENTS_PER_PAGE),
    );
    const visiblePage = Math.min(currentPage, totalPages);

    const pageClients = useMemo(() => {
        const start = (visiblePage - 1) * CLIENTS_PER_PAGE;

        return filteredClients.slice(
            start,
            start + CLIENTS_PER_PAGE,
        );
    }, [filteredClients, visiblePage]);

    const pageRows = useMemo<ClientRow[]>(
        () =>
            pageClients.map((client) => ({
                client,
                stage: client.funnel_stage_id
                    ? stageById.get(client.funnel_stage_id) ?? null
                    : null,
            })),
        [pageClients, stageById],
    );

    const selectableFilteredClientIds = useMemo(
        () =>
            filteredClients
                .filter((client) => Boolean(client.phone?.trim()))
                .map((client) => client.id),
        [filteredClients],
    );

    const selectedCount = selectedClientIds.size;
    const selectedInFilterCount =
        selectableFilteredClientIds.filter((id) =>
            selectedClientIds.has(id),
        ).length;
    const allFilteredSelected =
        selectableFilteredClientIds.length > 0 &&
        selectedInFilterCount ===
            selectableFilteredClientIds.length;
    const someFilteredSelected =
        selectedInFilterCount > 0 && !allFilteredSelected;

    const openWindowCount = useMemo(
        () =>
            [...selectedClientIds].filter((clientId) => {
                const client = data?.clients.find(
                    (item) => item.id === clientId,
                );

                return Boolean(client?.whatsapp_window_open);
            }).length,
        [data?.clients, selectedClientIds],
    );

    const templateWindowCount = selectedCount - openWindowCount;

    const columns: DataTableColumn<ClientRow>[] = [
        {
            id: "selection",
            label: (
                <SelectionCheckbox
                    checked={allFilteredSelected}
                    indeterminate={someFilteredSelected}
                    title={
                        selectedInFilterCount > 0
                            ? "Desmarcar clientes filtrados"
                            : "Selecionar todos os clientes filtrados"
                    }
                    onChange={toggleAllFiltered}
                />
            ),
            width: "5%",
            render: ({ client }) => (
                <SelectionCheckbox
                    checked={selectedClientIds.has(client.id)}
                    disabled={!client.phone?.trim()}
                    title={
                        client.phone?.trim()
                            ? `Selecionar ${client.name ?? "cliente"}`
                            : "Cliente sem telefone"
                    }
                    onChange={() => toggleClient(client.id)}
                />
            ),
        },
        {
            id: "client",
            label: "Cliente",
            width: "20%",
            render: ({ client }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <InitialsAvatar
                        name={client.name ?? "Cliente"}
                    />
                    <div className="min-w-0">
                        <div className="truncate font-medium text-slate-700">
                            {client.name ?? "Cliente sem nome"}
                        </div>
                    </div>
                </div>
            ),
        },
        {
            id: "phone",
            label: "Telefone",
            width: "13%",
            render: ({ client }) => (
                <span
                    className={
                        client.phone
                            ? "truncate text-slate-700"
                            : "text-slate-400"
                    }
                >
                    {formatPhone(client.phone)}
                </span>
            ),
        },
        {
            id: "funnel",
            label: "Funil",
            width: "13%",
            render: ({ stage }) => (
                <Badge value={stage?.funnel_name ?? null} />
            ),
        },
        {
            id: "stage",
            label: "Estágio",
            width: "15%",
            render: ({ stage }) => (
                <Badge value={stage?.name ?? null} />
            ),
        },
        {
            id: "window",
            label: "Última mensagem do cliente",
            width: "17%",
            render: ({ client }) => (
                <WindowStatus
                    timestamp={client.last_client_message_at}
                    open={client.whatsapp_window_open}
                />
            ),
        },
        {
            id: "last_active_send",
            label: "Última mensagem ativa enviada em",
            width: "17%",
            render: ({ client }) => (
                <span className="truncate text-slate-700">
                    {formatDateTime(
                        client.last_active_message_sent_at,
                    )}
                </span>
            ),
        },
    ];

    async function submitSend({
        clientIds,
        filters,
    }: {
        clientIds: string[];
        filters: Record<string, unknown>;
    }) {
        if (
            !selectedTemplate ||
            !templateFieldsComplete ||
            clientIds.length === 0 ||
            sending
        ) {
            return false;
        }

        setSending(true);
        setFeedback(null);

        try {
            const response = await fetch(
                "/api/mensagem-ativa/send",
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        template_id: selectedTemplate.id,
                        client_ids: clientIds,
                        filters,
                        dynamic_values: dynamicValues,
                        template_sender: templateSender,
                    }),
                },
            );
            const json = (await response.json()) as
                | ActiveMessageSendResponse
                | { error?: string };

            if (!response.ok) {
                throw new Error(
                    "error" in json && json.error
                        ? json.error
                        : "Não foi possível concluir o envio",
                );
            }

            const result = json as ActiveMessageSendResponse;

            setFeedback({
                tone:
                    result.failed_count === 0
                        ? "success"
                        : "warning",
                title:
                    result.failed_count === 0
                        ? "Envio concluído"
                        : "Envio concluído com falhas",
                description: `${result.sent_count} de ${result.requested_count} mensagens enviadas. ${result.normal_message_count} dentro da janela de 24h e ${result.template_message_count} por template.${
                    result.failed_count > 0
                        ? ` ${result.failed_count} falharam.`
                        : ""
                }`,
            });
            await loadPage({ silent: true, refresh: true });
            return true;
        } catch (error) {
            console.error("[mensagem-ativa] send failed", error);
            setFeedback({
                tone: "error",
                title: "Não foi possível enviar",
                description:
                    error instanceof Error
                        ? error.message
                        : "Ocorreu uma falha inesperada no envio.",
            });
            return false;
        } finally {
            setSending(false);
        }
    }

    async function handleSend() {
        const sent = await submitSend({
            clientIds: [...selectedClientIds],
            filters: {
                search: search.trim() || null,
                funnel_stage_ids: stageValues,
                tunnels: tunnelValues,
                origins: originValues,
                closing_tags: closingTagValues,
                last_client_message_date_range:
                    lastClientMessageRange,
                whatsapp_window: windowValues,
                active_send_history: activeSendValues,
            },
        });

        setConfirmationOpen(false);
        if (sent) setSelectedClientIds(new Set());
    }

    async function handleSpreadsheetSend(
        payload: SpreadsheetImportSendPayload,
    ) {
        setSpreadsheetPreparing(true);

        try {
            let importedClientIds: string[] = [];
            let createdClientCount = 0;
            let existingClientCount = 0;

            if (payload.newClients.length > 0) {
                const response = await fetch(
                    "/api/mensagem-ativa/import-clients",
                    {
                        method: "POST",
                        credentials: "include",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            clients: payload.newClients,
                        }),
                    },
                );
                const json = (await response.json()) as
                    | SpreadsheetImportClientsResponse
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Não foi possível criar os novos clientes",
                    );
                }

                const importResult = json as SpreadsheetImportClientsResponse;
                importedClientIds = importResult.client_ids;
                createdClientCount = importResult.created_count;
                existingClientCount = importResult.existing_count;
            }

            const clientIds = [
                ...new Set([...payload.clientIds, ...importedClientIds]),
            ];

            const sent = await submitSend({
                clientIds,
                filters: {
                    source: "spreadsheet_import",
                    files: payload.fileNames,
                    scanned_count: payload.scannedCount,
                    matched_count: payload.matchedCount,
                    created_client_count: createdClientCount,
                    existing_client_count: existingClientCount,
                    whatsapp_window: {
                        open: payload.openWindowCount,
                        expired:
                            payload.templateWindowCount +
                            importedClientIds.length,
                    },
                },
            });

            if (sent) setSpreadsheetImportOpen(false);
            return sent;
        } catch (error) {
            console.error("[mensagem-ativa] spreadsheet import failed", error);
            setFeedback({
                tone: "error",
                title: "Não foi possível importar",
                description:
                    error instanceof Error
                        ? error.message
                        : "Ocorreu uma falha inesperada na importação.",
            });
            return false;
        } finally {
            setSpreadsheetPreparing(false);
        }
    }

    function toggleClient(clientId: string) {
        setSelectedClientIds((current) => {
            const next = new Set(current);

            if (next.has(clientId)) {
                next.delete(clientId);
            } else {
                next.add(clientId);
            }

            return next;
        });
    }

    function toggleAllFiltered() {
        setSelectedClientIds((current) => {
            const next = new Set(current);

            if (selectedInFilterCount > 0) {
                for (const id of selectableFilteredClientIds) {
                    next.delete(id);
                }
            } else {
                for (const id of selectableFilteredClientIds) {
                    next.add(id);
                }
            }

            return next;
        });
    }

    function clearSelection() {
        setSelectedClientIds(new Set());
    }

    function updateDynamicValue(
        fieldId: string,
        value: string,
    ) {
        if (!templateId) {
            return;
        }

        setDynamicValuesByTemplate((current) => ({
            ...current,
            [templateId]: {
                ...(current[templateId] ?? {}),
                [fieldId]: value,
            },
        }));
    }

    if (loading) {
        return <MensagemAtivaSkeleton />;
    }

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />

            <section className="min-w-0 flex-1 px-8 py-8 pb-16">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                        Mensagem Ativa
                    </h1>
                    <p className="mt-2 text-sm text-slate-500">
                        Envie mensagens proativas pelo WhatsApp com
                        seleção e segmentação de clientes.
                    </p>
                </header>

                {loadError ? (
                    <div className="mb-6 rounded-2xl border border-red/20 bg-red-soft px-5 py-4 text-sm font-bold text-red">
                        {loadError}
                    </div>
                ) : null}

                {feedback ? (
                    <FeedbackBanner feedback={feedback} />
                ) : null}

                <TemplateCard
                    templates={data?.templates ?? []}
                    selectedTemplate={selectedTemplate}
                    value={templateId}
                    dynamicFields={dynamicFields}
                    dynamicValues={dynamicValues}
                    senderOptions={data?.template_senders ?? []}
                    senderValue={templateSender}
                    onChange={setTemplateId}
                    onSenderChange={setTemplateSender}
                    onDynamicValueChange={updateDynamicValue}
                />

                <section className="mt-8">
                    <div className="border-b border-slate-100">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-2">
                            <h2 className="text-lg font-bold text-text">
                                Destinatários{" "}
                                <span className="text-slate-500">
                                    ({filteredClients.length})
                                </span>
                            </h2>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <SearchFilter
                                    value={search}
                                    onChange={resetPageAndSet(setSearch)}
                                    placeholder="Buscar por nome, telefone ou e-mail..."
                                    widthClassName="w-full sm:w-[360px]"
                                />

                                <AdvancedFilterButton
                                    label="Filtros"
                                    widthClassName="w-[120px]"
                                    dropdownWidthClassName="w-[360px]"
                                    sections={[
                                        ...stageFilterSections,
                                        {
                                            id: "tunnel",
                                            title: "Túneis",
                                            values: tunnelValues,
                                            onChange: resetPageAndSet(setTunnelValues),
                                            options: tunnelOptions,
                                        },
                                        {
                                            id: "source",
                                            title: "Origem",
                                            values: originValues,
                                            onChange: resetPageAndSet(setOriginValues),
                                            options: originOptions,
                                        },
                                        {
                                            id: "closing-tag",
                                            title: "Tag de fechamento",
                                            values: closingTagValues,
                                            onChange: resetPageAndSet(setClosingTagValues),
                                            options: closingTagOptions,
                                        },
                                        {
                                            id: "window",
                                            title: "Janela do WhatsApp",
                                            values: windowValues,
                                            onChange: resetPageAndSet(setWindowValues),
                                            options: [
                                                {
                                                    label: "Dentro das últimas 24h",
                                                    value: "open",
                                                },
                                                {
                                                    label: "Fora da janela de 24h",
                                                    value: "expired",
                                                },
                                            ],
                                        },
                                        {
                                            id: "active-send",
                                            title: "Mensagem ativa",
                                            values: activeSendValues,
                                            onChange: resetPageAndSet(setActiveSendValues),
                                            options: [
                                                {
                                                    label: "Já recebeu mensagem ativa",
                                                    value: "sent",
                                                },
                                                {
                                                    label: "Nunca recebeu mensagem ativa",
                                                    value: "never",
                                                },
                                            ],
                                        },
                                    ]}
                                />

                                <CalendarButton
                                    value={lastClientMessageRange}
                                    onChange={resetPageAndSet(setLastClientMessageRange)}
                                    className="shrink-0"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2 px-6 pt-1 pb-4">
                            <SelectionSummary
                                count={selectedCount}
                                onClear={clearSelection}
                            />

                            <button
                                type="button"
                                onClick={() => setSpreadsheetImportOpen(true)}
                                className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-selection focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                            >
                                <FileUp size={17} />
                                Importar planilha
                            </button>

                            <button
                                type="button"
                                onClick={() =>
                                    setConfirmationOpen(true)
                                }
                                disabled={
                                    !selectedTemplate ||
                                    !templateFieldsComplete ||
                                    selectedCount === 0 ||
                                    selectedCount >
                                        MAX_CLIENTS_PER_SEND ||
                                    sending
                                }
                                className="flex h-11 min-w-[120px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                            >
                                {sending ? (
                                    <LoaderCircle
                                        size={17}
                                        className="animate-spin"
                                    />
                                ) : (
                                    <Send size={17} />
                                )}
                                {sending ? "Enviando..." : "Enviar"}
                            </button>
                        </div>
                    </div>

                    {selectedCount > MAX_CLIENTS_PER_SEND ? (
                        <div className="border-b border-red/15 bg-red-soft px-6 py-3 text-sm font-bold text-red">
                            O limite é de{" "}
                            {MAX_CLIENTS_PER_SEND} clientes por
                            envio. Refine a seleção ou desmarque
                            alguns clientes.
                        </div>
                    ) : null}

                    <DataTable
                        columns={columns}
                        rows={pageRows}
                        getRowKey={(row: ClientRow) =>
                            row.client.id
                        }
                        emptyMessage="Nenhum cliente encontrado."
                    />

                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-6 py-5">
                        <div className="text-sm text-slate-500">
                            {filteredClients.length === 0
                                ? "Nenhum resultado"
                                : `Mostrando ${
                                      (currentPage - 1) *
                                          CLIENTS_PER_PAGE +
                                      1
                                  }–${Math.min(
                                      currentPage *
                                          CLIENTS_PER_PAGE,
                                      filteredClients.length,
                                  )} de ${
                                      filteredClients.length
                                  }`}
                        </div>

                        {totalPages > 1 ? (
                            <Pagination
                                totalPages={totalPages}
                                currentPage={visiblePage}
                                onPageChange={setCurrentPage}
                            />
                        ) : null}
                    </div>
                </section>

                <HistoryTable
                    key={data?.history[0]?.id ?? "empty-history"}
                    history={data?.history ?? []}
                />
                <ActiveMessageAnalytics history={data?.history ?? []} />
                <div className="pt-16" />
            </section>

            <SendConfirmationModal
                open={confirmationOpen}
                sending={sending}
                template={selectedTemplate}
                selectedCount={selectedCount}
                normalCount={openWindowCount}
                templateCount={templateWindowCount}
                onClose={() => {
                    if (!sending) {
                        setConfirmationOpen(false);
                    }
                }}
                onConfirm={() => void handleSend()}
            />

            <SpreadsheetImportModal
                open={spreadsheetImportOpen}
                clients={data?.clients ?? []}
                templateName={selectedTemplate?.name ?? null}
                templateReady={Boolean(
                    selectedTemplate && templateFieldsComplete,
                )}
                templateCategory={selectedTemplate?.category ?? null}
                sending={sending || spreadsheetPreparing}
                maxClients={MAX_CLIENTS_PER_SEND}
                onClose={() => {
                    if (!sending && !spreadsheetPreparing) {
                        setSpreadsheetImportOpen(false);
                    }
                }}
                onSend={handleSpreadsheetSend}
            />
        </main>
    );
}

function TemplateCard({
    templates,
    selectedTemplate,
    value,
    dynamicFields,
    dynamicValues,
    senderOptions,
    senderValue,
    onChange,
    onSenderChange,
    onDynamicValueChange,
}: {
    templates: ActiveMessageTemplate[];
    selectedTemplate: ActiveMessageTemplate | null;
    value: string;
    dynamicFields: DynamicTemplateField[];
    dynamicValues: Record<string, string>;
    senderOptions: ActiveMessageTemplateSenderOption[];
    senderValue: ActiveMessageTemplateSender;
    onChange: (value: string) => void;
    onSenderChange: (value: ActiveMessageTemplateSender) => void;
    onDynamicValueChange: (
        fieldId: string,
        value: string,
    ) => void;
}) {
    return (
        <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
            <div className="min-w-0">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-soft text-purple">
                        <FileText size={21} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-slate-950">
                            Template da mensagem
                        </h2>
                        <p className="mt-1 text-sm leading-relaxed text-slate-500">
                            Selecione e customize o template.
                        </p>
                    </div>
                </div>

                <div className="mt-5 space-y-4">
                    <DropdownSelect
                        value={value}
                        onChange={onChange}
                        options={templates.map((template) => ({
                            label: template.name,
                            value: template.id,
                        }))}
                        placeholder="Selecionar template"
                        icon={
                            <MessageSquareText size={17} />
                        }
                        widthClassName="w-full"
                        dropdownWidthClassName="w-full"
                    />

                    {dynamicFields.length > 0 ? (
                        <div className="space-y-3">
                            {dynamicFields.map((field) => (
                                <label
                                    key={field.field_id}
                                    className="block"
                                >
                                    <span className="mb-1.5 block text-xs font-bold text-slate-600">
                                        {field.label}
                                        {field.required ? (
                                            <span className="ml-1 text-red">
                                                *
                                            </span>
                                        ) : null}
                                    </span>
                                    <input
                                        type="text"
                                        value={
                                            dynamicValues[
                                                field.field_id
                                            ] ??
                                            field.default_value ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            onDynamicValueChange(
                                                field.field_id,
                                                event.target.value,
                                            )
                                        }
                                        placeholder={
                                            field.placeholder
                                        }
                                        maxLength={500}
                                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/10"
                                    />
                                </label>
                            ))}
                        </div>
                    ) : null}

                    <div className="border-t border-slate-100 pt-4">
                        <label className="mb-1.5 block text-xs font-bold text-slate-600">
                            Número para envios por template
                        </label>
                        <DropdownSelect
                            value={senderValue}
                            onChange={(value) =>
                                onSenderChange(
                                    value as ActiveMessageTemplateSender,
                                )
                            }
                            options={senderOptions.map((option) => ({
                                label: option.label,
                                value: option.value,
                            }))}
                            placeholder="Selecionar número"
                            widthClassName="w-full"
                            dropdownWidthClassName="w-full"
                        />
                    </div>
                </div>
            </div>

            {selectedTemplate ? (
                <div className="min-w-0 self-stretch whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 px-5 py-5 text-sm leading-7 text-slate-700">
                    {renderTemplatePreview(
                        selectedTemplate,
                        dynamicValues,
                    )}
                </div>
            ) : null}
        </section>
    );
}

function ActiveMessageAnalytics({
    history,
}: {
    history: ActiveMessageSendHistory[];
}) {
    const [selectedTemplateKeys, setSelectedTemplateKeys] = useState<
        Set<string> | null
    >(null);
    const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
    const [analyticsHistory, setAnalyticsHistory] = useState<
        ActiveMessageAnalyticsHistoryItem[]
    >([]);
    const [analyticsLoading, setAnalyticsLoading] = useState(true);
    const [analyticsError, setAnalyticsError] = useState<string | null>(null);
    const templateMenuRef = useRef<HTMLDivElement | null>(null);
    const {
        period,
        setPeriod,
        selectedRange,
        setSelectedRange,
        ready: dateFilterReady,
    } = useDashboardDateFilter("30");
    const analyticsQuery = useMemo(() => {
        if (!dateFilterReady) return "";

        const params = new URLSearchParams();
        applyCalendarDateParams({
            params,
            selectedRange,
            selectedPreset: period,
        });
        return params.toString();
    }, [dateFilterReady, period, selectedRange]);
    const historyRefreshKey = history[0]?.id ?? "";

    useEffect(() => {
        if (!analyticsQuery) return;

        const controller = new AbortController();
        setAnalyticsLoading(true);
        setAnalyticsError(null);
        setSelectedTemplateKeys(null);

        async function loadAnalytics() {
            try {
                const response = await fetch(
                    `/api/mensagem-ativa/analytics?${analyticsQuery}`,
                    {
                        credentials: "include",
                        cache: "no-store",
                        signal: controller.signal,
                    },
                );
                const json = (await response.json()) as
                    | ActiveMessageAnalyticsResponse
                    | { error?: string };

                if (!response.ok) {
                    throw new Error(
                        "error" in json && json.error
                            ? json.error
                            : "Não foi possível carregar o desempenho dos envios",
                    );
                }

                setAnalyticsHistory(
                    (json as ActiveMessageAnalyticsResponse).history,
                );
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error(
                    "[mensagem-ativa] failed to load analytics",
                    error,
                );
                setAnalyticsError(
                    error instanceof Error
                        ? error.message
                        : "Não foi possível carregar o desempenho dos envios",
                );
            } finally {
                if (!controller.signal.aborted) {
                    setAnalyticsLoading(false);
                }
            }
        }

        void loadAnalytics();
        return () => controller.abort();
    }, [analyticsQuery, historyRefreshKey]);

    const templateData = useMemo(() => {
        const totals = new Map<
            string,
            {
                key: string;
                name: string;
                sent: number;
                responses: number;
                schedules: number;
            }
        >();

        for (const send of analyticsHistory) {
            const key = send.template_id || send.template_name;
            const current = totals.get(key) ?? {
                key,
                name: send.template_name,
                sent: 0,
                responses: 0,
                schedules: 0,
            };

            current.sent += send.sent_count;
            current.responses += send.response_count;
            current.schedules += send.schedule_count;
            totals.set(key, current);
        }

        return [...totals.values()].sort(
            (first, second) => second.sent - first.sent,
        );
    }, [analyticsHistory]);

    const visibleTemplateKeys = useMemo(() => {
        const availableKeys = new Set(templateData.map((item) => item.key));

        if (selectedTemplateKeys === null) {
            return availableKeys;
        }

        return new Set(
            [...selectedTemplateKeys].filter((key) =>
                availableKeys.has(key),
            ),
        );
    }, [selectedTemplateKeys, templateData]);

    const dailyData = useMemo(() => {
        const totals = new Map<
            string,
            { date: string; sent: number; responses: number; schedules: number }
        >();

        for (const send of analyticsHistory) {
            const templateKey = send.template_id || send.template_name;
            if (!visibleTemplateKeys.has(templateKey)) continue;

            const timestamp = new Date(send.created_at);
            if (!Number.isFinite(timestamp.getTime())) continue;

            const date = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Sao_Paulo",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).format(timestamp);
            const current = totals.get(date) ?? {
                date,
                sent: 0,
                responses: 0,
                schedules: 0,
            };

            current.sent += send.sent_count;
            current.responses += send.response_count;
            current.schedules += send.schedule_count;
            totals.set(date, current);
        }

        return [...totals.values()]
            .sort((first, second) => first.date.localeCompare(second.date))
            .map((item) => ({
                ...item,
                label: formatChartDate(item.date),
            }));
    }, [analyticsHistory, visibleTemplateKeys]);

    const chartTotals = useMemo(
        () =>
            dailyData.reduce(
                (totals, item) => ({
                    sent: totals.sent + item.sent,
                    responses: totals.responses + item.responses,
                    schedules: totals.schedules + item.schedules,
                }),
                { sent: 0, responses: 0, schedules: 0 },
            ),
        [dailyData],
    );

    useEffect(() => {
        if (!templateMenuOpen) return;

        function closeOnOutsideClick(event: MouseEvent) {
            if (
                templateMenuRef.current &&
                !templateMenuRef.current.contains(event.target as Node)
            ) {
                setTemplateMenuOpen(false);
            }
        }

        document.addEventListener("mousedown", closeOnOutsideClick);
        return () =>
            document.removeEventListener("mousedown", closeOnOutsideClick);
    }, [templateMenuOpen]);

    const allTemplatesSelected =
        templateData.length > 0 &&
        visibleTemplateKeys.size === templateData.length;
    const templateSelectionLabel = allTemplatesSelected
        ? "Todos os templates"
        : `${visibleTemplateKeys.size} de ${templateData.length}`;

    function toggleTemplate(templateKey: string) {
        setSelectedTemplateKeys((current) => {
            const next = new Set(
                current ?? templateData.map((item) => item.key),
            );

            if (next.has(templateKey)) {
                next.delete(templateKey);
            } else {
                next.add(templateKey);
            }

            return next.size === templateData.length ? null : next;
        });
    }

    function toggleAllTemplates() {
        setSelectedTemplateKeys(allTemplatesSelected ? new Set() : null);
    }

    const hasData = templateData.length > 0;
    const initialAnalyticsLoading =
        analyticsLoading && analyticsHistory.length === 0;

    return (
        <section className="mt-10">
            <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <ChartNoAxesCombined size={19} />
                </div>
                <div>
                    <h2 className="font-bold text-slate-950">
                        Desempenho dos envios
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Uso dos templates, volume enviado e resultados.
                    </p>
                </div>
            </div>

            <div
                aria-hidden={!dateFilterReady}
                className={`mb-6 flex flex-wrap items-center gap-2 ${
                    dateFilterReady
                        ? ""
                        : "invisible pointer-events-none select-none"
                }`}
            >
                <ButtonGroup
                    value={period}
                    onChange={(value) => {
                        setPeriod(value);
                        setSelectedRange({ start: null, end: null });
                    }}
                    options={DEFAULT_CALENDAR_PRESETS.map((preset) => ({
                        value: preset.value,
                        label: preset.label,
                    }))}
                >
                    <CalendarButton
                        value={selectedRange}
                        onChange={setSelectedRange}
                        onApply={(range) => {
                            if (range.start) {
                                setPeriod(null);
                                return;
                            }

                            setPeriod(
                                DEFAULT_CALENDAR_PRESETS[0]?.value ??
                                    "yesterday",
                            );
                        }}
                    />
                </ButtonGroup>
            </div>

            {analyticsError ? (
                <div className="mb-6 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-bold text-red">
                    {analyticsError}
                </div>
            ) : null}

            <div className="grid items-start gap-6 xl:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="font-bold text-slate-950">
                        Templates utilizados
                    </h3>
                    {initialAnalyticsLoading ? (
                        <Skeleton className="mt-5 h-[280px] rounded-xl" />
                    ) : hasData ? (
                        <div
                            style={{
                                height: Math.max(280, templateData.length * 54),
                            }}
                            className="mt-5 w-full"
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={templateData}
                                    layout="vertical"
                                    margin={{ top: 0, right: 18, bottom: 0, left: 8 }}
                                >
                                    <CartesianGrid
                                        strokeDasharray="4 4"
                                        stroke="#e2e8f0"
                                        horizontal={false}
                                    />
                                    <XAxis
                                        type="number"
                                        allowDecimals={false}
                                        tick={{ fontSize: 11 }}
                                        stroke="#94a3b8"
                                    />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        width={138}
                                        tick={{ fontSize: 11 }}
                                        stroke="#94a3b8"
                                    />
                                    <Tooltip
                                        formatter={(value) => [
                                            Number(value).toLocaleString("pt-BR"),
                                            "Envios",
                                        ]}
                                    />
                                    <Bar
                                        dataKey="sent"
                                        name="Envios"
                                        fill="#06b6d4"
                                        radius={[0, 6, 6, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <ActiveMessageChartEmpty />
                    )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="font-bold text-slate-950">
                            Volume e resultados
                        </h3>

                        {templateData.length > 0 ? (
                            <div ref={templateMenuRef} className="relative">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setTemplateMenuOpen((open) => !open)
                                    }
                                    className="flex min-w-[172px] cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-cyan-300 hover:text-slate-800"
                                    aria-haspopup="listbox"
                                    aria-expanded={templateMenuOpen}
                                >
                                    <span className="truncate">
                                        {templateSelectionLabel}
                                    </span>
                                    <ChevronDown
                                        size={14}
                                        className={`shrink-0 text-slate-400 transition-transform ${
                                            templateMenuOpen ? "rotate-180" : ""
                                        }`}
                                    />
                                </button>

                                {templateMenuOpen ? (
                                    <div
                                        className="absolute right-0 z-50 mt-2 w-[280px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.16)]"
                                        role="listbox"
                                        aria-label="Templates exibidos no gráfico"
                                        aria-multiselectable="true"
                                    >
                                        <button
                                            type="button"
                                            onClick={toggleAllTemplates}
                                            className={`flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                                                allTemplatesSelected
                                                    ? "bg-cyan-50 font-semibold text-cyan-700"
                                                    : "text-slate-600 hover:bg-slate-50"
                                            }`}
                                            role="option"
                                            aria-selected={allTemplatesSelected}
                                        >
                                            <span>Todos os templates</span>
                                            {allTemplatesSelected ? (
                                                <Check size={15} />
                                            ) : null}
                                        </button>
                                        <div className="my-1 border-t border-slate-100" />
                                        <div className="max-h-[286px] overflow-y-auto pr-1">
                                            {templateData.map((template) => {
                                                const selected =
                                                    visibleTemplateKeys.has(
                                                        template.key,
                                                    );

                                                return (
                                                    <button
                                                        key={template.key}
                                                        type="button"
                                                        title={template.name}
                                                        onClick={() =>
                                                            toggleTemplate(
                                                                template.key,
                                                            )
                                                        }
                                                        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                                                            selected
                                                                ? "bg-cyan-50 font-semibold text-cyan-700"
                                                                : "text-slate-600 hover:bg-slate-50"
                                                        }`}
                                                        role="option"
                                                        aria-selected={selected}
                                                    >
                                                        <span
                                                            className="truncate"
                                                            title={template.name}
                                                        >
                                                            {shortTemplateSelectorLabel(
                                                                template.name,
                                                            )}
                                                        </span>
                                                        {selected ? (
                                                            <Check
                                                                size={15}
                                                                className="shrink-0"
                                                            />
                                                        ) : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    {templateData.length > 0 ? (
                        <div className="mt-5 grid grid-cols-3 gap-3">
                            <ActiveMessageTotal
                                label="Enviados"
                                value={chartTotals.sent}
                                color="#06b6d4"
                            />
                            <ActiveMessageTotal
                                label="Respostas"
                                value={chartTotals.responses}
                                color="#10b981"
                            />
                            <ActiveMessageTotal
                                label="Agendamentos"
                                value={chartTotals.schedules}
                                color="#8b5cf6"
                            />
                        </div>
                    ) : null}

                    {initialAnalyticsLoading ? (
                        <Skeleton className="mt-5 h-[280px] rounded-xl" />
                    ) : dailyData.length > 0 ? (
                        <div className="mt-5 h-[320px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart
                                    data={dailyData}
                                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                                >
                                    <CartesianGrid
                                        strokeDasharray="4 4"
                                        stroke="#e2e8f0"
                                    />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 11 }}
                                        stroke="#94a3b8"
                                        minTickGap={18}
                                    />
                                    <YAxis
                                        allowDecimals={false}
                                        tick={{ fontSize: 11 }}
                                        stroke="#94a3b8"
                                        width={42}
                                    />
                                    <Tooltip />
                                    <Bar
                                        dataKey="sent"
                                        name="Envios"
                                        fill="#06b6d4"
                                        radius={[5, 5, 0, 0]}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="responses"
                                        name="Respostas"
                                        stroke="#10b981"
                                        strokeWidth={3}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="schedules"
                                        name="Agendamentos"
                                        stroke="#8b5cf6"
                                        strokeWidth={3}
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : templateData.length > 0 ? (
                        <div className="mt-5 flex h-[280px] items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">
                            Selecione ao menos um template.
                        </div>
                    ) : (
                        <ActiveMessageChartEmpty />
                    )}
                </section>
            </div>
        </section>
    );
}

function ActiveMessageTotal({
    label,
    value,
    color,
}: {
    label: string;
    value: number;
    color: string;
}) {
    return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                />
                {label}
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900">
                {value.toLocaleString("pt-BR")}
            </div>
        </div>
    );
}

function shortTemplateSelectorLabel(name: string) {
    const [, ...suffixParts] = name.split("—");
    const suffix = suffixParts.join("—").trim();
    return suffix || name.trim();
}

function ActiveMessageChartEmpty() {
    return (
        <div className="mt-5 flex h-[280px] items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">
            Os gráficos serão preenchidos após os primeiros envios.
        </div>
    );
}

function HistoryTable({
    history,
}: {
    history: ActiveMessageSendHistory[];
}) {
    const [currentPage, setCurrentPage] = useState(1);

    const totalPages = Math.max(
        1,
        Math.ceil(history.length / HISTORY_PER_PAGE),
    );

    const visiblePage = Math.min(currentPage, totalPages);

    const pageHistory = useMemo(() => {
        const start = (visiblePage - 1) * HISTORY_PER_PAGE;
        return history.slice(start, start + HISTORY_PER_PAGE);
    }, [history, visiblePage]);

    const pageStart =
        history.length === 0
            ? 0
            : (visiblePage - 1) * HISTORY_PER_PAGE + 1;
    const pageEnd = Math.min(
        visiblePage * HISTORY_PER_PAGE,
        history.length,
    );

    const columns = useMemo<
        DataTableColumn<ActiveMessageSendHistory>[]
    >(
        () => [
            {
                id: "created_at",
                label: "Enviado em",
                width: "11%",
                render: (item) =>
                    formatDateTime(item.created_at),
            },
            {
                id: "template",
                label: "Template",
                width: "16%",
                render: (item) => (
                    <div
                        className="min-w-0"
                        title={`${item.template_name}\n${item.template_id}`}
                    >
                        <div className="truncate font-medium text-slate-700">
                            {item.template_name}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-400">
                            {item.template_id}
                        </div>
                    </div>
                ),
            },
            {
                id: "recipients",
                label: "Clientes/Conversas",
                width: "31%",
                render: (item) => (
                    <HoverBadgeList
                        items={[...item.recipients]
                            .sort(
                                (first, second) =>
                                    Number(second.responded) -
                                    Number(first.responded),
                            )
                            .map((recipient) => {
                                const canOpen =
                                    recipient.responded &&
                                    recipient.response_target_type !== null &&
                                    recipient.response_target_id !== null;
                                const statusDescription = recipient.responded
                                    ? "Respondeu ao disparo — clique para abrir a conversa"
                                    : recipient.status === "failed"
                                      ? "Falha no envio"
                                      : "Sem resposta nas 24 horas após o disparo";

                                return {
                                    key: recipient.client_id,
                                    label: recipient.client_name,
                                    title: `${recipient.client_name} — ${statusDescription}`,
                                    ariaLabel: `${recipient.client_name}. ${statusDescription}`,
                                    className: recipient.responded
                                        ? "bg-soft-green text-green"
                                        : recipient.status === "failed"
                                          ? "bg-red-soft text-red"
                                          : "bg-slate-100 text-slate-600",
                                    onClick: canOpen
                                        ? () =>
                                              openFloatingConversation({
                                                  type: recipient.response_target_type!,
                                                  id: recipient.response_target_id!,
                                              })
                                        : undefined,
                                };
                            })}
                        badgeClassName="rounded-full px-2.5 py-1 text-[11px] font-bold"
                        maxBadgeWidthClassName="max-w-[145px]"
                        expandedBadgeClassName="max-w-[260px]"
                        popupMaxWidthClassName="max-w-[680px]"
                        overflowIndicatorThreshold={30}
                        previewCount={0}
                    />
                ),
            },
            {
                id: "routing",
                label: "Roteamento",
                width: "11%",
                render: (item) => (
                    <div className="text-xs text-slate-600">
                        <div>
                            {item.normal_message_count} normais
                        </div>
                        <div className="mt-1">
                            {item.template_message_count} templates
                        </div>
                    </div>
                ),
            },
            {
                id: "result",
                label: "Resultado",
                width: "10%",
                render: (item) => (
                    <div className="text-xs text-slate-600">
                        <div>{item.sent_count} enviados</div>
                        <div className="mt-1">
                            {item.failed_count} falhas
                        </div>
                    </div>
                ),
            },
            {
                id: "metrics",
                label: (
                    <span className="inline-flex items-center gap-1.5">
                        Métricas
                        <span
                            title="Respostas: clientes que enviaram ao menos uma mensagem nas 24 horas após o disparo. Agendamentos: registros do Clinisys criados para clientes que receberam o envio, desde a data do disparo até 30 dias depois."
                            aria-label="Explicação das métricas"
                            className="inline-flex shrink-0 cursor-help text-slate-400"
                        >
                            <Info size={14} />
                        </span>
                    </span>
                ),
                width: "13%",
                render: (item) => (
                    <div className="text-xs text-slate-600">
                        <div>
                            {item.response_count} respostas {item.response_count/item.sent_count > 0 ? `(${((item.response_count/item.sent_count)*100).toFixed(1)}%)` : ''}
                        </div>
                        <div className="mt-1">
                            {item.schedule_count} agendamentos {item.schedule_count/item.sent_count > 0 ? `(${((item.schedule_count/item.sent_count)*100).toFixed(1)}%)` : ''}
                        </div>
                    </div>
                ),
            },
            {
                id: "status",
                label: "Status",
                width: "8%",
                render: (item) => (
                    <HistoryStatus status={item.status} />
                ),
            },
        ],
        [],
    );

    return (
        <section className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-soft text-blue">
                    <Clock3 size={19} />
                </div>
                <div>
                    <h2 className="font-bold text-slate-950">
                        Histórico de envios
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Últimos disparos realizados pela equipe.
                    </p>
                </div>
            </div>

            <DataTable
                columns={columns}
                rows={pageHistory}
                getRowKey={(
                    item: ActiveMessageSendHistory,
                ) => item.id}
                emptyMessage="Nenhuma mensagem ativa foi enviada ainda."
            />

            {history.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-6 py-5">
                    <div className="text-sm text-slate-500">
                        {`Mostrando ${pageStart}–${pageEnd} de ${history.length}`}
                    </div>

                    {totalPages > 1 ? (
                        <Pagination
                            totalPages={totalPages}
                            currentPage={visiblePage}
                            onPageChange={setCurrentPage}
                        />
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function SendConfirmationModal({
    open,
    sending,
    template,
    selectedCount,
    normalCount,
    templateCount,
    onClose,
    onConfirm,
}: {
    open: boolean;
    sending: boolean;
    template: ActiveMessageTemplate | null;
    selectedCount: number;
    normalCount: number;
    templateCount: number;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            width={560}
            height="auto"
            maxHeight="calc(100vh - 48px)"
            closeOnOverlayClick={!sending}
            closeOnEscape={!sending}
            showCloseButton={!sending}
            ariaLabelledBy="active-message-confirm-title"
        >
            <div className="p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                    <Send size={22} />
                </div>
                <h2
                    id="active-message-confirm-title"
                    className="mt-5 text-xl font-bold text-slate-950"
                >
                    Confirmar envio
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                    Você enviará{" "}
                    <strong>
                        {template?.name ?? "o template"}
                    </strong>{" "}
                    para {selectedCount} cliente
                    {selectedCount === 1 ? "" : "s"}.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-green/15 bg-green-soft p-4">
                        <div className="text-2xl font-bold text-green">
                            {normalCount}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-green">
                            Mensagem normal
                        </div>
                    </div>
                    <div className="rounded-xl border border-purple/15 bg-purple-soft p-4">
                        <div className="text-2xl font-bold text-purple">
                            {templateCount}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-purple">
                            Template aprovado
                        </div>
                    </div>
                </div>

                <p className="mt-4 text-xs leading-relaxed text-slate-400">
                    O sistema recalcula a janela de 24 horas para
                    cada cliente no momento do envio.
                </p>

                <div className="mt-7 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={sending}
                        className="h-11 cursor-pointer rounded-xl px-5 text-sm font-bold text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={sending}
                        className="flex h-11 min-w-[150px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {sending ? (
                            <LoaderCircle
                                size={17}
                                className="animate-spin"
                            />
                        ) : (
                            <Send size={17} />
                        )}
                        {sending
                            ? "Enviando..."
                            : "Confirmar envio"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

function SelectionCheckbox({
    checked,
    indeterminate = false,
    disabled = false,
    title,
    onChange,
}: {
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    title: string;
    onChange: () => void;
}) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onChange}
            className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                disabled
                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300"
                    : checked || indeterminate
                      ? "cursor-pointer border-brand bg-brand text-white"
                      : "cursor-pointer border-slate-300 bg-white text-transparent hover:border-brand"
            }`}
        >
            {indeterminate ? (
                <Minus size={13} />
            ) : (
                <Check size={13} />
            )}
        </button>
    );
}

function SelectionSummary({
    count,
    onClear,
}: {
    count: number;
    onClear: () => void;
}) {
    return (
        <div
            className={`inline-flex h-10 items-center gap-2 rounded-xl bg-brand-soft text-sm font-bold text-brand ${
                count > 0 ? "pl-3 pr-1" : "px-3"
            }`}
        >
            <Users size={16} />
            <span>
                {count} selecionado{count === 1 ? "" : "s"}
            </span>

            {count > 0 ? (
                <button
                    type="button"
                    title="Desmarcar tudo"
                    aria-label="Desmarcar todos os clientes"
                    onClick={onClear}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-brand transition duration-200 hover:text-red-700"
                >
                    <X size={15} />
                </button>
            ) : null}
        </div>
    );
}

function WindowStatus({
    timestamp,
    open,
}: {
    timestamp: string | null;
    open: boolean;
}) {

    return (
        <div className="min-w-0">
            <div className="truncate text-slate-700">
                {formatDateTime(timestamp)}
            </div>
            <div
                className={`mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold ${
                    open ? "text-green" : "text-orange"
                }`}
            >
                <span
                    className={`h-1.5 w-1.5 rounded-full ${
                        open ? "bg-green" : "bg-orange"
                    }`}
                />
                {open ? "Dentro da janela" : "Usará template"}
            </div>
        </div>
    );
}

function HistoryStatus({
    status,
}: {
    status: ActiveMessageSendHistory["status"];
}) {
    const styles = {
        processing: "bg-blue-soft text-blue",
        completed: "bg-green-soft text-green",
        partial: "bg-orange-soft text-orange",
        failed: "bg-red-soft text-red",
    }[status];

    const label = {
        processing: "Enviando",
        completed: "Concluído",
        partial: "Parcial",
        failed: "Falhou",
    }[status];

    return (
        <span
            className={`inline-flex rounded-xl px-2.5 py-1 text-xs font-bold ${styles}`}
        >
            {label}
        </span>
    );
}

function FeedbackBanner({
    feedback,
}: {
    feedback: SendFeedback;
}) {
    const classes = {
        success: "border-green/20 bg-green-soft text-green",
        warning: "border-orange/20 bg-orange-soft text-orange",
        error: "border-red/20 bg-red-soft text-red",
    }[feedback.tone];

    return (
        <div
            className={`mb-6 rounded-2xl border px-5 py-4 ${classes}`}
        >
            <div className="font-bold">{feedback.title}</div>
            <div className="mt-1 text-sm leading-relaxed">
                {feedback.description}
            </div>
        </div>
    );
}

function MensagemAtivaSkeleton() {
    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />
            <section className="min-w-0 flex-1 px-8 py-8 pb-16">
                <Skeleton className="h-10 w-64" />
                <Skeleton className="mt-3 h-5 w-[520px] max-w-full" />
                <Skeleton className="mt-8 h-56 rounded-2xl" />
                <Skeleton className="mt-8 h-[520px] rounded-2xl" />
                <Skeleton className="mt-10 h-72 rounded-2xl" />
            </section>
        </main>
    );
}

function getTemplateDynamicFields(
    template: ActiveMessageTemplate | null,
): DynamicTemplateField[] {
    if (!template) {
        return [];
    }

    return template.parameters.flatMap((parameter) =>
        parameter.source.type === "dynamic"
            ? [
                  {
                      key: parameter.key,
                      ...parameter.source,
                  },
              ]
            : [],
    );
}

function renderTemplatePreview(
    template: ActiveMessageTemplate,
    dynamicValues: Record<string, string>,
) {
    const parameterByKey = new Map(
        template.parameters.map((parameter) => [
            parameter.key,
            parameter,
        ]),
    );
    const segments = template.preview.split(
        /(\{\{[^{}]+\}\})/g,
    );

    return segments.map((segment, index) => {
        const match = segment.match(/^\{\{([^{}]+)\}\}$/);

        if (!match) {
            return segment;
        }

        const key = match[1];
        const parameter = parameterByKey.get(key);

        if (!parameter) {
            return (
                <TemplateParameterBadge
                    key={`${key}-${index}`}
                    tone="neutral"
                    value={`Parâmetro ${key}`}
                />
            );
        }

        if (parameter.source.type === "database") {
            return (
                <TemplateParameterBadge
                    key={`${key}-${index}`}
                    tone="database"
                    value={getDatabaseParameterLabel(
                        parameter.source.field,
                    )}
                />
            );
        }

        if (parameter.source.type === "static") {
            return (
                <TemplateParameterBadge
                    key={`${key}-${index}`}
                    tone="neutral"
                    value={parameter.source.value}
                />
            );
        }

        const dynamicValue =
            dynamicValues[
                parameter.source.field_id
            ]?.trim() ||
            parameter.source.default_value?.trim() ||
            parameter.source.label;

        return (
            <TemplateParameterBadge
                key={`${key}-${index}`}
                tone="neutral"
                value={dynamicValue}
            />
        );
    });
}

function TemplateParameterBadge({
    value,
    tone,
}: {
    value: string;
    tone: "database" | "neutral";
}) {
    return (
        <span
            className={`mx-0.5 inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 align-baseline text-xs font-bold leading-5 ${
                tone === "database"
                    ? "border-purple/15 bg-purple-soft text-purple"
                    : "border-slate-200 bg-slate-100 text-slate-600"
            }`}
        >
            {value}
        </span>
    );
}

function getDatabaseParameterLabel(field: string) {
    if (field === "client_first_name") {
        return "Primeiro nome";
    }

    return String(field);
}

function isTimestampInsideDateRange(
    timestamp: string | null,
    range: DateRange,
) {
    if (!range.start) {
        return true;
    }

    if (!timestamp) {
        return false;
    }

    const date = new Date(timestamp);

    if (!Number.isFinite(date.getTime())) {
        return false;
    }

    const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
    const end = range.end ?? range.start;

    return dateKey >= range.start && dateKey <= end;
}


function normalizePhone(value: string | null | undefined) {
    return value?.replace(/\D/g, "") ?? "";
}

function formatPhone(value: string | null) {
    if (!value) {
        return "—";
    }

    const digits = value.replace(/\D/g, "");
    const local = digits.startsWith("55")
        ? digits.slice(2)
        : digits;

    if (local.length === 11) {
        return `(${local.slice(0, 2)}) ${local.slice(
            2,
            7,
        )}-${local.slice(7)}`;
    }

    if (local.length === 10) {
        return `(${local.slice(0, 2)}) ${local.slice(
            2,
            6,
        )}-${local.slice(6)}`;
    }

    return value;
}

function formatDateTime(value: string | null) {
    if (!value) {
        return "—";
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
        return "—";
    }

    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(date);
}

function formatChartDate(value: string) {
    const date = new Date(`${value}T12:00:00-03:00`);

    if (!Number.isFinite(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "America/Sao_Paulo",
    }).format(date);
}

function normalize(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
}
