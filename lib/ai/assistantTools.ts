// Shared tool definitions for the assistant and unit analyses.
export const ASSISTANT_TOOLS = [
    {
        type: "function",
        name: "get_unit_macro_history",
        description: "Consulta o histórico compartilhado de análises semanais/mensais por unidade, com relatórios e métricas para comparar evolução. Use offset para percorrer todo o histórico.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                unit_name: { type: "string" },
                analysis_type: { type: ["string", "null"], enum: ["weekly", "monthly", null] },
                offset: { type: "integer", minimum: 0 },
            },
            required: ["unit_name", "analysis_type", "offset"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "search_clients",
        description:
            "Busca clientes por nome, telefone, CPF ou e-mail. Use antes de get_client_context quando o id ainda não é conhecido.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: "string" },
                limit: { type: "integer", minimum: 1, maximum: 25 },
            },
            required: ["query", "limit"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_client_context",
        description:
            "Carrega o perfil completo, próximos agendamentos ativos, histórico de situação da agenda, thread aberta e conversas recentes. Também gera o card clicável do cliente. Sempre use para perguntas sobre uma pessoa específica.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                client_id: { type: "string" },
            },
            required: ["client_id"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "search_appointments",
        description:
            "Busca agendamentos individuais importados do CliniSys por paciente, unidade, data e situação. Entende pendente, compareceu, atendido, cancelado, faltou e remarcado. Use para localizar consultas específicas; para totais e taxas, use get_schedule_overview.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: ["string", "null"] },
                doctor_name: { type: ["string", "null"] },
                unit_name: { type: ["string", "null"] },
                start_date: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD",
                },
                end_date: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD",
                },
                future_only: { type: "boolean" },
                statuses: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: [
                            "all",
                            "pending",
                            "arrived",
                            "in_service",
                            "attended",
                            "showed_up",
                            "cancelled",
                            "no_show",
                            "rescheduled",
                        ],
                    },
                    description:
                        "Use showed_up para Compareceu; cancelled para Desmarcou; no_show para Faltou; pending para Não. all/scheduled não filtra por situação.",
                },
                limit: { type: "integer", minimum: 1, maximum: 50 },
            },
            required: [
                "query",
                "doctor_name",
                "unit_name",
                "start_date",
                "end_date",
                "future_only",
                "statuses",
                "limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_schedule_overview",
        description:
            "Retorna os agendamentos do CliniSys no período por situação, dia e unidade, incluindo cancelados, comparecimento, atendidos, faltas, remarcados, pendentes, taxa de comparecimento e taxa de cancelamento. Use para qualquer pergunta agregada sobre agenda.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD; null usa os últimos 30 dias.",
                },
                date_to: {
                    type: ["string", "null"],
                    description:
                        "YYYY-MM-DD; no mês atual use hoje, salvo pedido explícito de datas futuras.",
                },
                unit_name: { type: ["string", "null"] },
                include_future: {
                    type: "boolean",
                    description:
                        "true somente quando o usuário pedir próximos, futuros ou o mês completo incluindo datas futuras.",
                },
            },
            required: [
                "date_from",
                "date_to",
                "unit_name",
                "include_future",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "search_conversations",
        description:
            "Localiza conversas por cliente, unidade, período e resultado da análise.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: ["string", "null"] },
                client_id: { type: ["string", "null"] },
                unit_name: { type: ["string", "null"] },
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
                final_state: { type: ["string", "null"] },
                goal_status: { type: ["string", "null"] },
                dropoff_only: { type: "boolean" },
                limit: { type: "integer", minimum: 1, maximum: 30 },
            },
            required: [
                "query",
                "client_id",
                "unit_name",
                "date_from",
                "date_to",
                "final_state",
                "goal_status",
                "dropoff_only",
                "limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_conversation_context",
        description:
            "Carrega análise e transcrição de uma conversa e gera seu card clicável. Use para validar exemplos e evidências.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                conversation_id: { type: "string" },
            },
            required: ["conversation_id"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_conversation_analysis_overview",
        description:
            "Analisa conversas agregadas do WhatsApp por período e unidade, incluindo cobertura e a situação das conversas ainda sem análise: aguardando encerramento, na fila, em processamento ou sem conteúdo suficiente/com falha. Também cobre agendamento, objeções, abandono, resolução, satisfação e qualidade. Use para explicar por que clientes não agendaram ou por que conversas não foram analisadas.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                channel: {
                    type: "string",
                    enum: ["WhatsApp"],
                },
                relative_days: {
                    type: ["integer", "null"],
                    minimum: 1,
                    maximum: 365,
                    description:
                        "Use N para pedidos de últimos N dias; o servidor inclui hoje no período. Use null para datas explícitas.",
                },
                date_from: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD; null usa os últimos 30 dias.",
                },
                date_to: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD; null usa hoje.",
                },
                unit_name: { type: ["string", "null"] },
                include_example: {
                    type: "boolean",
                    description:
                        "Use true quando uma conversa real ajudar a sustentar a conclusão principal.",
                },
            },
            required: [
                "channel",
                "relative_days",
                "date_from",
                "date_to",
                "unit_name",
                "include_example",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "search_social_conversations",
        description:
            "Busca conversas e usuários sociais do Instagram e Facebook por período, nome de exibição, username ou texto. Use para dados de mensagens e pessoas desses canais.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: ["string", "null"] },
                channel: {
                    type: "string",
                    enum: ["all", "Instagram", "Facebook"],
                },
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
                limit: { type: "integer", minimum: 1, maximum: 30 },
            },
            required: ["query", "channel", "date_from", "date_to", "limit"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_social_conversation_context",
        description:
            "Carrega perfil social, análise e mensagens completas de uma conversa do Instagram ou Facebook. Use depois de search_social_conversations para inspecionar uma conversa específica.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                conversation_id: { type: "string" },
            },
            required: ["conversation_id"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "analyze_unit_performance",
        description:
            "Analisa conversão, metas, resolução, abandono, satisfação, qualidade, tempos e motivos de uma unidade contra o benchmark geral.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                unit_name: { type: "string" },
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
                include_examples: {
                    type: "boolean",
                    description:
                        "Mantenha true. A ferramenta gera uma conversa candidata e o servidor escolhe apenas a evidência mais relevante da resposta inteira.",
                },
            },
            required: [
                "unit_name",
                "date_from",
                "date_to",
                "include_examples",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "compare_unit_performance",
        description:
            "Compara todas as unidades por agendamento, resolução, abandono, satisfação, qualidade e velocidade.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
                minimum_conversations: {
                    type: "integer",
                    minimum: 1,
                    maximum: 10000,
                },
            },
            required: [
                "date_from",
                "date_to",
                "minimum_conversations",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_financial_overview",
        description:
            "Consulta NFS-e do CliniSys e retorna faturamento autorizado, cancelamentos, ticket, pacientes, evolução e rankings por status, categoria, unidade, médico e origem. Use para qualquer pergunta financeira. Pode ser combinada com get_business_overview para cruzar faturamento e operação.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD; null usa os últimos 30 dias.",
                },
                date_to: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD; null usa hoje.",
                },
                unit_name: { type: ["string", "null"] },
                doctor_name: { type: ["string", "null"] },
                categories: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Valores aceitos: ivf, freezing, storage, genetics, embryo_transfer, evaluation, exams, bank_donation e other.",
                },
            },
            required: [
                "date_from",
                "date_to",
                "unit_name",
                "doctor_name",
                "categories",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_paid_media_overview",
        description:
            "Consulta Google Ads e Meta Ads e retorna investimento, impressões, cliques, CTR, CPC, conversões reportadas, resultados reais atribuídos no CliniSys, ROAS, custo por agendamento/paciente, comparação anterior, evolução, eficiência por plataforma, campanhas e o pipeline completo até faturamento autorizado. Use para qualquer pergunta sobre mídia paga, anúncios ou a jornada originada por Google/Meta.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD; null usa os últimos 30 dias.",
                },
                date_to: {
                    type: ["string", "null"],
                    description: "YYYY-MM-DD; null usa hoje.",
                },
                platform: {
                    type: "string",
                    enum: ["all", "google_ads", "meta_ads"],
                },
                top_campaigns_limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 20,
                },
            },
            required: [
                "date_from",
                "date_to",
                "platform",
                "top_campaigns_limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_funnel_overview",
        description:
            "Retorna a posição atual dos clientes por funil/etapa e os KPIs de jornada do CliniSys no período. Use para perguntas sobre /funil, quantidade por etapa, avaliações, procedimentos ou comparecimento da jornada.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa os últimos 30 dias para KPIs de jornada." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                unit_name: { type: ["string", "null"] },
            },
            required: ["date_from", "date_to", "unit_name"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_active_message_overview",
        description:
            "Consulta Mensagem Ativa e automações como resgate: lotes, mensagens enviadas, respostas, agendamentos, desempenho por template/automação e execuções recentes.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa os últimos 30 dias." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                automation: { type: ["string", "null"], description: "null/all = tudo; resgate = somente resgate; manual = envios sem automação; ou outro nome exato." },
            },
            required: ["date_from", "date_to", "automation"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_tracking_events_overview",
        description:
            "Consulta a tela Eventos e o pipeline de eventos enviados pelo Hub para Meta Ads/Google Ads: enviados, falhas, cobertura fbclid/gclid, tipos, plataformas, status e evolução. Para investimento/campanhas use get_paid_media_overview.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa os últimos 30 dias." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                unit_name: { type: ["string", "null"] },
                platform: { type: "string", enum: ["all", "meta_ads", "google_ads"] },
                event_types: { type: "array", items: { type: "string", enum: ["lead", "schedule"] } },
                statuses: { type: "array", items: { type: "string", enum: ["sent", "failed"] } },
                sources: { type: "array", items: { type: "string" } },
                tunnels: { type: "array", items: { type: "string" } },
                origins: { type: "array", items: { type: "string" } },
            },
            required: ["date_from", "date_to", "unit_name", "platform", "event_types", "statuses", "sources", "tunnels", "origins"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_internal_team_overview",
        description:
            "Consulta o diretório interno do Hub para saber quem está online/offline, função e fila. Use para perguntas sobre equipe interna ou disponibilidade de atendentes. É somente leitura.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: ["string", "null"], description: "Nome, função ou fila; null retorna visão geral." },
                status: { type: "string", enum: ["all", "online", "offline"] },
            },
            required: ["query", "status"],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "search_conversation_content",
        description:
            "Pesquisa palavras ou frases no conteúdo real das mensagens de WhatsApp, Instagram e Facebook usando o índice canônico do Hub e valida os trechos na transcrição. Use quando o usuário perguntar quem falou algo, procurar frases/termos ou pedir exemplos textuais completos.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                query: { type: "string" },
                channel: {
                    type: "string",
                    enum: ["all", "WhatsApp", "Instagram", "Facebook"],
                },
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD" },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD" },
                unit_name: { type: ["string", "null"] },
                match_mode: { type: "string", enum: ["all", "any"] },
                exact_phrase: {
                    type: "boolean",
                    description: "true quando a ordem exata das palavras precisa aparecer em uma mesma mensagem.",
                },
                limit: { type: "integer", minimum: 1, maximum: 50 },
            },
            required: [
                "query",
                "channel",
                "date_from",
                "date_to",
                "unit_name",
                "match_mode",
                "exact_phrase",
                "limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_cancellation_analysis",
        description:
            "Analisa cancelamentos e remarcações da agenda e cruza os pacientes com evidências textuais reais das conversas de WhatsApp. Use para motivos de cancelamento/remarcação, especialmente de primeiras avaliações; não inventa motivo quando a agenda não possui evidência.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa últimos 30 dias." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                unit_name: { type: ["string", "null"] },
                procedure_type: {
                    type: "string",
                    enum: ["all", "first_evaluation"],
                },
                include_evidence: { type: "boolean" },
                evidence_limit: { type: "integer", minimum: 1, maximum: 25 },
            },
            required: [
                "date_from",
                "date_to",
                "unit_name",
                "procedure_type",
                "include_evidence",
                "evidence_limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_meta_attribution_overview",
        description:
            "Consulta atribuições reais de anúncios recebidas do Zernio/Meta por campanha e conjunto, cruza a cidade esperada pelo mapa do Financeiro com instagram_users.location e informa cobertura, ausências e divergências. Use para origem de Instagram/Facebook por campanha, conjunto ou cidade.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD; null usa últimos 30 dias." },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD; null usa hoje." },
                channel: { type: "string", enum: ["all", "Instagram", "Facebook"] },
                campaign_query: { type: ["string", "null"] },
                ad_set_query: { type: ["string", "null"] },
                city: { type: ["string", "null"] },
            },
            required: [
                "date_from",
                "date_to",
                "channel",
                "campaign_query",
                "ad_set_query",
                "city",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "create_csv_export",
        description:
            "Cria um arquivo CSV real e seguro para download com clientes, agendamentos ou conversas filtradas. Use somente quando o usuário pedir explicitamente exportar, baixar, CSV ou planilha.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                dataset: { type: "string", enum: ["clients", "schedules", "conversations"] },
                date_from: { type: ["string", "null"], description: "YYYY-MM-DD" },
                date_to: { type: ["string", "null"], description: "YYYY-MM-DD" },
                unit_name: { type: ["string", "null"] },
                query: { type: ["string", "null"] },
                channel: { type: "string", enum: ["all", "WhatsApp", "Instagram", "Facebook"] },
                statuses: { type: "array", items: { type: "string" } },
                non_scheduled_only: { type: "boolean" },
                limit: { type: "integer", minimum: 1, maximum: 5000 },
            },
            required: [
                "dataset",
                "date_from",
                "date_to",
                "unit_name",
                "query",
                "channel",
                "statuses",
                "non_scheduled_only",
                "limit",
            ],
            additionalProperties: false,
        },
    },
    {
        type: "function",
        name: "get_business_overview",
        description:
            "Retorna visão macro de clientes, conversas, análises, agendamentos, threads abertas, mensagens ativas, follow-ups e unidades.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                date_from: { type: ["string", "null"] },
                date_to: { type: ["string", "null"] },
            },
            required: ["date_from", "date_to"],
            additionalProperties: false,
        },
    },
] as const;
