import { z } from "zod";
import { patternSignalsSchema } from "@/lib/analysis/patternSignals";

// These are the existing conversation tunnel labels, excluding the generic organic fallback.
export const INFERABLE_TUNNELS = [
    "Problemas",
    "Laqueadura",
    "LGBT",
    "Congelamento",
    "Tratamentos",
    "Bio Instagram",
    "Site - Home | Engravida",
] as const;

export const tunnelAttributionSchema = z.object({
    tunnel: z.enum(INFERABLE_TUNNELS),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.object({
        message_id: z.string(),
        quote: z.string().min(1).max(500),
    })).min(1).max(3),
}).nullable().default(null);

export type TunnelAttribution = z.infer<typeof tunnelAttributionSchema>;
type Tunnel = (typeof INFERABLE_TUNNELS)[number];
type Message = { id: string; sender_type: string; text: string };
export function isMissingTunnel(tunnel: string | null) {
    return !tunnel?.trim() || fold(tunnel.trim()) === "entrada organica";
}

export const TUNNEL_ATTRIBUTION_PROMPT = [
    "Campo tunnel_attribution: atribuição CONSERVADORA do túnel de aquisição, baseada SOMENTE em evidência explícita do CLIENTE.",
    "Use apenas estes túneis já cadastrados: Problemas, Laqueadura, LGBT, Congelamento, Tratamentos, Bio Instagram, Site - Home | Engravida.",
    "Problemas = dificuldade para engravidar/infertilidade; Laqueadura = busca sobre laqueadura/reversão; LGBT = busca explícita por reprodução LGBT/ROPA; Congelamento = preservar/congelar óvulos, sêmen ou embriões; Tratamentos = FIV, inseminação, ovodoação ou tratamento de reprodução assistida.",
    "Bio Instagram exige relato explícito de entrada pelo link da bio; Site - Home | Engravida exige relato explícito de entrada pelo site. Não infira canal de origem apenas por mencionar Instagram/site.",
    "Priorize uma origem explicitamente declarada pelo cliente sobre um assunto clínico genérico. Se dois túneis forem igualmente plausíveis, não escolha.",
    "Não use ofertas do bot/atendente, menus, nomes de unidades, demografia presumida, palavras isoladas ou mensagens negadas como prova.",
    "Se houver apenas 'Entrada Organica' ou nenhum sinal específico, NÃO atribua Entrada Organica: use null.",
    "Somente atribua quando houver confiança >= 0.90 e até 3 citações LITERAIS de mensagens do cliente, com message_id correto; sem evidência inequívoca, retorne null.",
].join("\n");

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const literal = (text: string) => text.replace(/\s+/g, " ").trim();

const supportingEvidence: Record<(typeof INFERABLE_TUNNELS)[number], RegExp> = {
    Problemas: /dificuldad|nao (?:consig|conseg)|nao engravid|tentando engravid|infertil|problema para engravid|abortos? recorrentes?/,
    Laqueadura: /laqueadur|reversa[oã] de ligadura|reverte[r]? (?:a )?ligadura|trompas? ligadas?/,
    LGBT: /\bropa\b|\blgbt\w*|duas mulheres|dois homens|casal de mulheres|casal de homens|homoafetiv/,
    Congelamento: /congel|criopreserv|preserv[a-z ]{0,18}fertilidad|guardar (?:meus? )?(?:ovulos|embrioes|semen)/,
    Tratamentos: /tratament|fertilizacao in vitro|insemin|ovodoa|ovorecep|doacao de (?:ovulos|semen|esperma|embrio|espermatozoide)|reproducao assistida|\bfiv\b|transferencia de embr/,
    "Bio Instagram": /\bbio\b/,
    "Site - Home | Engravida": /\bsite\b|\bpagina (?:da |de )?(?:engravida|voces)\b|\bhome\b/,
};

