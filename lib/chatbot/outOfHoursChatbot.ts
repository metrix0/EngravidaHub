// lib/chatbot/outOfHoursChatbot.ts
import OpenAI from "openai";
import { z } from "zod";

import { CHATBOT_KNOWLEDGE_SOURCE } from "@/lib/chatbot/knowledgeBase";

export const CHATBOT_STAGES = [
    "menu",
    "lgbtqia",
    "lgbtqia_mulheres",
    "lgbtqia_homens",
    "lgbtqia_trans",
    "producao_independente",
    "laqueadura",
    "infertilidade",
    "congelamento",
] as const;

export type ChatbotStage = (typeof CHATBOT_STAGES)[number];

type KnowledgeTopic =
    | "lgbtqia"
    | "laqueadura"
    | "infertilidade"
    | "congelamento"
    | "geral";

type ConversationStage = Exclude<ChatbotStage, "menu">;

type KnowledgeEntry = {
    id: string;
    alias: string;
    topic: KnowledgeTopic;
    text: string;
    searchText: string;
};

export type ChatbotOption = {
    id: string;
    label: string;
};

export type OutOfHoursChatbotReply = {
    ok: true;
    action: "reply" | "show_menu" | "queue_human";
    route: "deterministic" | "ai" | "fallback";
    stage: ChatbotStage;
    reply: string;
    options: ChatbotOption[];
    has_options: boolean;
    ai_used: boolean;
    knowledge_ids: string[];
    blip_message: {
        type: "text/plain";
        content: string;
    };
    blip_menu_content: {
        text: string;
        options: Array<{
            text: string;
            previewText: string;
            value: string;
            index: number;
            type: "text/plain";
        }>;
        limitMenu: false;
    } | null;
};

const MODEL = "gpt-5.6-luna";
const MAX_KNOWLEDGE_CANDIDATES = 16;
const MAX_CANDIDATE_CHARACTERS = 14_000;
const MAX_ENTRY_PROMPT_CHARACTERS = 2_200;
const MAX_REPLY_CHARACTERS = 3_800;

const MAIN_MENU_OPTIONS: ChatbotOption[] = [
    { id: "topic:lgbtqia", label: "Casais LGBTQIA+" },
    { id: "topic:laqueadura", label: "Laqueadura" },
    { id: "topic:infertilidade", label: "Não consigo engravidar" },
    { id: "topic:congelamento", label: "Congelamento de óvulos" },
    { id: "topic:other", label: "Outra dúvida" },
];

const LGBTQIA_DETAIL_OPTIONS: ChatbotOption[] = [
    { id: "common:price", label: "Valores" },
    { id: "common:payment", label: "Formas de pagamento" },
    { id: "common:units", label: "Unidades" },
    { id: "common:schedule", label: "Agendar consulta" },
    { id: "common:other", label: "Outra dúvida" },
    { id: "common:menu", label: "Voltar ao menu" },
];

const TOPIC_OPTIONS: Record<ConversationStage, ChatbotOption[]> = {
    lgbtqia: [
        { id: "lgbtqia:women", label: "Casal de mulheres" },
        { id: "lgbtqia:men", label: "Casal de homens" },
        { id: "lgbtqia:trans", label: "Pessoa trans" },
        { id: "lgbtqia:independent", label: "Produção independente" },
        { id: "common:units", label: "Unidades" },
        { id: "common:schedule", label: "Agendar consulta" },
        { id: "common:other", label: "Outra dúvida" },
        { id: "common:menu", label: "Voltar ao menu" },
    ],
    lgbtqia_mulheres: LGBTQIA_DETAIL_OPTIONS,
    lgbtqia_homens: LGBTQIA_DETAIL_OPTIONS,
    lgbtqia_trans: LGBTQIA_DETAIL_OPTIONS,
    producao_independente: LGBTQIA_DETAIL_OPTIONS,
    laqueadura: [
        { id: "laqueadura:age:36", label: "Até 36 anos" },
        { id: "laqueadura:age:37-42", label: "37 a 42 anos" },
        { id: "laqueadura:age:43", label: "43 anos" },
        { id: "laqueadura:age:44-47", label: "44 a 47 anos" },
        { id: "laqueadura:age:48", label: "48 anos ou mais" },
        { id: "common:price", label: "Valores da FIV" },
        { id: "common:units", label: "Unidades" },
        { id: "common:other", label: "Outra dúvida" },
        { id: "common:menu", label: "Voltar ao menu" },
    ],
    infertilidade: [
        { id: "infertilidade:known", label: "Já sei a causa" },
        { id: "infertilidade:unknown", label: "Ainda não sei" },
        { id: "common:price", label: "Valores da FIV" },
        { id: "common:units", label: "Unidades" },
        { id: "common:schedule", label: "Agendar consulta" },
        { id: "common:other", label: "Outra dúvida" },
        { id: "common:menu", label: "Voltar ao menu" },
    ],
    congelamento: [
        { id: "common:price", label: "Valores" },
        { id: "congelamento:age", label: "Idade ideal" },
        { id: "congelamento:duration", label: "Tempo de congelamento" },
        { id: "congelamento:included", label: "O que está incluído" },
        { id: "common:units", label: "Unidades" },
        { id: "common:schedule", label: "Agendar consulta" },
        { id: "common:other", label: "Outra dúvida" },
        { id: "common:menu", label: "Voltar ao menu" },
    ],
};

