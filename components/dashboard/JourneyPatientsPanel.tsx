// components/dashboard/JourneyPatientsPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { openClientProfile } from "@/components/clientes/PermanentClientProfilePanel";
import { DetailsSidePanel } from "@/components/ui/DetailsSidePanel";
import Pagination from "@/components/ui/Pagination";
import Skeleton from "@/components/ui/Skeleton";

export type JourneyPatientSelection = {
    group: string;
    stage: string;
    label: string;
    procedureKey?: string;
    eventKind?: string;
    sections?: Array<{ label: string; eventKind: string }>;
};

type PatientPage = {
    total: number;
    patients: Array<{ id: string; name: string | null; phone: string | null }>;
    unlinked_profiles: number;
};

export default function JourneyPatientsPanel({ selection, query, onClose }: {
    selection: JourneyPatientSelection;
    query: string;
    onClose: () => void;
}) {
    return <DetailsSidePanel open title="Pacientes" onClose={onClose}>
        {selection.sections ? <div className="space-y-6">
            {selection.sections.map(section => <details key={section.eventKind} aria-label={section.label}>
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">{section.label}</summary>
                <div className="mt-3"><JourneyPatientList selection={{ ...selection, eventKind: section.eventKind }} query={query} onClose={onClose} /></div>
            </details>)}
        </div> : <>
            <p className="mb-4 text-sm font-semibold text-slate-600">{selection.label}</p>
            <JourneyPatientList selection={selection} query={query} onClose={onClose} />
        </>}
    </DetailsSidePanel>;
}

function JourneyPatientList({ selection, query, onClose }: {
    selection: JourneyPatientSelection;
    query: string;
    onClose: () => void;
}) {
    const [page, setPage] = useState(1);
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState<{ key: string; data?: PatientPage; error?: string } | null>(null);
    const params = new URLSearchParams(query);
    params.set("group", selection.group);
    params.set("stage", selection.stage);
    params.set("page", String(page));
    if (selection.procedureKey) params.set("procedure_key", selection.procedureKey);
    if (selection.eventKind) params.set("event_kind", selection.eventKind);
    const requestQuery = params.toString();
    const requestKey = `${requestQuery}:${attempt}`;
    const current = result?.key === requestKey ? result : null;

    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch(`/api/dashboard/jornada/patients?${requestQuery}`, { signal: controller.signal });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os pacientes.");
                if (!controller.signal.aborted) setResult({ key: requestKey, data });
            } catch (error) {
                if (!controller.signal.aborted) setResult({ key: requestKey, error: error instanceof Error ? error.message : "Não foi possível carregar os pacientes." });
            }
        })();
        return () => controller.abort();
    }, [requestQuery, requestKey]);

    return <>
        {!current ? <Skeleton className="h-64 w-full" /> : current.error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {current.error}
                <button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-2 cursor-pointer underline">Tentar novamente</button>
            </div>
        ) : current.data ? <>
            {current.data.unlinked_profiles > 0 ? <p className="mb-3 text-xs text-slate-500">{current.data.unlinked_profiles.toLocaleString("pt-BR")} perfis do Instagram sem vínculo com um paciente no CRM.</p> : null}
            {current.data.patients.length ? <ul className="divide-y divide-slate-100">
                {current.data.patients.map(patient => <li key={patient.id}>
                    <a href={`/clientes?client_id=${encodeURIComponent(patient.id)}`}
                        onClick={event => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                            event.preventDefault();
                            onClose();
                            openClientProfile(patient.id);
                        }}
                        className="block rounded-xl px-3 py-3 transition-colors hover:bg-slate-50">
                        <span className="block text-sm font-semibold text-slate-900">{patient.name?.trim() || patient.phone || "Paciente sem nome"}</span>
                        {patient.phone ? <span className="mt-1 block text-xs text-slate-500">{patient.phone}</span> : null}
                    </a>
                </li>)}
            </ul> : <p className="py-10 text-center text-sm text-slate-500">Nenhum paciente encontrado.</p>}
            {current.data.total > 20 ? <div className="mt-5"><Pagination totalPages={Math.ceil(current.data.total / 20)} currentPage={page} onPageChange={setPage} activeTone="brand" /></div> : null}
        </> : null}
    </>;
}
