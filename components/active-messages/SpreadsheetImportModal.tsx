// components/active-messages/SpreadsheetImportModal.tsx
"use client";

import {
    AlertCircle,
    Check,
    Download,
    FileSpreadsheet,
    LoaderCircle,
    Trash2,
    UploadCloud,
} from "lucide-react";
import {
    type ChangeEvent,
    type DragEvent,
    useMemo,
    useRef,
    useState,
} from "react";

import { Modal } from "@/components/ui/Modal";
import {
    getActiveMessageTemplateCategoryLabel,
    getActiveMessageTemplatePriceBrl,
    type ActiveMessageTemplateCategory,
} from "@/lib/active-messages/templates";
import type { ActiveMessageClient } from "@/types/activeMessages";

const ACCEPTED_FILE_TYPES = ".csv,text/csv,application/csv";
const MODEL_SPREADSHEET_PATH = "/modelos/mensagem-ativa-clientes.csv";

type ImportedPerson = {
    name: string | null;
    email: string | null;
    phone: string | null;
};

export type SpreadsheetImportNewClient = {
    name: string | null;
    email: string | null;
    phone: string;
};

type MatchMethod = "phone" | "email" | "name" | "similar_name";

type MatchedClient = {
    client: ActiveMessageClient;
    method: MatchMethod;
};

type AnalysisResult = {
    scannedCount: number;
    matchedClients: MatchedClient[];
    unmatchedCount: number;
    creatableClients: SpreadsheetImportNewClient[];
    fileNames: string[];
};

export type SpreadsheetImportSendPayload = {
    clientIds: string[];
    newClients: SpreadsheetImportNewClient[];
    fileNames: string[];
    scannedCount: number;
    matchedCount: number;
    openWindowCount: number;
    templateWindowCount: number;
};

type SpreadsheetImportModalProps = {
    open: boolean;
    clients: ActiveMessageClient[];
    templateName: string | null;
    templateReady: boolean;
    templateCategory: ActiveMessageTemplateCategory | null;
    sending: boolean;
    maxClients: number;
    onClose: () => void;
    onSend: (payload: SpreadsheetImportSendPayload) => Promise<boolean>;
};