const TOPIC_LABELS: Record<ConversationStage, string> = {
    lgbtqia: "opções para pessoas LGBTQIA+",
    lgbtqia_mulheres: "tratamento para casal de mulheres",
    lgbtqia_homens: "tratamento para casal de homens",
    lgbtqia_trans: "tratamento para pessoa trans",
    producao_independente: "produção independente",
    laqueadura: "gravidez após laqueadura",
    infertilidade: "dificuldade para engravidar",
    congelamento: "congelamento de óvulos",
};

const NO_SEPARATOR_ALIASES = new Set([
    "40a",
    "65a",
    "38a",
    "39a",
    "37a",
    "42a",
    "41a",
    "60%",
    "rsp",
    "iiu + semiiu",
    "meno + ovo",
    "blog",
    "medicos",
    "exameh",
    "examem",
    "pagamento antecipado / online e sabados",
    "mutir -",
]);

const STOP_WORDS = new Set([
    "a",
    "ao",
    "aos",
    "as",
    "com",
    "como",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "ela",
    "ele",
    "em",
    "eu",
    "fazer",
    "gostaria",
    "isso",
    "me",
    "meu",
    "minha",
    "na",
    "nas",
    "no",
    "nos",
    "o",
    "os",
    "ou",
    "para",
    "pode",
    "posso",
    "por",
    "qual",
    "que",
    "quero",
    "saber",
    "se",
    "sobre",
    "tem",
    "tenho",
    "um",
    "uma",
    "voce",
    "voces",
]);

const SHARED_ALIASES = new Set(["ert"]);

const knowledgeEntries = parseKnowledgeEntries(CHATBOT_KNOWLEDGE_SOURCE);
let openaiClient: OpenAI | null = null;

const aiSelectionSchema = z
    .object({
        answerable: z.boolean(),
        knowledge_ids: z.array(z.string()).max(3),
        needs_human: z.boolean(),
    })
    .strict();

export async function routeOutOfHoursChatbot({
    message,
    stage,
    signal,
}: {
    message: string;
    stage: ChatbotStage;
    signal?: AbortSignal;
}): Promise<OutOfHoursChatbotReply> {
    const normalizedMessage = normalize(message);

    if (isMenuRequest(normalizedMessage)) {
        return mainMenuReply();
    }

    if (isHumanRequest(normalizedMessage)) {
        return queueHumanReply(stage);
    }

    const selectedOption = findSelectedOption(normalizedMessage, stage);
    if (selectedOption) {
        const optionReply = routeSelectedOption(selectedOption.id, stage);
        if (optionReply) return optionReply;
    }

    const directTopic = detectTopic(normalizedMessage);
    if (
        directTopic &&
        (stage === "menu" || knowledgeTopicForStage(stage) !== directTopic)
    ) {
        return topicIntroduction(directTopic);
    }

    if (stage === "menu" && isGreeting(normalizedMessage)) {
        return mainMenuReply();
    }

    const commonReply = routeCommonQuestion(normalizedMessage, stage);
    if (commonReply) return commonReply;

    return answerWithKnowledgeSelection(message, stage, signal);
}

