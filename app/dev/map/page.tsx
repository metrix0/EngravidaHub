// app/dev/map/page.tsx
import Card from "@/components/ui/Card";

const root = "https://github.com/metrix0/engravidahub/blob/preview/";

const sections = [
    { id: "entrada", title: "Entrada e identidade", nodes: [
        { title: "WhatsApp · Blip", input: "Mensagens e contatos", output: "clients · messages · thread", rules: ["Normaliza a identidade do contato e associa mensagens à thread.", "Webhook de mensagens usa claim atômico para evitar duplicação por entregas simultâneas.", "Mensagens antigas sem conversa são agrupadas pelo pipeline de análise."], sources: ["app/api/(webhooks)/blip/messages/route.ts", "lib/conversations/messagesToConversations.ts"] },
        { title: "Instagram / Messenger · Zernio", input: "Mensagem, participante, conta e referral", output: "instagram_users · messages · thread · conversation_ad_attributions", rules: ["persist_zernio_message registra a mensagem e a identidade social.", "Referral de anúncio fica associado à mensagem e thread, com meta_ad_id, campanha, conjunto e criativo.", "Enriquecimento consulta cache, Zernio e Meta Graph; pode preencher localização e reconciliar túnel.", "Vínculo instagram_users.client_id permite conectar o histórico social ao cliente WhatsApp/CliniSYS."], sources: ["app/api/(webhooks)/zernio/route.ts", "lib/zernio/conversationAdAttribution.ts", "lib/ads/finance/syncAdsFinance.ts"] },
        { title: "TinTim · WhatsApp", input: "Telefone + source + parâmetros do clique/visita", output: "clients · tintim_attribution_events", rules: ["Busca telefone normalizado (com/sem prefixo 55); cria cliente se não existir.", "Campos de tracking do cliente só são preenchidos quando vazios. tracking_updated_at muda quando há preenchimento.", "Cada evento é registrado mesmo se o perfil não mudar; fingerprint SHA-256 evita repetição.", "Timestamp vem de created/updated conforme o evento, com fallback para recebimento."], sources: ["app/api/(webhooks)/tintim/route.ts", "lib/tintim/attribution.ts"] },
    ] },
    { id: "utm", title: "UTM, cliques e origem", nodes: [
        { title: "Parâmetros de aquisição", input: "Payload TinTim ou visit.params", output: "clients + histórico JSON em tintim_attribution_events.tracking", rules: ["utm_source = fonte; utm_medium = meio; utm_campaign = campanha; utm_content = conteúdo; utm_term = termo.", "Google: gclid, gbraid, wbraid. Meta: fbclid, fbc, fbp, ctwa_clid (clique para WhatsApp).", "Histórico também guarda utm_id, campaign_id, adset_id, ad_id e account_id quando presentes.", "IP, user agent, estado e país podem ser preenchidos no cliente; fbp sozinho não determina mídia paga."], sources: ["lib/tintim/attribution.ts"] },
        { title: "Origem da conversa · planilha", input: "Google Sheets: Mensagem / Origem / Tunnel", output: "conversations.origin · conversations.tunnel", rules: ["Compara texto normalizado de mensagens do cliente com a planilha; chaves ambíguas são descartadas.", "Preenche valores ausentes, sem substituir valores já existentes; executado antes do batch WhatsApp e na análise individual.", "A planilha de tags de fechamento é outro fluxo: telefone e tag mais recente, não é a tabela de UTMs."], sources: ["lib/conversations/matchConversationOriginMap.ts", "lib/conversations/matchConversationsSheetAttribution.ts", "app/api/analyze/route.ts"] },
        { title: "Plataforma paga · TinTim", input: "source, identificadores de clique, UTM", output: "tintim_attribution_events.platform", rules: ["Ordem: source explicitamente pago → clique exclusivo Google ou Meta → UTM paga.", "Google/Meta genéricos exigem meio pago (cpc, ppc, paid etc.) nesta última regra.", "Sem evidência suficiente, platform = null; source não rastreada não prova tracking."], sources: ["lib/tintim/attribution.ts"] },
        { title: "Plataforma paga · Jornada (fallback)", input: "Origem, evento TinTim, perfil", output: "google_ads / meta_ads / other / untracked", rules: ["Origem paga explícita da conversa tem prioridade. Depois, evento TinTim mais próximo do início (±2 dias, mesmo cliente).", "Se existe evento TinTim sem plataforma paga, não usa o perfil para forçar mídia paga.", "Se não existe evento, usa perfil apenas quando tracking_updated_at está a até 7 dias do início.", "No perfil: família de last_origin → utm_source → click ID exclusivo. Dois grupos de click IDs sem outra evidência não resolvem plataforma.", "Cobertura conta thread_id, senão client_id, senão conversation.id; rastreado não significa necessariamente pago."], sources: ["app/api/dashboard/jornada/route.ts", "lib/ads/paidMediaAttribution.ts", "lib/funnel/whatsappTracking.ts"], rpc: "dashboard_tintim_conversation_attribution_v1" },
    ] },
    { id: "tunel", title: "Atribuição de túnel", nodes: [
        { title: "1 · Túnel já específico", input: "conversations.tunnel", output: "Preservado", rules: ["Se não está vazio e não é Entrada Organica, mantém o valor.", "A planilha pode preencher o túnel antes da análise. Reconciliação pode preencher last_tunnel vazio/genérico do cliente vinculado."], sources: ["lib/analysis/reconcileConversationTunnel.ts", "lib/conversations/matchConversationOriginMap.ts"], rpc: "reconcile_conversation_tunnels" },
        { title: "2 · Referral de anúncio", input: "conversation_ad_attributions + messages", output: "Túnel reconhecido pela aquisição", rules: ["Somente referrals de mensagens do cliente na conversa, mais recentes primeiro.", "Ordem de campos: campaign_name → ad_set_name → ad_name → referral_ad_title.", "Sem classificação nos metadados, usa intenção explícita da mensagem do referral se resultar em um único túnel.", "Nomes ambíguos não recebem uma escolha arbitrária."], sources: ["lib/analysis/tunnelAttribution.ts", "lib/analysis/reconcileConversationTunnel.ts"] },
        { title: "3 · UTM do cliente", input: "utm_campaign · utm_content · utm_term", output: "Túnel por metadados", rules: ["tracking_updated_at deve existir e não pode ser posterior a last_message_at (ou ended_at/started_at).", "Campanha numérica é resolvida pelo campaign_id em ad_daily_metrics, usando o nome mais recente; depois content e term.", "Não usa um clique posterior como evidência de aquisição da conversa anterior."], sources: ["lib/analysis/reconcileConversationTunnel.ts"] },
        { title: "4 · Análise da conversa", input: "conversation_analysis.tunnel_attribution / pattern_signals", output: "Túnel inferido ou null", rules: ["Confiança ≥ 0,90 e 1–3 citações literais verificadas em mensagens do cliente, com IDs válidos.", "Não usa texto de bot/atendente como prova; rejeita intenção negada ou ambígua.", "Bio Instagram e Site exigem declaração explícita do caminho de entrada. Sinais antigos de interesse podem servir se apontarem para um único túnel."], sources: ["lib/analysis/tunnelAttribution.ts", "lib/analysis/saveConversationAnalysis.ts"] },
        { title: "5 · Túnel efetivo na leitura", input: "Túnel persistido + fallback de NF-e", output: "effective_tunnel", rules: ["O RPC de reconciliação só troca valores vazios ou Entrada Organica e só aceita os sete túneis específicos.", "Na leitura, effective_tunnel(conversation) pode usar o fallback de NF-e do cliente direto ou social vinculado se o túnel estiver vazio/genérico.", "effective_tunnel(client) usa fallback de invoice_client_tunnels apenas sem outro túnel específico em conversas diretas ou sociais.", "O fallback de leitura não significa que a campanha original foi identificada."], sources: ["lib/analysis/reconcileConversationTunnel.ts"], rpc: "effective_tunnel · journey_private.invoice_client_tunnels" },
    ] },
    { id: "analise", title: "Conversas e análise", nodes: [
        { title: "Finalização Inbox", input: "thread + mensagens pendentes", output: "conversations + messages.conversation_id", rules: ["Finalização manual ou automática; cron busca threads inativas há 16h (padrão).", "Fluxo normal de finalização manual adia a IA; referral já pode reconciliar túnel.", "Cron também agrupa mensagens legadas e faz atribuição pela planilha."], sources: ["lib/inbox/finalizeInboxThreadAndAnalyze.ts", "app/api/(cron)/finalize-inactive-inbox/route.ts"] },
        { title: "Análise agendada", input: "Conversas elegíveis por canal", output: "conversation_analysis", rules: ["WhatsApp: agrupa mensagens legadas; todos os canais: resolve nomes de remetentes.", "Vertex AI batch (gpt-oss-120b-maas) coleta jobs terminados e submete novas conversas elegíveis.", "Claim no banco evita análise concorrente; batch exige mínimo de 100 registros; limite de 3 falhas de análise.", "No WhatsApp, aplica o mapa de origem antes de enviar os IDs já reivindicados. Falha nessa fase restaura claims."], sources: ["app/api/analyze/route.ts", "lib/ai/googleBatchAnalysis.ts"] },
        { title: "Persistência e análise individual", input: "Resultado validado + mensagens", output: "conversation_analysis · conversations · ad_events", rules: ["Salva intenção, objetivo, resolução, eventos, abandono, tempos, qualidade, evidências e sinais de padrão.", "Valida atribuição de túnel, reconcilia perfil e tenta sincronizar tag de fechamento.", "Análise individual usa analyzeConversationsByIds; também aplica planilha antes de analisar.", "Após persistência, deriva eventos de publicidade e tenta enviar a Meta/Google."], sources: ["lib/conversations/analyzeConversationsByIds.ts", "lib/conversations/processPendingConversationsToAnalysisAndAdEvents.ts", "lib/analysis/saveConversationAnalysis.ts", "lib/ai/googleBatchAnalysis.ts"] },
    ] },
    { id: "conversoes", title: "Conversões Meta e Google", nodes: [
        { title: "Lead qualificado / agendamento por conversa", input: "conversation_analysis.outcome_events", output: "lead / schedule", rules: ["Lead: consultation_offered, price_presented ou handoff_to_unit; sem abandono/dropoff e sem desqualificação.", "Agendamento: scheduled/rescheduled, customer_scheduled ou evento de agendamento/reagendamento.", "Não gera eventos para cliente desqualificado. A análise não gera attendance."], sources: ["lib/ads/adEventRules.ts", "lib/ads/deriveAdEventsFromAnalysis.ts"] },
        { title: "CliniSYS · agendamento e comparecimento", input: "Webhook de agenda + BigQuery", output: "schedules · ad_events · schedule_conversion_claims", rules: ["Conversões de agenda têm escopo de primeira avaliação de reprodução; status inativo não envia Schedule.", "Webhook e BigQuery compartilham hash/ID externo da agenda para reconciliar registros.", "Comparecimento é evento separado (attendance) e pode ser detectado depois do agendamento.", "Claim por schedule_id/plataforma e tipo separa comparecimento de agendamento; protege concorrência. Claim abandonado pode ser recuperado após 10 min.", "Já enviado por cliente/plataforma no mês de São Paulo bloqueia outro Schedule de agenda; retry de Meta roda após BigQuery."], sources: ["lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts", "lib/schedules/sendScheduleConversionOnce.ts", "lib/ads/hasSentMonthlyScheduleConversion.ts", "app/api/(cron)/clinisys/bigquery/route.ts"] },
        { title: "Entrega Meta / Google", input: "Evento + dados de identidade/identificadores", output: "ad_events.status · parameters", rules: ["Meta: CompleteRegistration, Schedule, FindLocation. Envia via Conversions API; telefone/e-mail normalizados e hash, tracking quando disponível. Sem telefone/e-mail, não envia.", "Google: qualified_lead, book_appointment, attendance. Exige gclid/gbraid/wbraid; usa ações de conversão configuradas por conta.", "Meta usa event_id derivado de ID de origem + tipo; Google usa identificação de conversão da origem. Status de entrega é registrado em ad_events.", "As tentativas de envio não equivalem à atribuição de campanha nem à confirmação de conversão na plataforma."], sources: ["lib/ads/meta/sendMetaEvents.ts", "lib/ads/google/sendGoogleEvents.ts"] },
    ] },
    { id: "clinica", title: "CliniSYS, receita e Jornada", nodes: [
        { title: "Agendas e funil clínico", input: "BigQuery / CliniSYS", output: "schedules · funnel_clinisys_events · funnel_history", rules: ["Importação de conversões de primeira avaliação usa schedules; jornada clínica mantém eventos de avaliação e procedimento em funnel_clinisys_events.", "Sincronização de jornada normaliza agenda, status, procedimento, telefone, unidade e cliente; usa hash/ID de origem para reconciliar.", "apply_clinisys_funnel_moves aplica progressão clínica ao funil do cliente."], sources: ["lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts", "lib/funnel/syncClinisysJourney.ts", "lib/funnel/clinisysJourney.ts"], rpc: "apply_clinisys_funnel_moves" },
        { title: "Notas fiscais", input: "BigQuery · NF-e", output: "clinisys_invoices", rules: ["Upsert por identificador de origem; associa unidade, médico e cliente. CPF explícito não deve cair no telefone do cônjuge.", "Consulta: categoria evaluation ou descrição contendo consulta. Restante: tratamento, inclusive exames e armazenamento.", "Pagamento da Jornada depende do status autorizado (inclui cancelamento negado/rejeitado), não do valor mínimo."], sources: ["lib/invoices/syncBigqueryInvoices.ts", "lib/funnel/fullJourney.ts", "docs/jornada-invoice-classification.md"] },
        { title: "Mídia e custos", input: "APIs Google Ads / Meta Ads", output: "ad_daily_metrics · ad_daily_city_metrics · ad_daily_instagram_direct_metrics", rules: ["Sincroniza campanha/dia: gasto, impressões, cliques, conversões reportadas; detalha cidades e grupos Google.", "Meta Direct usa destino da mensagem, não posicionamento do anúncio; destinos mistos são excluídos desse recorte.", "Sincronização também pode enriquecer referrals de anúncios e reconciliar vínculos Instagram/cliente."], sources: ["lib/ads/finance/syncAdsFinance.ts", "app/api/(cron)/ads/finance/route.ts"] },
        { title: "Jornada · coorte e agregação", input: "Contatos + eventos clínicos + NF-e + métricas de mídia", output: "journey_private.contacts · anchors · snapshot / prepared", rules: ["Período padrão maduro: 90 a 30 dias atrás (São Paulo).", "Cards principais contam clientes únicos; detalhamento de procedimentos conta agendas elegíveis deduplicadas.", "Etapas cruzam WhatsApp rastreado, social, agendamento, comparecimento e NF-e autorizada; comparecimento pode ocorrer depois de uma NF-e pré-paga.", "Leitura utiliza funções preparadas/snapshot com lógica de fallback no endpoint da Jornada."], sources: ["app/api/dashboard/jornada/route.ts", "lib/funnel/fullJourney.ts"], rpc: "dashboard_journey_prepared_v1 · dashboard_journey_snapshot_v1" },
        { title: "ROI por túnel", input: "Coorte WhatsApp paga + NF-e autorizadas + gasto BRL", output: "receita atribuída · investimento · ROI", rules: ["SQL preparado escolhe a primeira entrada paga por cliente no recorte (ordenada por maior entre started_at e paid_at). Receita vem da âncora clínica associada.", "Gasto: soma de campanhas Meta/Google em BRL no período. Nome da campanha é classificado por regex; ambíguas ou sem correspondência ficam em __NULL__.", "ROI = 100 × (receita atribuída − investimento) / investimento. Sem investimento, ROI é null. Participação = investimento / gasto total × 100.", "Na apresentação, Problemas e Tratamentos são agrupados, com receita e gasto somados e ROI recalculado."], sources: ["lib/dashboard/tunnelPerformance.ts", "app/api/dashboard/jornada/route.ts"], rpc: "dashboard_journey_tunnel_roi_v1 · dashboard_tunnel_performance_v1" },
    ] },
];

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