// Require a stated acquisition path, not a casual mention of the site or bio.
const explicitOriginEvidence: Partial<Record<(typeof INFERABLE_TUNNELS)[number], RegExp>> = {
    "Bio Instagram": /\b(?:vim|cheguei|conheci|encontrei|achei|entrei|acessei|descobri|cliquei|fui direcionad[ao])\b.{0,60}?\b(?:pelo|pela|no|na|via|atraves d[ao])\b.{0,25}?\b(?:link (?:da|na) )?bio\b/,
    "Site - Home | Engravida": /\b(?:vim|cheguei|conheci|encontrei|achei|entrei|acessei|descobri|cliquei|fui direcionad[ao])\b.{0,60}?\b(?:pelo|pela|no|na|via|atraves d[ao])\b.{0,25}?\bsite\b/,
};

const negatedOrUncertainIntent = /\b(?:nao (?:quero|desejo|busco|pretendo|preciso|gostaria|tenho interesse|sei se quero|tenho certeza se quero|vim|cheguei|acessei|cliquei|entrei|encontrei|conheci|achei|fui direcionad[ao])|sem interesse|nunca quis)\b/;

function hasAffirmativeSupport(tunnel: (typeof INFERABLE_TUNNELS)[number], text: string): boolean {
    const matcher = explicitOriginEvidence[tunnel] ?? supportingEvidence[tunnel];
    return fold(text).split(/[,;.!?\n]|\b(?:mas|porem|contudo)\b/).some(clause =>
        !negatedOrUncertainIntent.test(clause) && matcher.test(clause));
}

// The quote must actually occur in a client message. A model confidence score
// without an independently checkable excerpt is never enough for attribution.
export function validateTunnelAttribution(raw: unknown, messages: Message[]): TunnelAttribution {
    const parsed = tunnelAttributionSchema.safeParse(raw);
    if (!parsed.success || !parsed.data || parsed.data.confidence < 0.90) return null;

    const attribution = parsed.data;
    const messageById = new Map(messages.map(message => [message.id, message]));
    if (attribution.evidence.some(item => {
        const message = messageById.get(item.message_id);
        return !message || message.sender_type !== "client" ||
            !literal(item.quote) || !literal(message.text).includes(literal(item.quote));
    })) return null;

    // Reject citations that have no concrete connection to the selected tunnel.
    if (!attribution.evidence.some(item =>
        supportingEvidence[attribution.tunnel].test(fold(item.quote)) &&
        hasAffirmativeSupport(attribution.tunnel, messageById.get(item.message_id)!.text))) return null;
    return attribution;
}

const legacyTreatmentTunnels: Record<string, Tunnel> = {
    egg_freezing: "Congelamento",
    embryo_freezing: "Congelamento",
    semen_freezing: "Congelamento",
    sperm_freezing: "Congelamento",
    tubal_ligation_reversal: "Laqueadura",
    reversao_laqueadura: "Laqueadura",
    reversal_laqueadura: "Laqueadura",
    laqueadura: "Laqueadura",
    ropa: "LGBT",
    rop: "LGBT",
    lgbtqia_options: "LGBT",
    opcoes_lgbtqia: "LGBT",
    fiv: "Tratamentos",
    egg_donation: "Tratamentos",
    ovodoacao: "Tratamentos",
    ovorecepcao: "Tratamentos",
    insemination: "Tratamentos",
    semen_donation: "Tratamentos",
    sperm_donation: "Tratamentos",
    embryo_transfer: "Tratamentos",
    embryo_donation: "Tratamentos",
};