export function normalizeChatbotStage(value: unknown): ChatbotStage {
    const normalized = normalize(String(value ?? ""));
    return CHATBOT_STAGES.find((stage) => stage === normalized) ?? "menu";
}

export function getChatbotKnowledgeEntryCount() {
    return knowledgeEntries.length;
}

function mainMenuReply() {
    return buildReply({
        action: "show_menu",
        route: "deterministic",
        stage: "menu",
        reply:
            "Olá! Nosso time está fora do horário de atendimento, mas posso adiantar seu atendimento agora. Sobre qual assunto você quer falar?",
        options: MAIN_MENU_OPTIONS,
    });
}

function topicIntroduction(
    stage: ConversationStage,
): OutOfHoursChatbotReply {
    if (stage === "lgbtqia") {
        return buildReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply: "Qual situação descreve melhor o que você procura?",
            options: TOPIC_OPTIONS[stage],
        });
    }

    if (stage === "laqueadura") {
        return fromKnowledge({
            stage,
            aliases: ["qwe", "cvb"],
            options: TOPIC_OPTIONS[stage],
        });
    }

    if (stage === "infertilidade") {
        return fromKnowledge({
            stage,
            aliases: ["zxc", "jac"],
            options: TOPIC_OPTIONS[stage],
        });
    }

    return fromKnowledge({
        stage,
        aliases: ["congg", "ddd"],
        options: TOPIC_OPTIONS[stage],
    });
}

function routeSelectedOption(
    optionId: string,
    stage: ChatbotStage,
): OutOfHoursChatbotReply | null {
    if (optionId === "common:menu") return mainMenuReply();

    if (optionId.startsWith("topic:")) {
        const nextStage = optionId.slice("topic:".length);
        if (nextStage === "other") {
            return askForFreeText("menu");
        }
        if (isTopicStage(nextStage)) return topicIntroduction(nextStage);
    }

    if (optionId === "common:other") return askForFreeText(stage);
    if (optionId === "common:units" && stage !== "menu") {
        return fromKnowledge({ stage, aliases: ["ert"] });
    }
    if (optionId === "common:schedule" && stage !== "menu") {
        return appointmentReply(stage);
    }
    if (optionId === "common:price" && stage !== "menu") {
        return topicPriceReply(stage);
    }
    if (optionId === "common:payment" && stage !== "menu") {
        return fromKnowledge({ stage, aliases: ["boleto"] });
    }

    if (stage === "lgbtqia") {
        if (optionId === "lgbtqia:women") {
            return fromKnowledge({
                stage: "lgbtqia_mulheres",
                aliases: ["rty", "bnm"],
            });
        }
        if (optionId === "lgbtqia:men") {
            return fromKnowledge({
                stage: "lgbtqia_homens",
                aliases: ["masc1", "masc2"],
            });
        }
        if (optionId === "lgbtqia:trans") {
            return fromKnowledge({
                stage: "lgbtqia_trans",
                aliases: ["trans"],
            });
        }
        if (optionId === "lgbtqia:independent") {
            return fromKnowledge({
                stage: "producao_independente",
                aliases: ["prod"],
            });
        }
    }

    if (stage === "laqueadura") {
        if (optionId === "laqueadura:age:36") {
            return fromKnowledge({ stage, aliases: ["60%"] });
        }
        if (optionId === "laqueadura:age:37-42") {
            return fromKnowledge({ stage, aliases: ["chances"] });
        }
        if (optionId === "laqueadura:age:43") {
            return fromKnowledge({ stage, aliases: ["43a", "456/limite"] });
        }
        if (optionId === "laqueadura:age:44-47") {
            return fromKnowledge({ stage, aliases: ["567/acima", "789"] });
        }
        if (optionId === "laqueadura:age:48") {
            return fromKnowledge({ stage, aliases: ["567/acima", "50a"] });
        }
    }

    if (stage === "infertilidade") {
        if (optionId === "infertilidade:known") {
            return fromKnowledge({ stage, aliases: ["qual"] });
        }
        if (optionId === "infertilidade:unknown") {
            return fromKnowledge({ stage, aliases: ["sdf /invest", "wer"] });
        }
    }

    if (stage === "congelamento") {
        if (optionId === "congelamento:age") {
            return fromKnowledge({ stage, aliases: ["ddd"] });
        }
        if (optionId === "congelamento:duration") {
            return fromKnowledge({ stage, aliases: ["fff"] });
        }
        if (optionId === "congelamento:included") {
            return fromKnowledge({ stage, aliases: ["congg"] });
        }
    }

    return null;
}