export function SpreadsheetImportModal({
    open,
    clients,
    templateName,
    templateReady,
    templateCategory,
    sending,
    maxClients,
    onClose,
    onSend,
}: SpreadsheetImportModalProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [dragging, setDragging] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<AnalysisResult | null>(null);
    const [includeOpenWindow, setIncludeOpenWindow] = useState(true);
    const [includeTemplateWindow, setIncludeTemplateWindow] = useState(true);
    const [includeNewClients, setIncludeNewClients] = useState(true);

    const templateMessageCostBrl = templateCategory
        ? getActiveMessageTemplatePriceBrl(templateCategory)
        : null;

    const openWindowClients = useMemo(
        () =>
            result?.matchedClients.filter(
                ({ client }) => client.whatsapp_window_open,
            ) ?? [],
        [result],
    );
    const templateWindowClients = useMemo(
        () =>
            result?.matchedClients.filter(
                ({ client }) => !client.whatsapp_window_open,
            ) ?? [],
        [result],
    );

    const newClients = result?.creatableClients ?? [];

    const selectedClientIds = useMemo(() => {
        const ids = new Set<string>();

        if (includeOpenWindow) {
            for (const item of openWindowClients) ids.add(item.client.id);
        }
        if (includeTemplateWindow) {
            for (const item of templateWindowClients) ids.add(item.client.id);
        }

        return [...ids];
    }, [
        includeOpenWindow,
        includeTemplateWindow,
        openWindowClients,
        templateWindowClients,
    ]);

    const selectedTemplateCount = includeTemplateWindow
        ? templateWindowClients.length
        : 0;
    const selectedNewClientCount = includeNewClients ? newClients.length : 0;
    const selectedTargetCount =
        selectedClientIds.length + selectedNewClientCount;
    const estimatedCost =
        templateMessageCostBrl === null
            ? null
            : (selectedTemplateCount + selectedNewClientCount) *
              templateMessageCostBrl;

    function reset() {
        setFiles([]);
        setDragging(false);
        setAnalyzing(false);
        setError(null);
        setResult(null);
        setIncludeOpenWindow(true);
        setIncludeTemplateWindow(true);
        setIncludeNewClients(true);
    }

    function addFiles(nextFiles: File[]) {
        const accepted = nextFiles.filter((file) =>
            file.name.toLocaleLowerCase("pt-BR").endsWith(".csv"),
        );

        if (accepted.length !== nextFiles.length) {
            setError("Use planilhas CSV, como o arquivo de exemplo.");
        } else {
            setError(null);
        }

        setFiles((current) => {
            const known = new Set(
                current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
            );
            const merged = [...current];

            for (const file of accepted) {
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                if (!known.has(key)) {
                    merged.push(file);
                    known.add(key);
                }
            }

            return merged;
        });
        setResult(null);
    }

    function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
        addFiles(Array.from(event.target.files ?? []));
        event.target.value = "";
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
    }

    async function analyzeFiles() {
        if (files.length === 0 || analyzing) return;

        setAnalyzing(true);
        setError(null);

        try {
            const imported = (
                await Promise.all(
                    files.map(async (file) =>
                        parseSpreadsheet(file.name, await file.text()),
                    ),
                )
            ).flat();

            if (imported.length === 0) {
                throw new Error(
                    "Nenhum usuário válido foi encontrado. Confira as colunas Nome, Email e Telefone.",
                );
            }

            const analysis = matchImportedPeople({ imported, clients });
            setResult({
                ...analysis,
                fileNames: files.map((file) => file.name),
            });
            setIncludeOpenWindow(true);
            setIncludeTemplateWindow(true);
            setIncludeNewClients(true);
        } catch (caught) {
            setResult(null);
            setError(
                caught instanceof Error
                    ? caught.message
                    : "Não foi possível analisar as planilhas.",
            );
        } finally {
            setAnalyzing(false);
        }
    }

    async function handleSend() {
        if (!result || selectedTargetCount === 0 || sending) return;

        const sent = await onSend({
            clientIds: selectedClientIds,
            newClients: includeNewClients ? newClients : [],
            fileNames: result.fileNames,
            scannedCount: result.scannedCount,
            matchedCount: result.matchedClients.length,
            openWindowCount: includeOpenWindow ? openWindowClients.length : 0,
            templateWindowCount: includeTemplateWindow
                ? templateWindowClients.length
                : 0,
        });

        if (!sent) {
            setError(
                "Não foi possível concluir o envio. Verifique o aviso da página e tente novamente.",
            );
        }
    }

    const selectionTooLarge = selectedTargetCount > maxClients;

    return (
        <Modal
            open={open}
            onClose={onClose}
            onExitComplete={reset}
            width={820}
            height="auto"
            maxHeight="calc(100vh - 48px)"
            closeOnOverlayClick={!sending && !analyzing}
            closeOnEscape={!sending && !analyzing}
            showCloseButton={!sending && !analyzing}
            ariaLabelledBy="spreadsheet-import-title"
        >
            <div className="min-h-0 overflow-y-auto p-4 sm:p-7">
                <div className="flex flex-col gap-4 pr-10 sm:flex-row sm:items-start sm:justify-between sm:gap-5 sm:pr-12">
                    <div className="flex min-w-0 items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-green-soft text-green">
                            <FileSpreadsheet size={23} />
                        </div>
                        <div className="min-w-0">
                            <h2
                                id="spreadsheet-import-title"
                                className="text-xl font-bold text-slate-950"
                            >
                                Importar destinatários
                            </h2>
                            <p className="mt-1 text-sm leading-relaxed text-slate-500">
                                Encontre clientes do Hub usando telefone, e-mail e nome.
                            </p>
                        </div>
                    </div>

                    <a
                        href={MODEL_SPREADSHEET_PATH}
                        download="modelo-mensagem-ativa.csv"
                        className="flex h-10 w-fit shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-600 transition hover:border-brand/30 hover:bg-brand-soft hover:text-brand"
                    >
                        <Download size={15} />
                        Baixar modelo
                    </a>
                </div>

                {!result ? (
                    <>
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => inputRef.current?.click()}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    inputRef.current?.click();
                                }
                            }}
                            onDragEnter={(event) => {
                                event.preventDefault();
                                setDragging(true);
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDragLeave={(event) => {
                                if (event.currentTarget === event.target) {
                                    setDragging(false);
                                }
                            }}
                            onDrop={handleDrop}
                            className={`mt-6 flex min-h-[190px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center transition ${
                                dragging
                                    ? "border-brand bg-brand-soft/70"
                                    : "border-slate-200 bg-slate-50 hover:border-brand/35 hover:bg-brand-soft/30"
                            }`}
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand shadow-sm">
                                <UploadCloud size={23} />
                            </div>
                            <div className="mt-4 text-sm font-bold text-slate-700">
                                Arraste as planilhas aqui ou clique para selecionar
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                                Aceita vários arquivos CSV no formato do modelo
                            </div>
                            <input
                                ref={inputRef}
                                type="file"
                                multiple
                                accept={ACCEPTED_FILE_TYPES}
                                onChange={handleFileInput}
                                className="hidden"
                            />
                        </div>

                        {files.length > 0 ? (
                            <div className="mt-4 space-y-2">
                                {files.map((file) => (
                                    <div
                                        key={`${file.name}:${file.size}:${file.lastModified}`}
                                        className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3"
                                    >
                                        <FileSpreadsheet
                                            size={17}
                                            className="shrink-0 text-green"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div
                                                title={file.name}
                                                className="truncate text-sm font-semibold text-slate-700"
                                            >
                                                {file.name}
                                            </div>
                                            <div className="mt-0.5 text-xs text-slate-400">
                                                {formatFileSize(file.size)}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            title={`Remover ${file.name}`}
                                            onClick={() => {
                                                setFiles((current) =>
                                                    current.filter(
                                                        (item) => item !== file,
                                                    ),
                                                );
                                                setResult(null);
                                            }}
                                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-soft hover:text-red"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </>
                ) : (
                    <ImportResults
                        result={result}
                        openWindowCount={openWindowClients.length}
                        templateWindowCount={templateWindowClients.length}
                        includeOpenWindow={includeOpenWindow}
                        includeTemplateWindow={includeTemplateWindow}
                        templateCategory={templateCategory}
                        templateMessageCostBrl={templateMessageCostBrl}
                        onToggleOpen={() =>
                            setIncludeOpenWindow((current) => !current)
                        }
                        includeNewClients={includeNewClients}
                        newClientCount={newClients.length}
                        onToggleTemplate={() =>
                            setIncludeTemplateWindow((current) => !current)
                        }
                        onToggleNewClients={() =>
                            setIncludeNewClients((current) => !current)
                        }
                    />
                )}

                {error ? (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-semibold text-red">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        {error}
                    </div>
                ) : null}

                {result && !templateReady ? (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-orange/20 bg-orange-soft px-4 py-3 text-sm font-semibold text-orange">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        Selecione o template e preencha os campos obrigatórios antes de enviar.
                    </div>
                ) : null}

                {selectionTooLarge ? (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-sm font-semibold text-red">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        O limite é de {maxClients} clientes por envio. Desmarque um dos grupos ou divida o envio.
                    </div>
                ) : null}

                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                    <div className="text-xs leading-relaxed text-slate-400">
                        {result ? (
                            <>
                                Template: <strong>{templateName ?? "não selecionado"}</strong>
                                <br />
                                Categoria: <strong>{formatTemplateCategory(templateCategory)}</strong>
                                {templateMessageCostBrl !== null ? (
                                    <>
                                        {" · "}Tarifa Meta: <strong>{formatUnitPrice(templateMessageCostBrl)}</strong>
                                    </>
                                ) : null}
                                <br />
                                Custo selecionado: <strong>{formatEstimatedCost(estimatedCost)}</strong>
                            </>
                        ) : (
                            "Os arquivos são processados somente no navegador."
                        )}
                    </div>

                    <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
                        {result ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setResult(null);
                                    setError(null);
                                }}
                                disabled={sending}
                                className="h-11 cursor-pointer rounded-xl px-5 text-sm font-bold text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Trocar arquivos
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={analyzing}
                                className="h-11 cursor-pointer rounded-xl px-5 text-sm font-bold text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() =>
                                result ? void handleSend() : void analyzeFiles()
                            }
                            disabled={
                                result
                                    ? sending ||
                                      selectedTargetCount === 0 ||
                                      selectionTooLarge ||
                                      !templateReady
                                    : analyzing || files.length === 0
                            }
                            className="flex h-11 min-w-[170px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                        >
                            {analyzing || sending ? (
                                <LoaderCircle size={17} className="animate-spin" />
                            ) : result ? (
                                <Check size={17} />
                            ) : (
                                <FileSpreadsheet size={17} />
                            )}
                            {analyzing
                                ? "Analisando..."
                                : sending
                                  ? "Enviando..."
                                  : result
                                    ? `Enviar ${selectedTargetCount} clientes`
                                    : "Analisar planilhas"}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function ImportResults({
    result,
    openWindowCount,
    templateWindowCount,
    includeOpenWindow,
    includeTemplateWindow,
    includeNewClients,
    newClientCount,
    templateCategory,
    templateMessageCostBrl,
    onToggleOpen,
    onToggleTemplate,
    onToggleNewClients,
}: {
    result: AnalysisResult;
    openWindowCount: number;
    templateWindowCount: number;
    includeOpenWindow: boolean;
    includeTemplateWindow: boolean;
    includeNewClients: boolean;
    newClientCount: number;
    templateCategory: ActiveMessageTemplateCategory | null;
    templateMessageCostBrl: number | null;
    onToggleOpen: () => void;
    onToggleTemplate: () => void;
    onToggleNewClients: () => void;
}) {
    const fullEstimatedCost =
        templateMessageCostBrl === null
            ? null
            : templateWindowCount * templateMessageCostBrl;
    const newClientsEstimatedCost =
        templateMessageCostBrl === null
            ? null
            : newClientCount * templateMessageCostBrl;

    return (
        <div className="mt-6">
            <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="Usuários lidos" value={result.scannedCount} />
                <SummaryCard
                    label="Sincronizados com Hub"
                    value={result.matchedClients.length}
                    tone="green"
                />
                <SummaryCard
                    label="Não encontrados"
                    value={result.unmatchedCount}
                    tone={result.unmatchedCount > 0 ? "orange" : "neutral"}
                />
            </div>

            <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
                <div className="min-w-[600px]">
                    <div className="grid grid-cols-[minmax(180px,1fr)_110px_130px_110px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        <div>Métrica</div>
                        <div className="text-right">Total</div>
                        <div className="text-right">Dentro das 24h</div>
                        <div className="text-right">Fora</div>
                    </div>
                    <SummaryRow
                        label="Usuários lidos"
                        total={result.scannedCount}
                        open={null}
                        outside={null}
                    />
                    <SummaryRow
                        label="Sincronizados com Hub"
                        total={result.matchedClients.length}
                        open={openWindowCount}
                        outside={templateWindowCount}
                    />
                </div>
            </div>

            <div className="mt-5">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                    Grupos do envio
                </div>
                <div className="mb-2 hidden grid-cols-[22px_minmax(0,1fr)_90px_130px] gap-3 px-4 sm:grid text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <span />
                    <span>Grupo</span>
                    <span className="text-right">Clientes</span>
                    <span className="text-right">Custo</span>
                </div>
                <div className="space-y-2">
                    <SelectableGroup
                        checked={includeOpenWindow}
                        disabled={openWindowCount === 0}
                        label="Dentro das 24h"
                        description="Mensagem normal pelo fluxo atual"
                        count={openWindowCount}
                        cost={0}
                        onToggle={onToggleOpen}
                    />
                    <SelectableGroup
                        checked={includeTemplateWindow}
                        disabled={templateWindowCount === 0}
                        neutralSelection
                        label="Fora da janela"
                        description={`Template aprovado · ${formatTemplateCategory(templateCategory)}`}
                        count={templateWindowCount}
                        cost={fullEstimatedCost}
                        onToggle={onToggleTemplate}
                    />
                    <SelectableGroup
                        checked={includeNewClients}
                        disabled={newClientCount === 0}
                        neutralSelection
                        label="Criar novos clientes"
                        description="Criar no Hub e enviar por template aprovado"
                        count={newClientCount}
                        cost={newClientsEstimatedCost}
                        onToggle={onToggleNewClients}
                    />
                </div>
            </div>
        </div>
    );
}

function SummaryCard({
    label,
    value,
    tone = "neutral",
}: {
    label: string;
    value: number;
    tone?: "neutral" | "green" | "orange";
}) {
    const classes = {
        neutral: "border-slate-200 bg-white text-slate-950",
        green: "border-green/15 bg-green-soft text-green",
        orange: "border-orange/15 bg-orange-soft text-orange",
    }[tone];

    return (
        <div className={`rounded-xl border p-4 ${classes}`}>
            <div className="text-2xl font-bold">{formatInteger(value)}</div>
            <div className="mt-1 text-xs font-semibold">{label}</div>
        </div>
    );
}

function SummaryRow({
    label,
    total,
    open,
    outside,
}: {
    label: string;
    total: number;
    open: number | null;
    outside: number | null;
}) {
    return (
        <div className="grid grid-cols-[minmax(180px,1fr)_110px_130px_110px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
            <div className="font-semibold text-slate-700">{label}</div>
            <div className="text-right font-bold text-slate-700">
                {formatInteger(total)}
            </div>
            <div className="text-right font-bold text-green">
                {open === null ? "—" : formatInteger(open)}
            </div>
            <div className="text-right font-bold text-purple">
                {outside === null ? "—" : formatInteger(outside)}
            </div>
        </div>
    );
}

function SelectableGroup({
    checked,
    disabled,
    neutralSelection = false,
    label,
    description,
    count,
    cost,
    onToggle,
}: {
    checked: boolean;
    disabled: boolean;
    neutralSelection?: boolean;
    label: string;
    description: string;
    count: number;
    cost: number | null;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onToggle}
            className={`grid w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-3 rounded-xl border px-4 py-3 sm:grid-cols-[22px_minmax(0,1fr)_90px_130px] text-left transition ${
                disabled
                    ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-50"
                    : checked
                      ? neutralSelection
                          ? "cursor-pointer border-slate-200 bg-slate-50"
                          : "cursor-pointer border-brand/25 bg-brand-soft/35"
                      : "cursor-pointer border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
        >
            <span
                className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                    checked
                        ? "border-brand bg-brand text-white"
                        : "border-slate-300 bg-white text-transparent"
                }`}
            >
                <Check size={13} />
            </span>
            <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-700">
                    {label}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-400">
                    {description}
                </span>
            </span>
            <span className="col-start-2 text-left text-xs font-bold text-slate-500 sm:col-start-auto sm:text-right sm:text-sm sm:text-slate-700">
                <span className="sm:hidden">{formatInteger(count)} clientes · </span><span className="hidden sm:inline">{formatInteger(count)}</span>
            </span>
            <span className="col-start-2 -mt-3 text-left text-xs font-bold text-slate-700 sm:col-start-auto sm:mt-0 sm:text-right sm:text-sm">
                {formatEstimatedCost(cost)}
            </span>
        </button>
    );
}

function parseSpreadsheet(fileName: string, rawText: string): ImportedPerson[] {
    const text = rawText.replace(/^\uFEFF/, "");
    const delimiter = detectDelimiter(text);
    const rows = parseDelimitedText(text, delimiter).filter((row) =>
        row.some((cell) => cell.trim()),
    );

    if (rows.length < 2) return [];

    const header = rows[0].map(normalizeHeader);
    const indices = {
        name: findHeaderIndex(header, ["nome", "name", "paciente", "cliente"]),
        email: findHeaderIndex(header, ["email", "e mail"]),
        phone: findHeaderIndex(header, [
            "telefone",
            "celular",
            "whatsapp",
            "phone",
            "fone",
        ]),
    };

    const hasRecognizedIdentifier =
        indices.name >= 0 || indices.email >= 0 || indices.phone >= 0;

    if (!hasRecognizedIdentifier) {
        throw new Error(
            `${fileName}: não encontrei as colunas Nome, Email ou Telefone.`,
        );
    }

    return rows.slice(1).flatMap((row) => {
        const person: ImportedPerson = {
            name: readCell(row, indices.name),
            email: readCell(row, indices.email),
            phone: readCell(row, indices.phone),
        };

        return person.name || person.email || person.phone ? [person] : [];
    });
}

function matchImportedPeople({
    imported,
    clients,
}: {
    imported: ImportedPerson[];
    clients: ActiveMessageClient[];
}): Omit<AnalysisResult, "fileNames"> {
    const phoneIndex = buildUniqueIndex(clients, (client) =>
        phoneVariants(client.phone),
    );
    const emailIndex = buildUniqueIndex(clients, (client) => {
        const email = normalizeEmail(client.email);
        return email ? [email] : [];
    });
    const nameIndex = buildUniqueIndex(clients, (client) =>
        nameVariants(client.name),
    );
    const nameEntries = clients.flatMap((client) => {
        const normalized = normalizeName(client.name);
        return normalized ? [{ client, normalized }] : [];
    });

    const matchedByClientId = new Map<string, MatchedClient>();
    const unmatchedPeople: ImportedPerson[] = [];

    for (const person of imported) {
        const matched = findClientMatch({
            person,
            phoneIndex,
            emailIndex,
            nameIndex,
            nameEntries,
        });

        if (!matched) {
            unmatchedPeople.push(person);
            continue;
        }

        const current = matchedByClientId.get(matched.client.id);
        if (!current || matchPriority(matched.method) < matchPriority(current.method)) {
            matchedByClientId.set(matched.client.id, matched);
        }
    }

    const creatableByPhone = new Map<string, SpreadsheetImportNewClient>();

    for (const person of unmatchedPeople) {
        const phone = normalizePhoneIdentityForImport(person.phone);
        if (!phone || creatableByPhone.has(phone)) continue;

        creatableByPhone.set(phone, {
            name: cleanImportedValue(person.name),
            email: normalizeEmail(person.email) || null,
            phone,
        });
    }

    return {
        scannedCount: imported.length,
        matchedClients: [...matchedByClientId.values()],
        unmatchedCount: unmatchedPeople.length,
        creatableClients: [...creatableByPhone.values()],
    };
}

function findClientMatch({
    person,
    phoneIndex,
    emailIndex,
    nameIndex,
    nameEntries,
}: {
    person: ImportedPerson;
    phoneIndex: Map<string, ActiveMessageClient | null>;
    emailIndex: Map<string, ActiveMessageClient | null>;
    nameIndex: Map<string, ActiveMessageClient | null>;
    nameEntries: Array<{ client: ActiveMessageClient; normalized: string }>;
}): MatchedClient | null {
    for (const phone of phoneVariants(person.phone)) {
        const client = phoneIndex.get(phone);
        if (client) return { client, method: "phone" };
    }

    const email = normalizeEmail(person.email);
    if (email) {
        const client = emailIndex.get(email);
        if (client) return { client, method: "email" };
    }

    const name = normalizeName(person.name);
    if (!name) return null;

    for (const variant of nameVariants(person.name)) {
        const exactNameClient = nameIndex.get(variant);
        if (exactNameClient) {
            return { client: exactNameClient, method: "name" };
        }
    }

    const similarNameClient = findUniqueSimilarName(name, nameEntries);
    return similarNameClient
        ? { client: similarNameClient, method: "similar_name" }
        : null;
}

function buildUniqueIndex(
    clients: ActiveMessageClient[],
    getKeys: (client: ActiveMessageClient) => string[],
) {
    const index = new Map<string, ActiveMessageClient | null>();

    for (const client of clients) {
        for (const key of getKeys(client)) {
            if (!key) continue;
            if (index.has(key) && index.get(key)?.id !== client.id) {
                index.set(key, null);
            } else if (!index.has(key)) {
                index.set(key, client);
            }
        }
    }

    return index;
}

function findUniqueSimilarName(
    importedName: string,
    entries: Array<{ client: ActiveMessageClient; normalized: string }>,
) {
    const importedTokens = importedName.split(" ").filter(Boolean);
    if (importedTokens.length < 2 || importedName.length < 8) return null;

    const first = importedTokens[0];
    const last = importedTokens[importedTokens.length - 1];
    let best: { client: ActiveMessageClient; score: number } | null = null;
    let secondScore = 0;

    for (const entry of entries) {
        const tokens = entry.normalized.split(" ").filter(Boolean);
        if (!tokens.includes(first) && !tokens.includes(last)) continue;

        const score = nameSimilarity(importedName, entry.normalized);
        if (!best || score > best.score) {
            secondScore = best?.score ?? secondScore;
            best = { client: entry.client, score };
        } else if (score > secondScore) {
            secondScore = score;
        }
    }

    if (!best || best.score < 0.93 || best.score - secondScore < 0.04) {
        return null;
    }

    return best.client;
}

function nameSimilarity(first: string, second: string) {
    const maxLength = Math.max(first.length, second.length);
    const editScore =
        maxLength === 0 ? 1 : 1 - levenshteinDistance(first, second) / maxLength;
    const firstTokens = new Set(first.split(" ").filter(Boolean));
    const secondTokens = new Set(second.split(" ").filter(Boolean));
    const intersection = [...firstTokens].filter((token) =>
        secondTokens.has(token),
    ).length;
    const union = new Set([...firstTokens, ...secondTokens]).size;
    const tokenScore = union === 0 ? 1 : intersection / union;

    return editScore * 0.75 + tokenScore * 0.25;
}

function levenshteinDistance(first: string, second: string) {
    const previous = Array.from({ length: second.length + 1 }, (_, index) => index);

    for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
        const current = [firstIndex];

        for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
            current[secondIndex] = Math.min(
                current[secondIndex - 1] + 1,
                previous[secondIndex] + 1,
                previous[secondIndex - 1] +
                    (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1),
            );
        }

        for (let index = 0; index < current.length; index += 1) {
            previous[index] = current[index];
        }
    }

    return previous[second.length];
}

