// app/dev/map/trackingMapData.ts

export const sections = [
    { id: "entrada", title: "Entrada e identidade", nodes: [
        { id: "blip", col: 0, row: 0, title: "WhatsApp · Blip", input: "Mensagens e contatos", output: "clients · messages · thread", caption: "Mensagens e contatos recebidos", rules: ["Normaliza a identidade do contato e associa mensagens à thread.", "Webhook de mensagens usa claim atômico para evitar duplicação por entregas simultâneas.", "Mensagens antigas sem conversa são agrupadas pelo pipeline de análise."], sources: ["app/api/(webhooks)/blip/messages/route.ts", "lib/conversations/messagesToConversations.ts"] },
        { id: "zernio", col: 0, row: 1, title: "Instagram / Messenger", input: "Mensagem, participante, conta e referral", output: "instagram_users · messages · thread · conversation_ad_attributions", caption: "Mensagens e anúncios de origem", rules: ["persist_zernio_message registra a mensagem e a identidade social.", "Referral de anúncio fica associado à mensagem e thread, com meta_ad_id, campanha, conjunto e criativo.", "Enriquecimento consulta cache, Zernio e Meta Graph; pode preencher localização e reconciliar túnel.", "Vínculo instagram_users.client_id permite conectar o histórico social ao cliente WhatsApp/CliniSYS."], sources: ["app/api/(webhooks)/zernio/route.ts", "lib/zernio/conversationAdAttribution.ts", "lib/ads/finance/syncAdsFinance.ts"] },
        { id: "tintim", col: 0, row: 2, title: "TinTim · WhatsApp", input: "Telefone + source + parâmetros do clique/visita", output: "clients · tintim_attribution_events", caption: "Registra de onde veio o clique", rules: ["Busca telefone normalizado (com/sem prefixo 55); cria cliente se não existir.", "Campos de tracking do cliente só são preenchidos quando vazios. tracking_updated_at muda quando há preenchimento.", "Cada evento é registrado mesmo se o perfil não mudar; fingerprint SHA-256 evita repetição.", "Timestamp vem de created/updated conforme o evento, com fallback para recebimento."], sources: ["app/api/(webhooks)/tintim/route.ts", "lib/tintim/attribution.ts"] },
    ] },
    { id: "utm", title: "UTM, cliques e origem", nodes: [
        { id: "tracking", col: 1, row: 2, title: "Parâmetros de aquisição", input: "Payload TinTim ou visit.params", output: "clients + histórico JSON em tintim_attribution_events.tracking", caption: "UTMs e identificadores de clique", rules: ["utm_source = fonte; utm_medium = meio; utm_campaign = campanha; utm_content = conteúdo; utm_term = termo.", "Google: gclid, gbraid, wbraid. Meta: fbclid, fbc, fbp, ctwa_clid (clique para WhatsApp).", "Histórico também guarda utm_id, campaign_id, adset_id, ad_id e account_id quando presentes.", "IP, user agent, estado e país podem ser preenchidos no cliente; fbp sozinho não determina mídia paga."], sources: ["lib/tintim/attribution.ts"] },
        { id: "origin", col: 1, row: 3, title: "Origem da conversa · planilha", input: "Google Sheets: Mensagem / Origem / Tunnel", output: "conversations.origin · conversations.tunnel", caption: "Identifica a origem pelo texto recebido", rules: ["Compara texto normalizado de mensagens do cliente com a planilha; chaves ambíguas são descartadas.", "Preenche valores ausentes, sem substituir valores já existentes; executado antes do batch WhatsApp e na análise individual.", "A planilha de tags de fechamento é outro fluxo: telefone e tag mais recente, não é a tabela de UTMs."], sources: ["lib/conversations/matchConversationOriginMap.ts", "lib/conversations/matchConversationsSheetAttribution.ts", "app/api/analyze/route.ts"] },
        { id: "paidEvent", col: 2, row: 3, title: "Plataforma paga · TinTim", input: "source, identificadores de clique, UTM", output: "tintim_attribution_events.platform", caption: "Identifica se o clique veio de mídia paga", rules: ["Ordem: source explicitamente pago → clique exclusivo Google ou Meta → UTM paga.", "Google/Meta genéricos exigem meio pago (cpc, ppc, paid etc.) nesta última regra.", "Sem evidência suficiente, platform = null; source não rastreada não prova tracking."], sources: ["lib/tintim/attribution.ts"] },
        { id: "paidJourney", col: 3, row: 4, title: "Plataforma paga · Jornada", input: "Origem, evento TinTim, perfil", output: "google_ads / meta_ads / other / untracked", caption: "Atribui a conversa a uma plataforma", rules: ["Origem paga explícita da conversa tem prioridade. Depois, evento TinTim mais próximo do início (±2 dias, mesmo cliente).", "Se existe evento TinTim sem plataforma paga, não usa o perfil para forçar mídia paga.", "Se não existe evento, usa perfil apenas quando tracking_updated_at está a até 7 dias do início.", "No perfil: família de last_origin → utm_source → click ID exclusivo. Dois grupos de click IDs sem outra evidência não resolvem plataforma.", "Cobertura conta thread_id, senão client_id, senão conversation.id; rastreado não significa necessariamente pago."], sources: ["app/api/dashboard/jornada/route.ts", "lib/ads/paidMediaAttribution.ts", "lib/funnel/whatsappTracking.ts"], rpc: "dashboard_tintim_conversation_attribution_v1" },
    ] },
    { id: "perfil", title: "Identidade e rastreamento do cliente", nodes: [
        {
            id: "clientProfile", col: 2, row: 2, title: "Perfil do cliente",
            caption: "Identidade, UTMs e IDs de clique",
            input: "WhatsApp e CliniSYS para identidade · TinTim para tracking · vínculos sociais quando identificados",
            output: "clients.id · dados de contato · UTMs · identificadores de clique e navegador",
            rules: [
                "Blip identifica ou cadastra o cliente. CliniSYS pode criar ou atualizar seus dados cadastrais ao resolver o paciente.",
                "TinTim localiza o cliente pelo telefone, grava UTMs e identificadores nos campos vazios e mantém o histórico de cada evento em tintim_attribution_events.",
                "Conversas de WhatsApp, agendamentos, eventos clínicos e notas fiscais vinculadas convergem pelo client_id. A identidade social pode ser vinculada por instagram_users.client_id.",
                "Meta lê as UTMs e os sinais de correspondência; Google Ads lê os IDs de clique. A atribuição de túnel e o fallback de mídia paga na Jornada consultam o tracking do perfil com suas próprias regras de data.",
            ],
            sources: [
                "lib/clients/createClient.ts", "app/api/(webhooks)/tintim/route.ts",
                "app/api/(webhooks)/webhooks/clinisys/appointments/route.ts", "lib/ads/finance/syncAdsFinance.ts",
            ],
        },
    ] },
    { id: "tunel", title: "Atribuição de túnel", nodes: [
        { id: "storedTunnel", col: 3, row: 3, title: "1 · Túnel já específico", input: "conversations.tunnel", output: "Preservado", caption: "Mantém o túnel já identificado", rules: ["Se não está vazio e não é Entrada Organica, mantém o valor. Túnel representa o segmento de aquisição ou interesse.", "A planilha pode preencher o túnel antes da análise. Reconciliação pode preencher last_tunnel vazio/genérico do cliente vinculado."], sources: ["lib/analysis/reconcileConversationTunnel.ts", "lib/conversations/matchConversationOriginMap.ts"], rpc: "reconcile_conversation_tunnels" },
        { id: "referral", col: 1, row: 1, title: "2 · Referral de anúncio", input: "conversation_ad_attributions + messages", output: "Túnel reconhecido pela aquisição", caption: "Usa o anúncio que iniciou a conversa", rules: ["Somente referrals de mensagens do cliente na conversa, mais recentes primeiro.", "Ordem de campos: campaign_name → ad_set_name → ad_name → referral_ad_title.", "Sem classificação nos metadados, usa intenção explícita da mensagem do referral se resultar em um único túnel.", "Nomes ambíguos não recebem uma escolha arbitrária."], sources: ["lib/analysis/tunnelAttribution.ts", "lib/analysis/reconcileConversationTunnel.ts"] },
        { id: "utmTunnel", col: 2, row: 4, title: "3 · UTM do cliente", input: "utm_campaign · utm_content · utm_term", output: "Túnel por metadados", caption: "Usa a campanha registrada no cliente", rules: ["tracking_updated_at deve existir e não pode ser posterior a last_message_at (ou ended_at/started_at).", "Campanha numérica é resolvida pelo campaign_id em ad_daily_metrics, usando o nome mais recente; depois content e term.", "Não usa um clique posterior como evidência de aquisição da conversa anterior."], sources: ["lib/analysis/reconcileConversationTunnel.ts"] },
        { id: "analysisTunnel", col: 3, row: 1, title: "4 · Análise da conversa", input: "conversation_analysis.tunnel_attribution / pattern_signals", output: "Túnel inferido ou null", caption: "Usa evidências da conversa", rules: ["Confiança ≥ 0,90 e 1–3 citações literais verificadas em mensagens do cliente, com IDs válidos.", "Não usa texto de bot/atendente como prova; rejeita intenção negada ou ambígua.", "Bio Instagram e Site exigem declaração explícita do caminho de entrada. Sinais antigos de interesse podem servir se apontarem para um único túnel."], sources: ["lib/analysis/tunnelAttribution.ts", "lib/analysis/saveConversationAnalysis.ts"] },
        { id: "effectiveTunnel", col: 4, row: 3, title: "5 · Túnel efetivo na leitura", input: "Túnel persistido + fallback de NF-e", output: "effective_tunnel", caption: "Determina o túnel usado nos relatórios", rules: ["O RPC só substitui valores vazios ou Entrada Organica. A prioridade é túnel existente, referral, UTM e análise, nessa ordem.", "Túneis específicos: Problemas, Laqueadura, LGBT, Congelamento, Tratamentos, Bio Instagram e Site - Home | Engravida.", "Na leitura, effective_tunnel(conversation) pode usar o fallback de NF-e do cliente direto ou social vinculado se o túnel estiver vazio/genérico.", "effective_tunnel(client) usa fallback de invoice_client_tunnels apenas sem outro túnel específico em conversas diretas ou sociais.", "O fallback de leitura não significa que a campanha original foi identificada."], sources: ["lib/analysis/reconcileConversationTunnel.ts"], rpc: "effective_tunnel · journey_private.invoice_client_tunnels" },
    ] },
    { id: "analise", title: "Conversas e análise", nodes: [
        { id: "inbox", col: 1, row: 0, title: "Finalização Inbox", input: "thread + mensagens pendentes", output: "conversations + messages.conversation_id", caption: "Agrupa mensagens em conversas", rules: ["Finalização manual ou automática; cron busca threads inativas há 16h (padrão).", "Fluxo normal de finalização manual adia a IA; referral já pode reconciliar túnel.", "Cron também agrupa mensagens legadas e faz atribuição pela planilha."], sources: ["lib/inbox/finalizeInboxThreadAndAnalyze.ts", "app/api/(cron)/finalize-inactive-inbox/route.ts"] },
        { id: "batch", col: 2, row: 0, title: "Análise agendada", input: "Conversas elegíveis por canal", output: "conversation_analysis", caption: "Envia conversas para análise por IA", rules: ["WhatsApp: agrupa mensagens legadas; todos os canais: resolve nomes de remetentes.", "Vertex AI batch (gpt-oss-120b-maas) coleta jobs terminados e submete novas conversas elegíveis.", "Claim no banco evita análise concorrente; batch exige mínimo de 100 registros; limite de 3 falhas de análise.", "No WhatsApp, aplica o mapa de origem antes de enviar os IDs já reivindicados. Falha nessa fase restaura claims."], sources: ["app/api/analyze/route.ts", "lib/ai/googleBatchAnalysis.ts"] },
        { id: "analysis", col: 2, row: 1, title: "Análise persistida", input: "Resultado validado + mensagens", output: "conversation_analysis · conversations", caption: "Registra intenções e desfechos", rules: ["Salva intenção, objetivo, resolução, eventos, abandono, tempos, qualidade, evidências e sinais de padrão.", "Valida atribuição de túnel, reconcilia perfil e tenta sincronizar tag de fechamento.", "Análise individual usa analyzeConversationsByIds; também aplica planilha antes de analisar.", "Após persistência, deriva eventos de publicidade e tenta enviar a Meta/Google."], sources: ["lib/conversations/analyzeConversationsByIds.ts", "lib/conversations/processPendingConversationsToAnalysisAndAdEvents.ts", "lib/analysis/saveConversationAnalysis.ts", "lib/ai/googleBatchAnalysis.ts"] },
    ] },
    { id: "conversoes", title: "Conversões Meta e Google", nodes: [
        { id: "conversationConversion", col: 3, row: 0, title: "Lead da conversa", input: "conversation_analysis.outcome_events", output: "lead elegível para envio", caption: "Identifica leads qualificados", rules: ["Lead: consultation_offered, price_presented ou handoff_to_unit; sem abandono/dropoff e sem desqualificação.", "A regra também reconhece agendamento e reagendamento, mas os pipelines de análise filtram o envio para leads. Agendamento e comparecimento são enviados pelo fluxo CliniSYS."], sources: ["lib/ads/adEventRules.ts", "lib/ads/deriveAdEventsFromAnalysis.ts", "lib/ai/googleBatchAnalysis.ts", "lib/conversations/processPendingConversationsToAnalysisAndAdEvents.ts"] },
        { id: "schedule", col: 1, row: 4, title: "Agenda e comparecimento", input: "Webhook de agenda + BigQuery", output: "schedules · ad_events · schedule_conversion_claims", caption: "Registra agendamentos e presenças", rules: ["Conversões de agenda têm escopo de primeira avaliação de reprodução; status inativo não envia Schedule.", "Webhook e BigQuery compartilham hash/ID externo da agenda para reconciliar registros.", "Comparecimento é evento separado (attendance) e pode ser detectado depois do agendamento.", "Claim por schedule_id/plataforma e tipo separa comparecimento de agendamento; protege concorrência. Claim abandonado pode ser recuperado após 10 min.", "Já enviado por cliente/plataforma no mês de São Paulo bloqueia outro Schedule de agenda; retry de Meta roda após BigQuery."], sources: ["lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts", "lib/schedules/sendScheduleConversionOnce.ts", "lib/ads/hasSentMonthlyScheduleConversion.ts", "app/api/(cron)/clinisys/bigquery/route.ts"] },
        { id: "delivery", col: 3, row: 2, title: "Entrega Meta / Google", input: "Evento elegível + rastreamento do perfil em clients", output: "ad_events.status · parameters", caption: "Envia conversões para as plataformas", rules: ["Meta: CompleteRegistration, Schedule, FindLocation. Envia via Conversions API; telefone/e-mail normalizados e com hash, sinais de correspondência do perfil quando disponíveis e UTMs em custom_data. Sem telefone/e-mail, não envia.", "Google: qualified_lead, book_appointment, attendance. Exige gclid/gbraid/wbraid; usa ações de conversão configuradas por conta.", "Meta usa event_id derivado de ID de origem + tipo; Google usa identificação de conversão da origem. Status de entrega é registrado em ad_events.", "As tentativas de envio não equivalem à atribuição de campanha nem à confirmação de conversão na plataforma."], sources: ["lib/ads/meta/sendMetaEvents.ts", "lib/ads/google/sendGoogleEvents.ts"] },
    ] },
    { id: "clinica", title: "CliniSYS, receita e Jornada", nodes: [
        { id: "clinicalFunnel", col: 2, row: 5, title: "Agendas e funil clínico", input: "BigQuery / CliniSYS", output: "schedules · funnel_clinisys_events · funnel_history", caption: "Acompanha avaliações e procedimentos", rules: ["Importação de conversões de primeira avaliação usa schedules; jornada clínica mantém eventos de avaliação e procedimento em funnel_clinisys_events.", "Sincronização de jornada normaliza agenda, status, procedimento, telefone, unidade e cliente; usa hash/ID de origem para reconciliar.", "apply_clinisys_funnel_moves aplica progressão clínica ao funil do cliente."], sources: ["lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts", "lib/funnel/syncClinisysJourney.ts", "lib/funnel/clinisysJourney.ts"], rpc: "apply_clinisys_funnel_moves" },
        { id: "invoices", col: 1, row: 5, title: "Notas fiscais", input: "BigQuery · NF-e", output: "clinisys_invoices", caption: "Vincula as notas fiscais aos clientes", rules: ["Upsert por identificador de origem; associa unidade, médico e cliente. CPF explícito não deve cair no telefone do cônjuge.", "Consulta: categoria evaluation ou descrição contendo consulta. Restante: tratamento, inclusive exames e armazenamento.", "Pagamento da Jornada depende do status autorizado (inclui cancelamento negado/rejeitado), não do valor mínimo."], sources: ["lib/invoices/syncBigqueryInvoices.ts", "lib/funnel/fullJourney.ts", "docs/jornada-invoice-classification.md"] },
        { id: "media", col: 1, row: 6, title: "Mídia e custos", input: "APIs Google Ads / Meta Ads", output: "ad_daily_metrics · ad_daily_city_metrics · ad_daily_instagram_direct_metrics", caption: "Importa gastos, cliques e conversões", rules: ["Sincroniza campanha/dia: gasto, impressões, cliques, conversões reportadas; detalha cidades e grupos Google.", "Meta Direct usa destino da mensagem, não posicionamento do anúncio; destinos mistos são excluídos desse recorte.", "Sincronização também pode enriquecer referrals de anúncios e reconciliar vínculos Instagram/cliente."], sources: ["lib/ads/finance/syncAdsFinance.ts", "app/api/(cron)/ads/finance/route.ts"] },
        { id: "journey", col: 4, row: 4, title: "Jornada · coortes", input: "Contatos + eventos clínicos + NF-e + métricas de mídia", output: "journey_private.contacts · anchors · snapshot / prepared", caption: "Cruza contatos, atendimento e receita", rules: ["Período padrão maduro: 90 a 30 dias atrás (São Paulo).", "Cards principais contam clientes únicos; detalhamento de procedimentos conta agendas elegíveis deduplicadas.", "Etapas cruzam WhatsApp rastreado, social, agendamento, comparecimento e NF-e autorizada; comparecimento pode ocorrer depois de uma NF-e pré-paga.", "Leitura utiliza funções preparadas/snapshot com lógica de fallback no endpoint da Jornada."], sources: ["app/api/dashboard/jornada/route.ts", "lib/funnel/fullJourney.ts"], rpc: "dashboard_journey_prepared_v1 · dashboard_journey_snapshot_v1" },
        { id: "roi", col: 5, row: 5, title: "ROI por túnel", input: "Coorte WhatsApp paga + NF-e autorizadas + gasto BRL", output: "receita atribuída · investimento · ROI", caption: "Compara receita e gasto por túnel", rules: ["SQL preparado escolhe a primeira entrada paga por cliente no recorte (ordenada por maior entre started_at e paid_at). Receita vem da âncora clínica associada.", "Gasto: soma de campanhas Meta/Google em BRL no período. Nome da campanha é classificado por regex; ambíguas ou sem correspondência ficam em __NULL__.", "ROI = 100 × (receita atribuída − investimento) / investimento. Sem investimento, ROI é null. Participação = investimento / gasto total × 100.", "Na apresentação, Problemas e Tratamentos são agrupados, com receita e gasto somados e ROI recalculado."], sources: ["lib/dashboard/tunnelPerformance.ts", "app/api/dashboard/jornada/route.ts"], rpc: "dashboard_journey_tunnel_roi_v1" },
    ] },
    { id: "fontes", title: "Fontes externas", nodes: [
        { id: "sheets", col: 0, row: 3, title: "Google Sheets", input: "Mensagem / Origem / Tunnel", output: "Mapa de mensagens", caption: "Relaciona mensagens, origens e túneis", rules: ["O Hub lê a planilha e cruza a mensagem normalizada com as conversas WhatsApp."], sources: ["lib/conversations/matchConversationOriginMap.ts"] },
        { id: "clinisys", col: 0, row: 4, title: "CliniSYS · webhook", input: "Criação, comparecimento e cancelamento", output: "appointments · clients · schedules", caption: "Recebe eventos de agendamento", rules: ["O webhook atualiza appointments e aciona o fluxo de conversões para eventos elegíveis."], sources: ["app/api/(webhooks)/webhooks/clinisys/appointments/route.ts"] },
        { id: "bigquery", col: 0, row: 5, title: "BigQuery · CliniSYS", input: "Exportação clínica e fiscal", output: "Agendas · procedimentos · NF-e", caption: "Exporta dados clínicos e fiscais", rules: ["Os importadores de agendas, funil clínico e notas fiscais leem a exportação do CliniSYS."], sources: ["lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts", "lib/funnel/syncClinisysJourney.ts", "lib/invoices/syncBigqueryInvoices.ts"] },
        { id: "ads", col: 0, row: 6, title: "Meta Ads / Google Ads", input: "Contas e campanhas de mídia", output: "Métricas por campanha", caption: "Fornece métricas por campanha", rules: ["A sincronização consulta as APIs das plataformas e normaliza as métricas de mídia no Hub."], sources: ["lib/ads/finance/syncAdsFinance.ts"] },
    ] },
    { id: "destinos", title: "Destinos e relatórios", nodes: [
        { id: "meta", col: 4, row: 1, title: "Meta · Conversions API", input: "Identidade com hash + evento", output: "CompleteRegistration · Schedule · FindLocation", caption: "Lead, agendamento e comparecimento", rules: ["O retorno da tentativa alimenta ad_events.status."], sources: ["lib/ads/meta/sendMetaEvents.ts"] },
        { id: "google", col: 4, row: 2, title: "Google Ads · conversões", input: "Click ID + ação de conversão", output: "qualified_lead · book_appointment · attendance", caption: "Lead, agendamento e comparecimento", rules: ["O retorno da tentativa alimenta ad_events.status e pode incluir falhas parciais."], sources: ["lib/ads/google/sendGoogleEvents.ts"] },
        { id: "finance", col: 5, row: 6, title: "Financeiro · túneis", input: "NF-e + desempenho por túnel", output: "Receita e investimento por túnel", caption: "Exibe receita e investimento por túnel", rules: ["O Financeiro consulta o RPC de desempenho e cruza os túneis com as notas fiscais do período."], sources: ["app/api/dashboard/financeiro/route.ts", "lib/dashboard/tunnelPerformance.ts"], rpc: "dashboard_tunnel_performance_v1" },
    ] },
] as const;