function routeCommonQuestion(
    message: string,
    stage: ChatbotStage,
): OutOfHoursChatbotReply | null {
    if (stage === "laqueadura") {
        const age = extractAge(message);
        if (age !== null) return laqueaduraAgeReply(age);
    }

    if (stage === "menu") return null;

    if (/\b(valor|valores|custa|custo|preco|precos|quanto fica)\b/.test(message)) {
        return topicPriceReply(stage);
    }

    if (/\b(unidade|unidades|endereco|enderecos|cidade|localizacao|onde fica)\b/.test(message)) {
        return fromKnowledge({ stage, aliases: ["ert"] });
    }

    if (/\b(consulta|consultar|avaliacao)\b/.test(message)) {
        return fromKnowledge({ stage, aliases: ["consulta"] });
    }

    if (/\b(agendar|agendamento|marcar horario|marcar consulta)\b/.test(message)) {
        return appointmentReply(stage);
    }

    if (/\b(parcelar|parcelamento|boleto|pix|forma de pagamento)\b/.test(message)) {
        return fromKnowledge({ stage, aliases: ["boleto"] });
    }

    return null;
}

function topicPriceReply(stage: ConversationStage) {
    if (stage === "lgbtqia") {
        return buildReply({
            action: "show_menu",
            route: "deterministic",
            stage,
            reply:
                "O valor depende do tratamento e da situação. Escolha uma das opções abaixo para eu informar corretamente.",
            options: TOPIC_OPTIONS[stage],
        });
    }
    if (stage === "congelamento") {
        return fromKnowledge({ stage, aliases: ["congg"] });
    }
    if (stage === "lgbtqia_mulheres") {
        return fromKnowledge({ stage, aliases: ["fgh"] });
    }
    if (stage === "lgbtqia_homens") {
        return fromKnowledge({ stage, aliases: ["masc3"] });
    }
    if (stage === "lgbtqia_trans") {
        return fromKnowledge({ stage, aliases: ["trans"] });
    }
    if (stage === "producao_independente") {
        return fromKnowledge({ stage, aliases: ["prod"] });
    }
    return fromKnowledge({ stage, aliases: ["asd"] });
}

function laqueaduraAgeReply(age: number) {
    const stage = "laqueadura" as const;
    if (age <= 36) return fromKnowledge({ stage, aliases: ["60%"] });
    if (age >= 37 && age <= 42) {
        const exactAlias = `${age}a`;
        return fromKnowledge({ stage, aliases: [exactAlias, "chances"] });
    }
    if (age === 43) {
        return fromKnowledge({ stage, aliases: ["43a", "456/limite"] });
    }
    if (age <= 47) {
        return fromKnowledge({ stage, aliases: ["567/acima", "789"] });
    }
    return fromKnowledge({ stage, aliases: ["567/acima", "50a"] });
}

function askForFreeText(stage: ChatbotStage) {
    const suffix =
        stage === "menu" ? "" : ` sobre ${TOPIC_LABELS[stage]}`;
    return buildReply({
        action: "reply",
        route: "deterministic",
        stage,
        reply: `Pode escrever sua dúvida${suffix}. Vou responder somente com as informações aprovadas pela Engravida.`,
        options: optionsForStage(stage),
    });
}

function queueHumanReply(stage: ChatbotStage) {
    return buildReply({
        action: "queue_human",
        route: "deterministic",
        stage,
        reply:
            "Certo. Vou encaminhar sua conversa para nosso time continuar o atendimento assim que estiver disponível.",
        options: [],
    });
}

function unsupportedQuestionReply(stage: ChatbotStage) {
    const technicalFallback = findEntry("geral", "tecnica")?.text;
    return buildReply({
        action: "queue_human",
        route: "fallback",
        stage,
        reply: [
            technicalFallback ??
                "Essa dúvida precisa ser confirmada com um especialista.",
            "Vou encaminhar sua conversa para nosso time continuar o atendimento assim que estiver disponível.",
        ].join("\n\n"),
        options: [],
    });
}