function parseDelimitedText(text: string, delimiter: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (quoted) {
            if (character === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else {
                    quoted = false;
                }
            } else {
                field += character;
            }
            continue;
        }

        if (character === '"') {
            quoted = true;
        } else if (character === delimiter) {
            row.push(field);
            field = "";
        } else if (character === "\n") {
            row.push(field.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += character;
        }
    }

    if (field || row.length > 0) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
    }

    return rows;
}

function detectDelimiter(text: string) {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const candidates = [";", ",", "\t"];
    let selected = ";";
    let selectedCount = -1;

    for (const candidate of candidates) {
        const count = countDelimiter(firstLine, candidate);
        if (count > selectedCount) {
            selected = candidate;
            selectedCount = count;
        }
    }

    return selected;
}

function countDelimiter(line: string, delimiter: string) {
    let quoted = false;
    let count = 0;

    for (let index = 0; index < line.length; index += 1) {
        if (line[index] === '"') {
            if (quoted && line[index + 1] === '"') {
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (!quoted && line[index] === delimiter) {
            count += 1;
        }
    }

    return count;
}

function findHeaderIndex(headers: string[], candidates: string[]) {
    return headers.findIndex((header) => candidates.includes(header));
}

function readCell(row: string[], index: number) {
    if (index < 0) return null;
    const value = row[index]?.trim();
    return value || null;
}

const NAME_TITLES = new Set([
    "dr",
    "dra",
    "sr",
    "sra",
    "senhor",
    "senhora",
]);
const NAME_PARTICLES = new Set(["da", "das", "de", "do", "dos", "e"]);

function normalizeHeader(value: string) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeName(value: string | null | undefined) {
    const normalized = normalizeText(value)
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    if (!normalized) return "";

    const tokens = normalized
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !NAME_TITLES.has(token));
    const withoutParticles = tokens.filter(
        (token) => !NAME_PARTICLES.has(token),
    );

    return (withoutParticles.length >= 2 ? withoutParticles : tokens).join(" ");
}

function nameVariants(value: string | null | undefined) {
    const normalized = normalizeName(value);
    if (!normalized) return [];

    const tokens = normalized.split(" ").filter(Boolean);
    const sorted =
        tokens.length > 1
            ? [...tokens].sort((first, second) =>
                  first.localeCompare(second, "pt-BR"),
              ).join(" ")
            : normalized;

    return [...new Set([normalized, sorted])];
}

function cleanImportedValue(value: string | null | undefined) {
    const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
    return cleaned || null;
}

function normalizeEmail(value: string | null | undefined) {
    return value?.trim().toLocaleLowerCase("pt-BR") ?? "";
}

function normalizeText(value: string | null | undefined) {
    return (value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR");
}

function normalizePhoneIdentityForImport(
    value: string | null | undefined,
) {
    if (!value) return null;
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (!digits) return null;
    if (
        digits.startsWith("55") &&
        (digits.length === 12 || digits.length === 13)
    ) {
        return digits;
    }
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

function phoneVariants(value: string | null | undefined) {
    const digits = value?.replace(/\D/g, "") ?? "";
    if (!digits) return [];

    const variants = new Set<string>([digits]);
    const local = digits.startsWith("55") && digits.length >= 12
        ? digits.slice(2)
        : digits;

    variants.add(local);
    if (local.length >= 10) variants.add(local.slice(-11));
    if (local.length >= 10) variants.add(local.slice(-10));

    return [...variants].filter((item) => item.length >= 10);
}

function matchPriority(method: MatchMethod) {
    return {
        phone: 0,
        email: 1,
        name: 2,
        similar_name: 3,
    }[method];
}

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatInteger(value: number) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function formatTemplateCategory(
    category: ActiveMessageTemplateCategory | null,
) {
    return category
        ? getActiveMessageTemplateCategoryLabel(category)
        : "não selecionada";
}

function formatUnitPrice(value: number) {
    return `${new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    }).format(value)} por template`;
}

function formatEstimatedCost(value: number | null) {
    if (value === null) return "—";
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}
