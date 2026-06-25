// app/mensagem-ativa/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Check,
    Clock3,
    FileText,
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
    DataTable,
    DropdownSelect,
    Modal,
    Pagination,
    SidePanel,
    Skeleton,
    TableHeaderPreset,
    type DataTableColumn,
} from "@/components";
import { InitialsAvatar } from "@/components/conversations/InitialsAvatar";
import type { ActiveMessageTemplate } from "@/lib/active-messages/templates";
import type {
    ActiveMessageClient,
    ActiveMessageFunnelStage,
    ActiveMessageSendHistory,
    ActiveMessageSendResponse,
    ActiveMessagesPageResponse,
} from "@/types/activeMessages";

const CLIENTS_PER_PAGE = 10;
const HISTORY_PER_PAGE = 10;
const MAX_CLIENTS_PER_SEND = 500;
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

type ClientRow = {
    client: ActiveMessageClient;
    stage: ActiveMessageFunnelStage | null;
};

type SendFeedback = {
    tone: "success" | "warning" | "error";
    title: string;
    description: string;
};

export default function MensagemAtivaPage() {
    const [data, setData] = useState<ActiveMessagesPageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [templateId, setTemplateId] = useState("");
    const [dynamicValuesByTemplate, setDynamicValuesByTemplate] = useState<
        Record<string, Record<string, string>>
    >({});
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [search, setSearch] = useState("");
    const [stageValues, setStageValues] = useState<string[]>([]);
    const [sourceValues, setSourceValues] = useState<string[]>([]);
    const [windowValues, setWindowValues] = useState<string[]>([]);
    const [activeSendValues, setActiveSendValues] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(1);

    const [confirmationOpen, setConfirmationOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const [feedback, setFeedback] = useState<SendFeedback | null>(null);
    const deepLinkAppliedRef = useRef(false);

    async function loadPage({ silent = false } = {}) {
        if (!silent) setLoading(true);

        try {
            setLoadError(null);
            const response = await fetch("/api/mensagem-ativa", {
                credentials: "include",
                cache: "no-store",
            });
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
                current && nextData.templates.some((item) => item.id === current)
                    ? current
                    : nextData.templates[0]?.id ?? "",
            );
        } catch (error) {
            console.error("[mensagem-ativa] failed to load", error);
            setLoadError(
                error instanceof Error
                    ? error.message
                    : "Não foi possível carregar a Mensagem Ativa",
            );
        } finally {
            if (!silent) setLoading(false);
        }
    }

    useEffect(() => {
        void loadPage();
    }, []);

    useEffect(() => {
        if (!data || deepLinkAppliedRef.current) return;

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
        () => new Map((data?.stages ?? []).map((stage) => [stage.id, stage])),
        [data?.stages],
    );

    const selectedTemplate = useMemo(
        () =>
            data?.templates.find((template) => template.id === templateId) ??
            null,
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

    const sourceOptions = useMemo(() => {
        const values = new Set<string>();

        for (const client of data?.clients ?? []) {
            values.add(client.utm_source?.trim() || "direct");
        }

        return [...values]
            .sort((first, second) => first.localeCompare(second, "pt-BR"))
            .map((value) => ({
                label: value === "direct" ? "Direto" : value,
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
                first.funnelName.localeCompare(second.funnelName, "pt-BR"),
            )
            .map((group) => {
                const stageIds = new Set(group.stages.map((stage) => stage.id));

                return {
                    id: `funnel-${group.funnelId}`,
                    title: `${group.funnelName} — Estágios`,
                    values: stageValues.filter((stageId) => stageIds.has(stageId)),
                    onChange: (nextValues: string[]) => {
                        setStageValues((currentValues) => [
                            ...currentValues.filter(
                                (stageId) => !stageIds.has(stageId),
                            ),
                            ...nextValues,
                        ]);
                    },
                    options: [...group.stages]
                        .sort((first, second) => first.position - second.position)
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
                sourceValues.length > 0 &&
                !sourceValues.includes(client.utm_source?.trim() || "direct")
            ) {
                return false;
            }

            if (windowValues.length > 0) {
                const windowStatus = isWindowOpen(client.last_client_message_at)
                    ? "open"
                    : "expired";
                if (!windowValues.includes(windowStatus)) return false;
            }

            if (activeSendValues.length > 0) {
                const sentStatus = client.last_active_message_sent_at
                    ? "sent"
                    : "never";
                if (!activeSendValues.includes(sentStatus)) return false;
            }

            if (!term) return true;

            return [client.name, client.phone, client.email]
                .filter(Boolean)
                .some((value) => normalize(String(value)).includes(term));
        });
    }, [
        activeSendValues,
        data?.clients,
        search,
        sourceValues,
        stageValues,
        windowValues,
    ]);

    useEffect(() => {
        setCurrentPage(1);
    }, [search, stageValues, sourceValues, windowValues, activeSendValues]);

    const totalPages = Math.max(
        1,
        Math.ceil(filteredClients.length / CLIENTS_PER_PAGE),
    );

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);

    const pageClients = useMemo(() => {
        const start = (currentPage - 1) * CLIENTS_PER_PAGE;
        return filteredClients.slice(start, start + CLIENTS_PER_PAGE);
    }, [currentPage, filteredClients]);

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
    const selectedInFilterCount = selectableFilteredClientIds.filter((id) =>
        selectedClientIds.has(id),
    ).length;
    const allFilteredSelected =
        selectableFilteredClientIds.length > 0 &&
        selectedInFilterCount === selectableFilteredClientIds.length;
    const someFilteredSelected =
        selectedInFilterCount > 0 && !allFilteredSelected;

    const openWindowCount = useMemo(
        () =>
            [...selectedClientIds].filter((clientId) => {
                const client = data?.clients.find((item) => item.id === clientId);
                return Boolean(client && isWindowOpen(client.last_client_message_at));
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
                        <InitialsAvatar name={client.name ?? "Cliente"} />
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
                render: ({ stage }) => <Badge value={stage?.name ?? null} />,
            },
            {
                id: "window",
                label: "Última mensagem do cliente",
                width: "17%",
                render: ({ client }) => (
                    <WindowStatus timestamp={client.last_client_message_at} />
                ),
            },
            {
                id: "last_active_send",
                label: "Última mensagem ativa enviada em",
                width: "17%",
                render: ({ client }) => (
                    <span className="truncate text-slate-700">
                        {formatDateTime(client.last_active_message_sent_at)}
                    </span>
                ),
            },
    ];

    async function handleSend() {
        if (
            !selectedTemplate ||
            !templateFieldsComplete ||
            selectedCount === 0 ||
            sending
        ) {
            return;
        }

        setSending(true);
        setFeedback(null);

        try {
            const response = await fetch("/api/mensagem-ativa/send", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    template_id: selectedTemplate.id,
                    client_ids: [...selectedClientIds],
                    filters: {
                        search: search.trim() || null,
                        funnel_stage_ids: stageValues,
                        origins: sourceValues,
                        whatsapp_window: windowValues,
                        active_send_history: activeSendValues,
                    },
                    dynamic_values: dynamicValues,
                }),
            });
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
                tone: result.failed_count === 0 ? "success" : "warning",
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
            setSelectedClientIds(new Set());
            setConfirmationOpen(false);
            await loadPage({ silent: true });
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
            setConfirmationOpen(false);
        } finally {
            setSending(false);
        }
    }

    function toggleClient(clientId: string) {
        setSelectedClientIds((current) => {
            const next = new Set(current);
            if (next.has(clientId)) next.delete(clientId);
            else next.add(clientId);
            return next;
        });
    }

    function toggleAllFiltered() {
        setSelectedClientIds((current) => {
            const next = new Set(current);

            if (selectedInFilterCount > 0) {
                for (const id of selectableFilteredClientIds) next.delete(id);
            } else {
                for (const id of selectableFilteredClientIds) next.add(id);
            }

            return next;
        });
    }

    function clearSelection() {
        setSelectedClientIds(new Set());
    }

    function updateDynamicValue(fieldId: string, value: string) {
        if (!templateId) return;

        setDynamicValuesByTemplate((current) => ({
            ...current,
            [templateId]: {
                ...(current[templateId] ?? {}),
                [fieldId]: value,
            },
        }));
    }

    if (loading) return <MensagemAtivaSkeleton />;

    return (
        <main className="flex h-screen w-screen overflow-y-scroll bg-white text-slate-900">
            <SidePanel />

            <section className="min-w-0 flex-1 px-8 py-8 pb-16">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                        Mensagem Ativa
                    </h1>
                    <p className="mt-2 text-sm text-slate-500">
                        Envie mensagens proativas pelo WhatsApp com seleção e
                        segmentação de clientes.
                    </p>
                </header>

                {loadError ? (
                    <div className="mb-6 rounded-2xl border border-red/20 bg-red-soft px-5 py-4 text-sm font-bold text-red">
                        {loadError}
                    </div>
                ) : null}

                {feedback ? <FeedbackBanner feedback={feedback} /> : null}

                <TemplateCard
                    templates={data?.templates ?? []}
                    selectedTemplate={selectedTemplate}
                    value={templateId}
                    dynamicFields={dynamicFields}
                    dynamicValues={dynamicValues}
                    onChange={setTemplateId}
                    onDynamicValueChange={updateDynamicValue}
                />

                <section className="mt-8">
                    <TableHeaderPreset
                        title="Destinatários"
                        count={filteredClients.length}
                        searchValue={search}
                        onSearchChange={setSearch}
                        searchPlaceholder="Buscar por nome, telefone ou e-mail..."
                    >
                        <AdvancedFilterButton
                            label="Filtros"
                            widthClassName="w-[120px]"
                            dropdownWidthClassName="w-[360px]"
                            sections={[
                                ...stageFilterSections,
                                {
                                    id: "source",
                                    title: "Origem",
                                    values: sourceValues,
                                    onChange: setSourceValues,
                                    options: sourceOptions,
                                },
                                {
                                    id: "window",
                                    title: "Janela do WhatsApp",
                                    values: windowValues,
                                    onChange: setWindowValues,
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
                                    onChange: setActiveSendValues,
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

                        <SelectionSummary
                            count={selectedCount}
                            onClear={clearSelection}
                        />

                        <button
                            type="button"
                            onClick={() => setConfirmationOpen(true)}
                            disabled={
                                !selectedTemplate ||
                                !templateFieldsComplete ||
                                selectedCount === 0 ||
                                selectedCount > MAX_CLIENTS_PER_SEND ||
                                sending
                            }
                            className="flex h-11 min-w-[120px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                        >
                            {sending ? (
                                <LoaderCircle size={17} className="animate-spin" />
                            ) : (
                                <Send size={17} />
                            )}
                            {sending ? "Enviando..." : "Enviar"}
                        </button>
                    </TableHeaderPreset>

                    {selectedCount > MAX_CLIENTS_PER_SEND ? (
                        <div className="border-b border-red/15 bg-red-soft px-6 py-3 text-sm font-bold text-red">
                            O limite é de {MAX_CLIENTS_PER_SEND} clientes por envio.
                            Refine a seleção ou desmarque alguns clientes.
                        </div>
                    ) : null}

                    <DataTable
                        columns={columns}
                        rows={pageRows}
                        getRowKey={(row: ClientRow) => row.client.id}
                        emptyMessage="Nenhum cliente encontrado."
                    />

                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-6 py-5">
                        <div className="text-sm text-slate-500">
                            {filteredClients.length === 0
                                ? "Nenhum resultado"
                                : `Mostrando ${
                                      (currentPage - 1) * CLIENTS_PER_PAGE + 1
                                  }–${Math.min(
                                      currentPage * CLIENTS_PER_PAGE,
                                      filteredClients.length,
                                  )} de ${filteredClients.length}`}
                        </div>

                        {totalPages > 1 ? (
                            <Pagination
                                totalPages={totalPages}
                                currentPage={currentPage}
                                onPageChange={setCurrentPage}
                            />
                        ) : null}
                    </div>
                </section>

                <HistoryTable history={data?.history ?? []} />
                <div className={"pt-16"}>

                </div>
            </section>

            <SendConfirmationModal
                open={confirmationOpen}
                sending={sending}
                template={selectedTemplate}
                selectedCount={selectedCount}
                normalCount={openWindowCount}
                templateCount={templateWindowCount}
                onClose={() => {
                    if (!sending) setConfirmationOpen(false);
                }}
                onConfirm={() => void handleSend()}
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
    onChange,
    onDynamicValueChange,
}: {
    templates: ActiveMessageTemplate[];
    selectedTemplate: ActiveMessageTemplate | null;
    value: string;
    dynamicFields: DynamicTemplateField[];
    dynamicValues: Record<string, string>;
    onChange: (value: string) => void;
    onDynamicValueChange: (fieldId: string, value: string) => void;
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
                        icon={<MessageSquareText size={17} />}
                        widthClassName="w-full"
                        dropdownWidthClassName="w-full"
                    />

                    {dynamicFields.length > 0 ? (
                        <div className="space-y-3">
                            {dynamicFields.map((field) => (
                                <label key={field.field_id} className="block">
                                    <span className="mb-1.5 block text-xs font-bold text-slate-600">
                                        {field.label}
                                        {field.required ? (
                                            <span className="ml-1 text-red">*</span>
                                        ) : null}
                                    </span>
                                    <input
                                        type="text"
                                        value={
                                            dynamicValues[field.field_id] ??
                                            field.default_value ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            onDynamicValueChange(
                                                field.field_id,
                                                event.target.value,
                                            )
                                        }
                                        placeholder={field.placeholder}
                                        maxLength={500}
                                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/10"
                                    />
                                </label>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>

            {selectedTemplate ? (
                <div className="min-w-0 self-stretch whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 px-5 py-5 text-sm leading-7 text-slate-700">
                    {renderTemplatePreview(selectedTemplate, dynamicValues)}
                </div>
            ) : null}
        </section>
    );
}

function HistoryTable({ history }: { history: ActiveMessageSendHistory[] }) {
    const [currentPage, setCurrentPage] = useState(1);

    const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE));

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    useEffect(() => {
        setCurrentPage(1);
    }, [history]);

    const pageHistory = useMemo(() => {
        const start = (currentPage - 1) * HISTORY_PER_PAGE;
        return history.slice(start, start + HISTORY_PER_PAGE);
    }, [currentPage, history]);

    const pageStart =
        history.length === 0 ? 0 : (currentPage - 1) * HISTORY_PER_PAGE + 1;
    const pageEnd = Math.min(currentPage * HISTORY_PER_PAGE, history.length);

    const columns = useMemo<DataTableColumn<ActiveMessageSendHistory>[]>(
        () => [
            {
                id: "created_at",
                label: "Enviado em",
                width: "18%",
                render: (item) => formatDateTime(item.created_at),
            },
            {
                id: "template",
                label: "Template",
                width: "24%",
                render: (item) => (
                    <div className="min-w-0">
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
                id: "clients",
                label: "Clientes",
                width: "12%",
                align: "center",
                render: (item) => item.requested_count,
            },
            {
                id: "routing",
                label: "Roteamento",
                width: "20%",
                render: (item) => (
                    <div className="text-xs text-slate-600">
                        <div>{item.normal_message_count} normais</div>
                        <div className="mt-1">{item.template_message_count} templates</div>
                    </div>
                ),
            },
            {
                id: "result",
                label: "Resultado",
                width: "14%",
                render: (item) => (
                    <div className="text-xs text-slate-600">
                        <div>{item.sent_count} enviados</div>
                        <div className="mt-1">{item.failed_count} falhas</div>
                    </div>
                ),
            },
            {
                id: "status",
                label: "Status",
                width: "12%",
                render: (item) => <HistoryStatus status={item.status} />,
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
                    <h2 className="font-bold text-slate-950">Histórico de envios</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        Últimos disparos realizados pela equipe.
                    </p>
                </div>
            </div>

            <DataTable
                columns={columns}
                rows={pageHistory}
                getRowKey={(item: ActiveMessageSendHistory) => item.id}
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
                            currentPage={currentPage}
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
                    Você enviará <strong>{template?.name ?? "o template"}</strong>{" "}
                    para {selectedCount} cliente{selectedCount === 1 ? "" : "s"}.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-green/15 bg-green-soft p-4">
                        <div className="text-2xl font-bold text-green">{normalCount}</div>
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
                    O sistema recalcula a janela de 24 horas para cada cliente no
                    momento do envio.
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
                            <LoaderCircle size={17} className="animate-spin" />
                        ) : (
                            <Send size={17} />
                        )}
                        {sending ? "Enviando..." : "Confirmar envio"}
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
            {indeterminate ? <Minus size={13} /> : <Check size={13} />}
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
        <div className={`inline-flex h-10 items-center gap-2 rounded-xl bg-brand-soft text-sm font-bold  text-brand ${count > 0 ? "pl-3 pr-1" : "px-3"}`}>
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
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-brand transition hover:text-red-700 duration-200"
                >
                    <X size={15} />
                </button>
            ) : null}
        </div>
    );
}

function WindowStatus({ timestamp }: { timestamp: string | null }) {
    const open = isWindowOpen(timestamp);

    return (
        <div className="min-w-0">
            <div className="truncate text-slate-700">{formatDateTime(timestamp)}</div>
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
        <span className={`inline-flex rounded-xl px-2.5 py-1 text-xs font-bold ${styles}`}>
            {label}
        </span>
    );
}

function FeedbackBanner({ feedback }: { feedback: SendFeedback }) {
    const classes = {
        success: "border-green/20 bg-green-soft text-green",
        warning: "border-orange/20 bg-orange-soft text-orange",
        error: "border-red/20 bg-red-soft text-red",
    }[feedback.tone];

    return (
        <div className={`mb-6 rounded-2xl border px-5 py-4 ${classes}`}>
            <div className="font-bold">{feedback.title}</div>
            <div className="mt-1 text-sm leading-relaxed">{feedback.description}</div>
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

type DynamicTemplateField = {
    key: string;
    field_id: string;
    label: string;
    placeholder?: string;
    default_value?: string;
    required?: boolean;
};

function getTemplateDynamicFields(
    template: ActiveMessageTemplate | null,
): DynamicTemplateField[] {
    if (!template) return [];

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
        template.parameters.map((parameter) => [parameter.key, parameter]),
    );
    const segments = template.preview.split(/(\{\{[^{}]+\}\})/g);

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
                    value={getDatabaseParameterLabel(parameter.source.field)}
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
            dynamicValues[parameter.source.field_id]?.trim() ||
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

function isWindowOpen(timestamp: string | null) {
    if (!timestamp) return false;
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return false;
    const age = Date.now() - time;
    return age >= 0 && age <= WHATSAPP_WINDOW_MS;
}

function normalizePhone(value: string | null | undefined) {
    return value?.replace(/\D/g, "") ?? "";
}

function formatPhone(value: string | null) {
    if (!value) return "—";
    const digits = value.replace(/\D/g, "");
    const local = digits.startsWith("55") ? digits.slice(2) : digits;

    if (local.length === 11) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }
    if (local.length === 10) {
        return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    }
    return value;
}

function formatDateTime(value: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";

    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
    }).format(date);
}

function normalize(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
}
