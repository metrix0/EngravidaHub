// components/conversations/ConversationResultBadge.tsx

export type ConversationResult =
    | "resolvida"
    | "parcial"
    | "nao_resolvida"
    | "pendente";

const resultConfig: Record<
    ConversationResult,
    {
        label: string;
        className: string;
    }
> = {
    resolvida: {
        label: "Resolvida",
        className: "bg-green-soft text-green",
    },
    parcial: {
        label: "Parcial",
        className: "bg-orange-soft text-orange",
    },
    nao_resolvida: {
        label: "Não resolvida",
        className: "bg-red-soft text-red",
    },
    pendente: {
        label: "Pendente",
        className: "bg-slate-100 text-slate-500",
    },
};

export function ConversationResultBadge({
                                            result,
                                        }: {
    result: ConversationResult;
}) {
    const config = resultConfig[result];

    return (
        <span
            className={`inline-flex rounded-md px-2.5 py-1 text-xs whitespace-nowrap font-bold ${config.className}`}
        >
            {config.label}
        </span>
    );
}

export const __uiDemo = {
    element: (
        <div className="flex items-center gap-3">
            <ConversationResultBadge result="resolvida" />
            <ConversationResultBadge result="parcial" />
            <ConversationResultBadge result="nao_resolvida" />
            <ConversationResultBadge result="pendente" />
        </div>
    ),
    code: `<div className="flex items-center gap-3">
  <ConversationResultBadge result="resolvida" />
  <ConversationResultBadge result="parcial" />
  <ConversationResultBadge result="nao_resolvida" />
  <ConversationResultBadge result="pendente" />
</div>`,
};
