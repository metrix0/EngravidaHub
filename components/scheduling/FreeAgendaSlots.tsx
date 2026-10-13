// components/scheduling/FreeAgendaSlots.tsx
"use client";
import Card from "@/components/ui/Card";
import { formatDoctorName } from "@/lib/scheduling/formatDoctorName";
import type { AgendaFreeSlot, OperationalAgendaReport } from "@/lib/scheduling/operationalAgenda";
import { percent } from "./AgendaIndicators";
const time = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
export default function FreeAgendaSlots({ report, onSelect }: { report: OperationalAgendaReport; onSelect: (slot: AgendaFreeSlot) => void }) {
    const doctors = report.byDoctor.filter(row => row.available > 0);
    return <div className="min-h-0 flex-1 overflow-y-auto pb-3"><p className="mb-3 text-sm text-muted">Priorize médicos com menor ocupação para equilibrar a agenda. As vagas brutas incluem horários ocupados e bloqueados; os horários abaixo estão livres.</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{doctors.map(doctor => <Card key={`${doctor.unitId}:${doctor.doctorId}`} className="!p-4">
            <h3 className="font-bold">{formatDoctorName(doctor.doctorName)}</h3><p className="mt-1 text-xs text-muted">{doctor.unitName}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-md bg-green-soft px-2 py-1 text-green">{doctor.available} livres</span><span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{doctor.total} vagas brutas</span><span className="rounded-md bg-blue-soft px-2 py-1 text-blue">{percent(doctor.occupancy)} ocupação</span></div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{report.slots.filter(slot => slot.unitId === doctor.unitId && slot.doctorId === doctor.doctorId).map(slot => <button key={slot.id} type="button" onClick={() => onSelect(slot)} className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-2.5 text-left text-sm hover:bg-selection"><span>{slot.date.split("-").reverse().join("/")}</span><span className="font-semibold">{time(slot.startsAt)} – {time(slot.endsAt)}</span></button>)}</div>
        </Card>)}</div>{!doctors.length ? <p className="py-16 text-center text-sm text-muted">Nenhum horário livre neste período.</p> : null}
    </div>;
}