function appointmentReply(stage: ConversationStage) {
    const link = appointmentLink(stage);
    if (!link) return fromKnowledge({ stage, aliases: ["seguir"] });

    return buildReply({
        action: "reply",
        route: "deterministic",
        stage,
        reply: `Se desejar agendar uma consulta, clique no link a seguir e envie a mensagem pelo nosso WhatsApp: ${link}`,
        options: TOPIC_OPTIONS[stage],
    });
}

function appointmentLink(stage: ConversationStage) {
    const labels: Record<ConversationStage, string> = {
        lgbtqia: "LGBT (SELG)",
        lgbtqia_mulheres: "LGBT (SELG)",
        lgbtqia_homens: "LGBT (SELG)",
        lgbtqia_trans: "LGBT (SELG)",
        producao_independente: "LGBT (SELG)",
        laqueadura: "Laqueadura (SELA)",
        congelamento: "Congelamento (SECO)",
        infertilidade: "Problemas (SEPR)",
    };
    const label = escapeRegExp(labels[stage]);
    const match = CHATBOT_KNOWLEDGE_SOURCE.match(
        new RegExp(`${label}\\s+\\n?(https:\\/\\/clinica\\.engravida\\.com\\.br\\/direct-\\d+)`, "i"),
    );
    return match?.[1] ?? null;
}

function fromKnowledge({
    stage,
    aliases,
    options = TOPIC_OPTIONS[stage],
}: {
    stage: ConversationStage;
    aliases: string[];
    options?: ChatbotOption[];
}) {
    const entries = fitKnowledgeEntries(
        aliases
            .map((alias) => {
                const scopedEntry =
                    findEntry(knowledgeTopicForStage(stage), alias) ??
                    findEntry("geral", alias);
                if (
                    scopedEntry ||
                    !SHARED_ALIASES.has(normalizeAlias(alias))
                ) {
                    return scopedEntry;
                }
                const wanted = normalizeAlias(alias);
                return knowledgeEntries.find(
                    (entry) => normalizeAlias(entry.alias) === wanted,
                );
            })
            .filter((entry): entry is KnowledgeEntry => Boolean(entry)),
    );

    if (entries.length === 0) return unsupportedQuestionReply(stage);

    return buildReply({
        action: "reply",
        route: "deterministic",
        stage,
        reply: entries.map((entry) => entry.text).join("\n\n"),
        options,
        knowledgeIds: entries.map((entry) => entry.id),
    });
}