export type NodeId = (typeof sections)[number]["nodes"][number]["id"];

type MapConnection = readonly [from: NodeId, to: NodeId, detail: string, showInOverview?: true | "profileFlow"];

export const connections: readonly MapConnection[] = [
    ["blip", "clientProfile", "Identidade do WhatsApp cria ou atualiza o cliente"],
    ["blip", "inbox", "Mensagens e threads de WhatsApp", true],
    ["zernio", "inbox", "Mensagens e threads de Instagram e Messenger", true],
    ["zernio", "referral", "Referral ligado à mensagem e à thread", true],
    ["zernio", "clientProfile", "Identidade social vinculada por instagram_users.client_id quando identificada"],
    ["zernio", "journey", "Contatos sociais e vínculo com clients"],
    ["tintim", "tracking", "Parâmetros e identificadores dos cliques", "profileFlow"],
    ["sheets", "origin", "Mapa de mensagens, origens e túneis", true],
    ["inbox", "batch", "Conversas finalizadas e mensagens agrupadas", true],
    ["inbox", "origin", "Mensagem do cliente em conversa finalizada"],
    ["inbox", "storedTunnel", "Túnel já registrado na conversa"],
    ["inbox", "paidJourney", "Conversa, origem e horário de início"],
    ["origin", "storedTunnel", "Túnel específico ainda ausente na conversa", true],
    ["origin", "batch", "Origem e túnel preenchidos antes da análise WhatsApp"],
    ["origin", "paidJourney", "Origem paga explícita da conversa"],
    ["tracking", "clientProfile", "UTMs e identificadores gravados nos campos vazios do cliente", "profileFlow"],
    ["tracking", "paidEvent", "Fonte e identificadores de cada evento no histórico TinTim", true],
    ["clientProfile", "utmTunnel", "UTMs do perfil registradas até o fim da conversa", true],
    ["clientProfile", "paidJourney", "Fallback de tracking do perfil na ausência de evento TinTim"],
    ["clientProfile", "delivery", "Meta usa UTMs e sinais de correspondência; Google Ads usa IDs de clique", "profileFlow"],
    ["clientProfile", "schedule", "Identidade do paciente para vincular o agendamento por client_id"],
    ["clientProfile", "clinicalFunnel", "Identidade do paciente para vincular eventos clínicos por client_id"],
    ["clientProfile", "invoices", "CPF ou telefone para vincular a nota ao client_id"],
    ["clientProfile", "journey", "Vínculo por cliente entre aquisição, atendimento e receita"],
    ["paidEvent", "paidJourney", "Plataforma do evento TinTim mais próximo", true],
    ["batch", "analysis", "Resultados do lote validados e persistidos", true],
    ["analysis", "analysisTunnel", "Evidências verificadas e sinais de intenção", true],
    ["analysis", "conversationConversion", "Eventos de desfecho para qualificar o lead", true],
    ["analysis", "journey", "Intenções, abandono e demais métricas de análise"],
    ["referral", "effectiveTunnel", "Evidência de aquisição na reconciliação", true],
    ["utmTunnel", "effectiveTunnel", "Campanha, conteúdo ou termo da aquisição", true],
    ["storedTunnel", "effectiveTunnel", "Túnel específico tem prioridade", true],
    ["analysisTunnel", "effectiveTunnel", "Túnel inferido com evidência da conversa", true],
    ["conversationConversion", "delivery", "Envio de lead qualificado", true],
    ["clinisys", "clientProfile", "Cadastro do paciente atualizado ou criado quando necessário"],
    ["clinisys", "schedule", "Eventos de agendamento e comparecimento", true],
    ["bigquery", "schedule", "Agendas conciliadas por ID ou hash de origem"],
    ["bigquery", "clinicalFunnel", "Avaliações e procedimentos", true],
    ["bigquery", "invoices", "Notas fiscais do CliniSYS", true],
    ["schedule", "delivery", "Conversões de primeira avaliação e comparecimento", true],
    ["clinicalFunnel", "journey", "Avaliações, comparecimentos e procedimentos", true],
    ["invoices", "effectiveTunnel", "Fallback de leitura por cliente vinculado"],
    ["invoices", "journey", "Receita e pagamento com NF-e autorizada", true],
    ["invoices", "roi", "Receita autorizada atribuída à coorte"],
    ["invoices", "finance", "Notas fiscais do período por descrição"],
    ["ads", "media", "Métricas Meta e Google das contas configuradas", true],
    ["media", "referral", "Enriquecimento de anúncios e vínculo social"],
    ["media", "utmTunnel", "Nome da campanha associado ao campaign_id da UTM"],
    ["media", "journey", "Métricas de mídia e recorte Instagram Direct"],
    ["media", "roi", "Investimento em BRL por campanha classificada"],
    ["media", "finance", "Investimento por túnel", true],
    ["paidJourney", "journey", "Plataforma e cobertura do WhatsApp", true],
    ["effectiveTunnel", "journey", "Túnel efetivo do cliente ou da conversa", true],
    ["effectiveTunnel", "roi", "Túnel efetivo na atribuição de receita"],
    ["effectiveTunnel", "finance", "Classificação de receita por túnel"],
    ["journey", "roi", "Coorte paga e âncora clínica por cliente", true],
    ["delivery", "meta", "Eventos, identidade e UTMs via Conversions API", "profileFlow"],
    ["delivery", "google", "Upload com ação de conversão e click ID", "profileFlow"],
];