// Historical individual analyses already contain verified, customer-sourced
// treatment signals. Never guess if they point to different possible tunnels.
export function inferTunnelFromAnalysis(analysis: {
    tunnel_attribution?: unknown;
    pattern_signals?: unknown;
}): TunnelAttribution {
    const saved = tunnelAttributionSchema.safeParse(analysis.tunnel_attribution);
    if (saved.success && saved.data && saved.data.confidence >= 0.90) return saved.data;

    const parsed = patternSignalsSchema.safeParse(analysis.pattern_signals);
    if (!parsed.success) return null;
    const matches = parsed.data.flatMap(signal => {
        if (signal.category !== "treatment_interest" || signal.confidence < 0.90) return [];
        const tunnel = Object.hasOwn(legacyTreatmentTunnels, signal.value)
            ? legacyTreatmentTunnels[signal.value]
            : inferTunnelFromTracking(signal.label);
        return tunnel && signal.evidence.some(item => hasAffirmativeSupport(tunnel, item.quote))
            ? [{ signal, tunnel }]
            : [];
    });
    if (new Set(matches.map(match => match.tunnel)).size !== 1) return null;
    const strongest = matches.sort((a, b) => b.signal.confidence - a.signal.confidence)[0];
    return strongest ? {
        tunnel: strongest.tunnel,
        confidence: strongest.signal.confidence,
        evidence: strongest.signal.evidence.slice(0, 3),
    } : null;
}

// Campaign/ad/UTM metadata is acquisition evidence and takes precedence over AI
// topic inference. Ambiguous values do not get an arbitrary tunnel.
export function inferTunnelFromTracking(...values: Array<string | null | undefined>): Tunnel | null {
    for (const value of values) {
        const text = fold(value ?? "").replace(/[^a-z0-9]+/g, " ");
        const matches = new Set<Tunnel>();
        if (/\bproblemas?\b|\binfertil|\bnao (?:consigo|consegui) engravidar\b|\bdificuldade (?:de|para) engravidar\b/.test(text)) matches.add("Problemas");
        if (/\blaqueadur/.test(text)) matches.add("Laqueadura");
        if (/\blgbt\w*|\bropa\b|\bhomoafetiv/.test(text)) matches.add("LGBT");
        if (/\bcongel|\bcong\b|\bcriopreserv|\bpreservacao/.test(text)) matches.add("Congelamento");
        if (/\bovodoa|\bovorecep|\bfiv\b|\bfertiliz|\binsemin|\btratamento|\bdoacao de (?:ovul|embr|semen|esperma)/.test(text)) matches.add("Tratamentos");
        if (/\bbio instagram\b/.test(text)) matches.add("Bio Instagram");
        if (/\bsite home engravida\b/.test(text)) matches.add("Site - Home | Engravida");
        if (matches.size > 1) return null;
        if (matches.size === 1) return [...matches][0];
    }
    return null;
}

export type TunnelReferral = {
    campaign_name: string | null;
    ad_set_name: string | null;
    ad_name: string | null;
    referral_ad_title: string | null;
    messages: { text: string | null };
};

const entryIntent = /\b(?:queria|quero|gostaria|tenho interesse|busco|procuro|me interesso|desejo)\b.*|\b(?:nao consigo|dificuldade para) engravidar\b/;
const entryQuestion = /\b(?:voces (?:fazem|realizam|oferecem)|qual (?:e )?(?:o )?(?:valor|preco|custo)|quanto (?:custa|fica)|como funciona)\b.*/;

export function inferTunnelFromReferrals(referrals: TunnelReferral[]): Tunnel | null {
    // Referrals are ordered from newest to oldest and belong to this conversation.
    for (const referral of referrals) {
        const tunnel = inferTunnelFromTracking(
            referral.campaign_name, referral.ad_set_name, referral.ad_name, referral.referral_ad_title,
        );
        if (tunnel) return tunnel;
    }

    const interests = new Set<Tunnel>();
    for (const referral of referrals) {
        const text = fold(referral.messages.text ?? "");
        for (const clause of text.split(/[,;.!?\n]|\b(?:mas|porem|contudo)\b/)) {
            const intent = entryIntent.exec(clause)?.[0] ?? entryQuestion.exec(clause)?.[0];
            if (!intent || negatedOrUncertainIntent.test(clause)) continue;
            const tunnel = inferTunnelFromTracking(intent);
            if (tunnel && hasAffirmativeSupport(tunnel, intent)) interests.add(tunnel);
        }
    }
    return interests.size === 1 ? [...interests][0] : null;
}
