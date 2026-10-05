// app/inteligencia-agenda/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, Stethoscope } from "lucide-react";
import { useCurrentUser } from "@/components/auth/CurrentUserProvider";
import AgendaIntelligencePanel from "@/components/scheduling/AgendaIntelligencePanel";
import FilterButton from "@/components/ui/FilterButton";
import Skeleton from "@/components/ui/Skeleton";
import type { SchedulingDoctorOption, SchedulingUnitOption } from "@/types/scheduling";

export default function AgendaIntelligencePage() {
    const { currentUser } = useCurrentUser();
    const lockedUnitId = currentUser?.permission?.unit_lock?.id ?? null;
    const [unitIds, setUnitIds] = useState<string[]>([]);
    const [doctorIds, setDoctorIds] = useState<string[]>([]);
    const [units, setUnits] = useState<SchedulingUnitOption[]>([]);
    const [doctors, setDoctors] = useState<SchedulingDoctorOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [optionsError, setOptionsError] = useState<string | null>(null);
    const scopedUnitIds = useMemo(() => lockedUnitId ? [lockedUnitId] : unitIds, [lockedUnitId, unitIds]);
    const visibleDoctors = useMemo(() => [...new Map(doctors
        .filter(doctor => !scopedUnitIds.length || scopedUnitIds.includes(doctor.unit_id))
        .map(doctor => [doctor.id, doctor])).values()], [doctors, scopedUnitIds]);

    useEffect(() => {
        const controller = new AbortController();
        async function loadOptions() {
            try {
                const response = await fetch("/api/scheduling/options", { cache: "no-store", signal: controller.signal });
                const json = await response.json();
                if (!response.ok) throw new Error("Não foi possível carregar os filtros da agenda.");
                if (!controller.signal.aborted) {
                    setUnits(json.units ?? []);
                    setDoctors(json.doctors ?? []);
                }
            } catch (failure) {
                if (!controller.signal.aborted) setOptionsError(failure instanceof Error ? failure.message : "Não foi possível carregar os filtros da agenda.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadOptions();
        return () => controller.abort();
    }, []);

    return <main className="h-full overflow-y-auto bg-white px-3 py-5 text-slate-900 sm:px-5 md:px-7 md:py-7">
        {optionsError ? <p role="alert" className="mx-auto mb-4 max-w-[1500px] rounded-xl bg-red-soft p-3 text-sm text-red">{optionsError}</p> : null}
        <AgendaIntelligencePanel unitIds={scopedUnitIds} doctorIds={doctorIds} filters={loading ? <>
            <Skeleton className="h-11 w-[220px] rounded-xl" />
            <Skeleton className="h-11 w-[220px] rounded-xl" />
        </> : <>
            <FilterButton icon={<MapPin size={16} />} label="Todas as unidades"
                options={units.filter(unit => !lockedUnitId || unit.id === lockedUnitId).map(unit => ({ label: unit.name, value: unit.id }))}
                values={scopedUnitIds} onChange={values => { setUnitIds(values); setDoctorIds([]); }} disabled={Boolean(lockedUnitId)} />
            <FilterButton icon={<Stethoscope size={16} />} label="Todos os médicos"
                options={visibleDoctors.map(doctor => ({ label: doctor.name, value: doctor.id }))}
                values={doctorIds} onChange={setDoctorIds} />
        </>} />
    </main>;
}