export const stepNotes: Partial<Record<NodeId, {
    automation?: string;
    check?: readonly [symptom: string, steps: string];
}>> = {
    inbox: { automation: "Finaliza threads inativas e agrupa mensagens legadas." },
    batch: { automation: "Envia conversas elegíveis para análise e coleta os lotes concluídos." },
    schedule: { automation: "Importa agendas do BigQuery e tenta reenviar conversões pendentes à Meta." },
    invoices: {
        automation: "Importa notas fiscais do BigQuery e atualiza o vínculo com os clientes.",
        check: ["Receita ausente", "Confira funnel_clinisys_events, client_id e status em clinisys_invoices, e a coorte e a âncora da Jornada."],
    },
    media: { automation: "Importa gastos e métricas de campanha da Meta e do Google." },
    journey: {
        automation: "Atualiza o snapshot e os fatos usados pelos relatórios da Jornada.",
        check: ["Jornada desatualizada", "Confira cron.job_run_details e as atualizações dashboard_journey_refresh_all_v1 e dashboard_journey_refresh_facts_v1."],
    },
    paidJourney: { check: ["WhatsApp sem origem", "Confira conversations.origin, tintim_attribution_events em até 2 dias do início, e clients.tracking_updated_at e UTMs."] },
    referral: { check: ["Instagram sem anúncio", "Confira messages, meta_ad_id e enrichment_status em conversation_ad_attributions, e o vínculo instagram_users.client_id."] },
    effectiveTunnel: { check: ["Túnel ausente", "Confira a planilha, o referral, as UTMs anteriores à conversa, conversation_analysis e effective_tunnel."] },
    delivery: { check: ["Conversão não enviada", "Confira status e parameters em ad_events, os identificadores exigidos pela plataforma, schedule_conversion_claims e a deduplicação mensal."] },
    roi: { check: ["ROI sem investimento", "Confira currency_code, campaign_name e período em ad_daily_metrics, e a classificação do túnel."] },
};