const overview = [
    { title: "Captura", color: "bg-blue-soft text-blue", items: ["Blip · WhatsApp", "Zernio · Instagram / Messenger", "TinTim · UTM / clique", "Planilha · mensagem / origem / túnel"], target: "#entrada" },
    { title: "Identidade e atribuição", color: "bg-purple-soft text-purple", items: ["clients / instagram_users", "messages / thread / conversations", "Histórico de clique e referral", "Origem + plataforma + túnel"], target: "#tunel" },
    { title: "Conversão e receita", color: "bg-orange-soft text-orange", items: ["Análise de conversas", "CliniSYS · agenda / comparecimento", "NF-e · receita autorizada", "ad_events → Meta / Google"], target: "#conversoes" },
    { title: "Leitura", color: "bg-green-soft text-green", items: ["Métricas de mídia / custos", "Fatos preparados da Jornada", "Coortes e cobertura", "ROI por túnel"], target: "#clinica" },
];

function SourceLinks({ sources }: { sources: string[] }) {
    return <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3">
        {sources.map(path => <a key={path} href={root + path} target="_blank" rel="noreferrer" className="break-all text-xs text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-brand">{path}</a>)}
    </div>;
}

function CronTable({ rows }: { rows: string[][] }) {
    return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr>{["Cron (UTC)", "São Paulo (UTC−3)", "Rota / job", "Função"].map(label => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead>
        <tbody>{rows.map(([schedule, local, route, purpose]) => <tr key={route} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{schedule}</td><td className="px-3 py-3">{local}</td><td className="max-w-xs break-all px-3 py-3 font-mono text-xs text-slate-600">{route}</td><td className="px-3 py-3 text-slate-600">{purpose}</td></tr>)}</tbody>
    </table></div>;
}

export default function DevTrackingMapPage() {
    return <main className="h-full overflow-y-auto bg-background px-4 py-8 text-slate-900 md:px-8">
        <div className="mx-auto max-w-7xl space-y-8 pb-10">
            <header>
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Mapa de rastreamento</h1>
                <p className="mt-2 text-sm text-slate-500">Engravida Hub · fluxo de aquisição, conversões e receita</p>
                <p className="mt-1 text-xs text-slate-500">Referência: preview / Supabase · 26/11/2026 · documentação estática, sem dados de pacientes.</p>
                <nav aria-label="Seções do mapa" className="mt-5 flex flex-wrap gap-2">
                    {sections.map(s => <a key={s.id} href={"#" + s.id} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{s.title}</a>)}
                    <a href="#crons" className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Crons</a>
                </nav>
            </header>
            <Card>
                <h2 className="mb-5 text-xl font-bold">Fluxo geral</h2>
                <div className="grid gap-3 lg:grid-cols-4">
                    {overview.map((stage, i) => <div key={stage.title} className="relative min-w-0">
                        <a href={stage.target} className="block h-full rounded-xl border border-border bg-slate-50 p-4 hover:border-brand">
                            <div className={"mb-3 inline-flex rounded-md px-2 py-1 text-xs font-bold " + stage.color}>{i + 1} · {stage.title}</div>
                            <div className="space-y-2">{stage.items.map(item => <div key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium">{item}</div>)}</div>
                        </a>
                        {i < overview.length - 1 && <span aria-hidden="true" className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white px-1 text-slate-400 lg:block">→</span>}
                    </div>)}
                </div>
                <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
                    <div><h3 className="text-sm font-bold">Origem</h3><p className="mt-1 text-sm text-slate-500">De onde a conversa veio: campanha, link, anúncio ou mensagem mapeada.</p></div>
                    <div><h3 className="text-sm font-bold">Plataforma</h3><p className="mt-1 text-sm text-slate-500">Google Ads, Meta Ads, outra origem rastreada ou sem rastreamento.</p></div>
                    <div><h3 className="text-sm font-bold">Túnel</h3><p className="mt-1 text-sm text-slate-500">Segmento de aquisição/interesse. Não é sinônimo de origem nem de canal.</p></div>
                </div>
            </Card>
            {sections.map(section => <section key={section.id} id={section.id} className="scroll-mt-6 space-y-4">
                <h2 className="text-xl font-bold">{section.title}</h2>
                {section.id === "tunel" && <div className="rounded-xl border border-border bg-white p-4 text-sm">
                    <p className="font-semibold">Problemas · Laqueadura · LGBT · Congelamento · Tratamentos · Bio Instagram · Site - Home | Engravida</p>
                    <p className="mt-1 text-slate-500">Entrada Organica é considerada genérica. Os passos 1–4 são a ordem de reconciliação; o passo 5 é um fallback de leitura.</p>
                    <p className="mt-3 font-medium text-slate-700">Túnel existente → Referral → UTM → Análise → leitura efetiva</p>
                </div>}
                <div className="grid gap-4 xl:grid-cols-2">{section.nodes.map(node => <Card key={node.title}>
                    <h3 className="mb-3 text-base font-bold">{node.title}</h3>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
                        <div className="min-w-0 rounded-lg border border-border bg-slate-50 p-3"><div className="mb-1 text-xs font-bold text-slate-500">ENTRADA</div><div className="break-words text-sm">{node.input}</div></div>
                        <div aria-hidden="true" className="self-center text-center text-slate-400"><span className="hidden sm:inline">→</span><span className="sm:hidden">↓</span></div>
                        <div className="min-w-0 rounded-lg border border-border bg-slate-50 p-3"><div className="mb-1 text-xs font-bold text-slate-500">SAÍDA</div><div className="break-words text-sm font-semibold">{node.output}</div></div>
                    </div>
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600">{node.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
                    {"rpc" in node && node.rpc && <p className="mt-3 break-all rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-600">SQL: {node.rpc}</p>}
                    <SourceLinks sources={node.sources} />
                </Card>)}</div>
            </section>)}
            <section id="crons" className="scroll-mt-6 space-y-4">
                <h2 className="text-xl font-bold">Crons</h2>
                <Card><h3 className="mb-2 text-lg font-bold">Vercel · configuração do repositório</h3><p className="mb-4 text-sm text-slate-500">Horários declarados em vercel.json (UTC). Conversão para São Paulo ao lado; não representa confirmação de execução em preview.</p><CronTable rows={vercelCrons} /><SourceLinks sources={["vercel.json"]} /></Card>
                <Card><h3 className="mb-2 text-lg font-bold">Supabase · pg_cron</h3><p className="mb-4 text-sm text-slate-500">Três jobs ativos consultados em cron.job em 26/11/2026. Últimas execuções consultadas com status succeeded.</p><CronTable rows={dbCrons} /></Card>
            </section>
            <Card><h2 className="mb-4 text-xl font-bold">Pontos de verificação</h2>
                <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="p-3">Sintoma</th><th className="p-3">Verificar</th></tr></thead><tbody>
                    {[
                        ["WhatsApp sem origem", "conversations.origin → tintim_attribution_events (±2 dias) → clients.tracking_updated_at e UTMs"],
                        ["Instagram sem anúncio", "messages → conversation_ad_attributions.meta_ad_id / enrichment_status → instagram_users.client_id"],
                        ["Túnel ausente", "Planilha → referral → UTMs anteriores à conversa → conversation_analysis → effective_tunnel"],
                        ["Conversão não enviada", "ad_events.status / parameters → dados de identidade / click ID → schedule_conversion_claims e deduplicação mensal"],
                        ["Receita ausente", "funnel_clinisys_events → clinisys_invoices.client_id / status → coorte e âncora da Jornada"],
                        ["ROI sem investimento", "ad_daily_metrics.currency_code / campaign_name / período → classificação do túnel"],
                        ["Jornada desatualizada", "cron.job_run_details → dashboard_journey_refresh_all_v1 → dashboard_journey_refresh_facts_v1"],
                    ].map(([symptom, check]) => <tr key={symptom} className="border-t border-slate-100"><td className="p-3 font-medium">{symptom}</td><td className="p-3 text-slate-600">{check}</td></tr>)}
                </tbody></table></div>
            </Card>
        </div>
    </main>;
}