async function answerWithKnowledgeSelection(
    message: string,
    stage: ChatbotStage,
    signal?: AbortSignal,
) {
    const candidates = retrieveKnowledgeCandidates(message, stage);
    if (candidates.length === 0 || !process.env.OPENAI_API_KEY) {
        return unsupportedQuestionReply(stage);
    }

    try {
        const client = getOpenAIClient();
        const response = await client.responses.create(
            {
                model: MODEL,
                store: false,
                reasoning: { effort: "low" },
                instructions: [
                    "Você é somente um seletor de trechos aprovados para um chatbot da Engravida.",
                    "Nunca escreva a resposta ao cliente e nunca use conhecimento próprio.",
                    "Marque answerable=true apenas quando os trechos fornecidos respondem explicitamente à dúvida.",
                    "Retorne somente IDs existentes na lista, na ordem em que devem ser enviados, sem duplicar.",
                    "Use no máximo 3 IDs. Se a base não contiver a resposta técnica completa, use answerable=false, knowledge_ids=[] e needs_human=true.",
                    "Perguntas médicas, legais, de preço ou de indicação exigem apoio literal nos trechos.",
                ].join("\n"),
                input: [
                    {
                        role: "user",
                        content: JSON.stringify({
                            current_stage: stage,
                            customer_message: message,
                            approved_knowledge: candidates.map((entry) => ({
                                id: entry.id,
                                topic: entry.topic,
                                text: entry.text.slice(
                                    0,
                                    MAX_ENTRY_PROMPT_CHARACTERS,
                                ),
                            })),
                        }),
                    },
                ],
                max_output_tokens: 220,
                text: {
                    format: {
                        type: "json_schema",
                        name: "engravida_chatbot_knowledge_selection",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                answerable: { type: "boolean" },
                                knowledge_ids: {
                                    type: "array",
                                    items: { type: "string" },
                                    maxItems: 3,
                                },
                                needs_human: { type: "boolean" },
                            },
                            required: [
                                "answerable",
                                "knowledge_ids",
                                "needs_human",
                            ],
                            additionalProperties: false,
                        },
                    },
                },
            },
            { signal },
        );

        const parsed = aiSelectionSchema.safeParse(
            JSON.parse(response.output_text || "{}"),
        );
        if (!parsed.success || !parsed.data.answerable) {
            return unsupportedQuestionReply(stage);
        }

        const candidatesById = new Map(
            candidates.map((entry) => [entry.id, entry]),
        );
        const selectedEntries = fitKnowledgeEntries(
            [...new Set(parsed.data.knowledge_ids)]
                .map((id) => candidatesById.get(id))
                .filter((entry): entry is KnowledgeEntry => Boolean(entry)),
        );

        if (selectedEntries.length === 0) {
            return unsupportedQuestionReply(stage);
        }

        const needsHuman = parsed.data.needs_human;
        return buildReply({
            action: needsHuman ? "queue_human" : "reply",
            route: "ai",
            stage,
            reply: [
                selectedEntries.map((entry) => entry.text).join("\n\n"),
                needsHuman
                    ? "Nosso time continuará o atendimento assim que estiver disponível."
                    : "",
            ]
                .filter(Boolean)
                .join("\n\n"),
            options: needsHuman ? [] : optionsForStage(stage),
            aiUsed: true,
            knowledgeIds: selectedEntries.map((entry) => entry.id),
        });
    } catch (error) {
        console.error("[out-of-hours-chatbot] knowledge selection failed", error);
        return unsupportedQuestionReply(stage);
    }
}

function buildReply({
    action,
    route,
    stage,
    reply,
    options,
    aiUsed = false,
    knowledgeIds = [],
}: {
    action: OutOfHoursChatbotReply["action"];
    route: OutOfHoursChatbotReply["route"];
    stage: ChatbotStage;
    reply: string;
    options: ChatbotOption[];
    aiUsed?: boolean;
    knowledgeIds?: string[];
}): OutOfHoursChatbotReply {
    const safeOptions = options.slice(0, 10);
    const blipMenuContent: OutOfHoursChatbotReply["blip_menu_content"] =
        safeOptions.length === 0
            ? null
            : {
                  text: "Escolha uma opção ou escreva sua dúvida:",
                  options: safeOptions.map((option, index) => ({
                      text: option.label,
                      previewText: option.label,
                      value: option.id,
                      index,
                      type: "text/plain",
                  })),
                  limitMenu: false,
              };

    return {
        ok: true,
        action,
        route,
        stage,
        reply,
        options: safeOptions,
        has_options: safeOptions.length > 0,
        ai_used: aiUsed,
        knowledge_ids: knowledgeIds,
        blip_message: { type: "text/plain", content: reply },
        blip_menu_content: blipMenuContent,
    };
}

function optionsForStage(stage: ChatbotStage) {
    return stage === "menu" ? MAIN_MENU_OPTIONS : TOPIC_OPTIONS[stage];
}

function findSelectedOption(message: string, stage: ChatbotStage) {
    const available = optionsForStage(stage);
    return available.find(
        (option) =>
            normalize(option.id) === message || normalize(option.label) === message,
    );
}

function detectTopic(message: string): Exclude<ChatbotStage, "menu"> | null {
    if (/\b(laqueadura|laqueada|trompas ligadas)\b/.test(message)) {
        return "laqueadura";
    }
    if (/\b(congelamento|congelar|preservacao)\b.*\b(ovulo|ovulos|fertilidade)\b/.test(message)) {
        return "congelamento";
    }
    if (/\b(lgbt|lgbtqia|homoafetiv|casal de mulheres|duas mulheres|casal de homens|dois homens|pessoa trans)\b/.test(message)) {
        return "lgbtqia";
    }
    if (/\b(dificuldade.*engravidar|infertilidade|tentando engravidar|nao consigo engravidar|endometriose|adenomiose|ovario policistico|sop|mioma|cisto)\b/.test(message)) {
        return "infertilidade";
    }
    return null;
}

