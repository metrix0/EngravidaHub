// app/dev/map/page.tsx
import { ChevronDown } from "lucide-react";

import Card from "@/components/ui/Card";
import TrackingMap from "./TrackingMap";
import { cronSteps, sections, type NodeId } from "./trackingMapData";

const vercelCrons = [
    ["*/10 * * * *", "A cada 10 min", "/api/finalize-inactive-inbox", "Finaliza threads inativas e mensagens legadas."],
    ["20 */3 * * *", "A cada 3h, minuto 20", "/api/analyze?inactivity_hours=16&limit=250", "WhatsApp: análise batch."],
    ["40 */3 * * *", "A cada 3h, minuto 40", "/api/analyze?inactivity_hours=16&limit=250&platform=instagram", "Instagram: análise batch."],
    ["0 3 * * *", "00:00", "/api/analyze?inactivity_hours=16&limit=100&platform=messenger", "Messenger: análise batch."],
    ["5 10,11,13,15,17,19,21 * * *", "07:05, 08:05, 10:05, 12:05, 14:05, 16:05, 18:05", "/api/clinisys/bigquery?daysBack=30&limit=9999", "Agendas 30 dias + retry Meta."],
    ["0 3 * * 1", "Segunda 00:00", "/api/clinisys/bigquery?daysBack=120&limit=9999", "Agendas 120 dias + retry Meta."],
    ["5 11,13,15,17,19,21 * * *", "08:05, 10:05, 12:05, 14:05, 16:05, 18:05", "/api/clinisys/invoices?daysBack=30&limit=25000", "NF-e 30 dias."],
    ["0 3,9,15,21 * * *", "00:00, 06:00, 12:00, 18:00", "/api/ads/finance?platform=meta_ads&daysBack=7", "Métricas Meta 7 dias."],
    ["10 3,9,15,21 * * *", "00:10, 06:10, 12:10, 18:10", "/api/ads/finance?platform=google_ads&daysBack=7", "Métricas Google 7 dias."],
    ["*/5 * * * *", "A cada 5 min", "/api/clinisys/availability", "Disponibilidade de agendas."],
    ["*/5 * * * *", "A cada 5 min", "/api/cron/resolve-booking-teams", "Resolve equipe de agendamento."],
    ["0 14-17 * * *", "11:00–14:00, de hora em hora", "/api/mensagem-ativa-cadence", "Cadência de mensagens ativas."],
    ["0 11-15 * * *", "08:00–12:00, de hora em hora", "/api/resgate?n=50", "Resgate de vagas."],
    ["0 9 * * *", "06:00", "/api/cron/refresh-word-map", "Atualiza mapa de palavras."],
    ["0 15 * * 0", "Domingo 12:00", "/api/cron/unit-analyses?action=submit&type=weekly", "Submete análises semanais de unidades."],
    ["0 5,7,9,11,13,15,17,19 * * 0-1", "Dom/seg 02h–16h, a cada 2h", "/api/cron/unit-analyses?action=collect&type=weekly", "Coleta análises semanais."],
];
const dbCrons = [
    ["14 6 * * *", "03:14", "jornada-prepared-refresh", "dashboard_journey_refresh_all_v1()"],
    ["19,24,29,34,39,44,49,54,59 6 * * *", "03:19–03:59, a cada 5 min", "jornada-prepared-facts-refresh", "Atualiza fatos se houver trabalho ou fatos anteriores à conclusão."],
    ["*/10 * * * *", "A cada 10 min", "saude-health-watchdog", "Monitor de saúde (fora da atribuição)."],
];