function isMenuRequest(message: string) {
    return /^(menu|voltar|voltar ao menu|inicio|começar|comecar)$/.test(message);
}

function isGreeting(message: string) {
    return /^(oi+|ola+|bom dia|boa tarde|boa noite|hey|hello|tudo bem)[!. ]*$/.test(message);
}

function isHumanRequest(message: string) {
    return /\b(atendente|atendimento humano|falar com (uma pessoa|alguem)|pessoa de verdade|humano)\b/.test(message);
}

function extractAge(message: string) {
    const match = message.match(/(?:^|\b)(\d{2})(?:\s*anos?|\b)/);
    if (!match) return null;
    const age = Number(match[1]);
    return age >= 18 && age <= 80 ? age : null;
}

function isTopicStage(value: string): value is Exclude<ChatbotStage, "menu"> {
    return value !== "menu" && CHATBOT_STAGES.includes(value as ChatbotStage);
}

function knowledgeTopicForStage(
    stage: ConversationStage,
): Exclude<KnowledgeTopic, "geral"> {
    if (
        stage === "lgbtqia" ||
        stage === "lgbtqia_mulheres" ||
        stage === "lgbtqia_homens" ||
        stage === "lgbtqia_trans" ||
        stage === "producao_independente"
    ) {
        return "lgbtqia";
    }
    return stage;
}

function getOpenAIClient() {
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
}

function retrieveKnowledgeCandidates(message: string, stage: ChatbotStage) {
    const query = expandSearchTerms(normalize(message));
    const tokens = searchTokens(query);
    const topic = stage === "menu" ? null : knowledgeTopicForStage(stage);

    const ranked = knowledgeEntries
        .map((entry) => {
            let score = 0;
            if (query && entry.searchText.includes(query)) score += 12;
            for (const token of tokens) {
                if (normalize(entry.alias).includes(token)) score += 7;
                if (entry.searchText.includes(token)) score += 2;
            }
            if (score > 0 && topic && entry.topic === topic) score += 1;
            return { entry, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));

    const selected: KnowledgeEntry[] = [];
    let characters = 0;
    for (const { entry } of ranked) {
        const promptLength = Math.min(
            entry.text.length,
            MAX_ENTRY_PROMPT_CHARACTERS,
        );
        if (
            selected.length >= MAX_KNOWLEDGE_CANDIDATES ||
            characters + promptLength > MAX_CANDIDATE_CHARACTERS
        ) {
            continue;
        }
        selected.push(entry);
        characters += promptLength;
    }
    return selected;
}

function expandSearchTerms(value: string) {
    const expansions: Array<[RegExp, string]> = [
        [/\b(custa|custo|preco|precos)\b/g, "$& valor"],
        [/\b(pagar|pagamento)\b/g, "$& boleto pix parcelamento"],
        [/\b(endereco|onde)\b/g, "$& unidade cidade localizacao"],
        [/\b(demora|duracao|tempo)\b/g, "$& dias prazo"],
        [/\b(marcar|agendar)\b/g, "$& consulta agendamento"],
        [/\b(inseminacao artificial)\b/g, "$& intrauterina iiu"],
    ];
    return expansions.reduce(
        (current, [pattern, replacement]) => current.replace(pattern, replacement),
        value,
    );
}

function searchTokens(value: string) {
    return [
        ...new Set(
            value
                .split(/[^a-z0-9%]+/)
                .filter(
                    (token) => token.length >= 2 && !STOP_WORDS.has(token),
                ),
        ),
    ];
}

function findEntry(topic: KnowledgeTopic, alias: string) {
    const wanted = normalizeAlias(alias);
    return knowledgeEntries.find(
        (entry) => entry.topic === topic && normalizeAlias(entry.alias) === wanted,
    );
}

function fitKnowledgeEntries(entries: KnowledgeEntry[]) {
    const selected: KnowledgeEntry[] = [];
    let characters = 0;
    for (const entry of entries) {
        const separatorLength = selected.length > 0 ? 2 : 0;
        if (characters + separatorLength + entry.text.length > MAX_REPLY_CHARACTERS) {
            continue;
        }
        selected.push(entry);
        characters += separatorLength + entry.text.length;
    }
    return selected;
}

function parseKnowledgeEntries(source: string) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const entries: KnowledgeEntry[] = [];
    const idCounts = new Map<string, number>();
    let topic: KnowledgeTopic = "geral";

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const section = sectionTopic(line);
        if (section) {
            topic = section;
            continue;
        }

        const heading = parseResponseHeading(line);
        if (!heading) continue;

        const body: string[] = [];
        if (heading.inlineText) body.push(heading.inlineText);

        let cursor = index + 1;
        while (cursor < lines.length) {
            const nextLine = lines[cursor];
            if (isBoldHeading(nextLine)) break;
            if (/^\s*(?:Fabio Liberman:|\(ultima postagem)/i.test(nextLine)) {
                break;
            }
            if (isInternalInstructionLine(nextLine)) break;
            body.push(nextLine);
            cursor += 1;
        }

        const text = cleanKnowledgeText(body.join("\n"));
        if (!text) continue;

        const baseId = `${topic}:${slug(heading.alias)}`;
        const count = (idCounts.get(baseId) ?? 0) + 1;
        idCounts.set(baseId, count);
        const id = count === 1 ? baseId : `${baseId}:${count}`;
        entries.push({
            id,
            alias: cleanKnowledgeText(heading.alias),
            topic,
            text,
            searchText: normalize(`${heading.alias} ${text}`),
        });
        index = cursor - 1;
    }

    return entries;
}

function sectionTopic(line: string): KnowledgeTopic | null {
    const value = normalize(line.replace(/[*_]/g, "").replace(/\\-/g, "-").trim());
    if (value === "lgbtqia+") return "lgbtqia";
    if (value === "laqueadura") return "laqueadura";
    if (value === "dificuldade para engravidar") return "infertilidade";
    if (value === "congelamento de ovulos") return "congelamento";
    if (value === "perguntas gerais" || value === "gerais") return "geral";
    return null;
}

function parseResponseHeading(line: string) {
    const match = line.match(/^\s*([\p{L}]?)\*\*(.+?)\*\*\s*(.*)$/u);
    if (!match) return null;

    const prefix = match[1] ?? "";
    let boldText = `${prefix}${match[2]}`.trim();
    let remainder = match[3].trim();
    const separatorInBold = boldText.search(/\\?=/);
    const separatorAfterBold = remainder.match(/^\\?=\s*(.*)$/);

    if (separatorInBold >= 0) {
        const inlineFromBold = boldText.slice(separatorInBold).replace(/^\\?=\s*/, "");
        boldText = boldText.slice(0, separatorInBold).trim();
        remainder = [inlineFromBold, remainder].filter(Boolean).join(" ");
    } else if (separatorAfterBold) {
        remainder = separatorAfterBold[1];
    } else if (!NO_SEPARATOR_ALIASES.has(normalizeAlias(boldText))) {
        return null;
    }

    const alias = boldText.replace(/\\-\s*$/, "-").trim();
    if (!alias || alias.length > 90) return null;

    return { alias, inlineText: remainder };
}

function isBoldHeading(line: string) {
    return /^\s*[\p{L}]?\*\*.+?\*\*/u.test(line);
}

function isInternalInstructionLine(line: string) {
    return /^\s*(?:\\?-\s*)?(?:perguntou|perguntaram|se pergunt|se pedirem|falou que|falar que|disse que|mulher que|quando pergunta|quando pergunt|inserminação artificial|inseminação artificial|explicação de|duracao do|duração do|menopausa:)/i.test(
        line,
    );
}

function cleanKnowledgeText(value: string) {
    return value
        .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, "$2")
        .replace(/\*{1,3}/g, "")
        .replace(/\\([=!._-])/g, "$1")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeAlias(value: string) {
    return normalize(value)
        .replace(/\s*\/\s*/g, "/")
        .replace(/\s+/g, " ")
        .trim();
}

function normalize(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function slug(value: string) {
    return normalizeAlias(value)
        .replace(/[^a-z0-9%]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70) || "entry";
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