const checks: ReadonlyArray<readonly [symptom: string, check: string, step: NodeId]> = [
    ["WhatsApp sem origem", "conversations.origin → tintim_attribution_events (±2 dias) → clients.tracking_updated_at e UTMs", "paidJourney"],
    ["Instagram sem anúncio", "messages → conversation_ad_attributions.meta_ad_id / enrichment_status → instagram_users.client_id", "referral"],
    ["Túnel ausente", "Planilha → referral → UTMs anteriores à conversa → conversation_analysis → effective_tunnel", "effectiveTunnel"],
    ["Conversão não enviada", "ad_events.status / parameters → dados de identidade / click ID → schedule_conversion_claims e deduplicação mensal", "delivery"],
    ["Receita ausente", "funnel_clinisys_events → clinisys_invoices.client_id / status → coorte e âncora da Jornada", "invoices"],
    ["ROI sem investimento", "ad_daily_metrics.currency_code / campaign_name / período → classificação do túnel", "roi"],
    ["Jornada desatualizada", "cron.job_run_details → dashboard_journey_refresh_all_v1 → dashboard_journey_refresh_facts_v1", "journey"],
];

const stepTitles = new Map(sections.flatMap(section => [...section.nodes].map(node => [node.id, node.title] as const)));

function CronTable({ rows }: { rows: string[][] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                    <tr>{["Cron (UTC)", "São Paulo (UTC−3)", "Rota / job", "Função"].map(label =>
                        <th key={label} className="px-3 py-3">{label}</th>,
                    )}</tr>
                </thead>
                <tbody>{rows.map(([schedule, local, route, purpose]) => {
                    const step = cronSteps.get(route.split("?")[0]);
                    return (
                        <tr key={route} className="border-t border-slate-100 align-top">
                            <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{schedule}</td>
                            <td className="px-3 py-3">{local}</td>
                            <td className="px-3 py-3 font-mono text-xs">{route}</td>
                            <td className="px-3 py-3">
                                {purpose}
                                {step && <a href={`#etapa-${step}`} className="mt-1 block text-xs font-semibold text-brand hover:underline">{stepTitles.get(step)} →</a>}
                            </td>
                        </tr>
                    );
                })}</tbody>
            </table>
        </div>
    );
}

export default function DevTrackingMapPage() {
    return (
        <main className="h-full overflow-y-auto bg-background px-4 py-5 text-slate-900 md:px-8 md:py-8">
            <div className="space-y-5 pb-8">
                <header className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Mapa de rastreamento</h1>
                        <p className="mt-1 text-sm text-slate-500">Da aquisição ao fechamento, envio de conversões e receita.</p>
                    </div>
                    <nav aria-label="Referências do mapa" className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                        <a href="#crons" className="rounded-lg border border-border bg-white px-3 py-2 hover:bg-slate-50">Crons</a>
                        <a href="#verificacao" className="rounded-lg border border-border bg-white px-3 py-2 hover:bg-slate-50">Verificações</a>
                    </nav>
                </header>
                <TrackingMap />
                <section id="crons" className="scroll-mt-5">
                    <Card>
                        <details open className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                                <h2 className="text-xl font-bold">Crons</h2>
                                <ChevronDown size={18} className="text-slate-500 group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <h3 className="mb-1 mt-5 text-base font-bold">Vercel</h3>
                            <p className="mb-3 text-sm text-slate-500">Horários declarados no repositório, com conversão para São Paulo.</p>
                            <CronTable rows={vercelCrons} />
                            <a href="https://github.com/metrix0/engravidahub/blob/preview/vercel.json" target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-brand hover:underline">vercel.json ↗</a>
                            <h3 className="mb-1 mt-6 text-base font-bold">Supabase · pg_cron</h3>
                            <p className="mb-3 text-sm text-slate-500">Registro dos jobs ativos consultados em 26/11/2026.</p>
                            <CronTable rows={dbCrons} />
                        </details>
                    </Card>
                </section>
                <section id="verificacao" className="scroll-mt-5">
                    <Card>
                        <h2 className="mb-4 text-xl font-bold">Pontos de verificação</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[600px] text-left text-sm">
                                <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                                    <tr><th className="p-3">Sintoma</th><th className="p-3">Verificar</th></tr>
                                </thead>
                                <tbody>{checks.map(([symptom, check, step]) => (
                                    <tr key={symptom} className="border-t border-slate-100">
                                        <td className="p-3 font-medium">
                                            <a href={`#etapa-${step}`} className="text-brand hover:underline">{symptom} →</a>
                                        </td>
                                        <td className="p-3 text-slate-600">{check}</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                    </Card>
                </section>
            </div>
        </main>
    );
}
