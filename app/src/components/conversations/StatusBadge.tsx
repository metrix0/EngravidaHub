// src/components/conversations/StatusBadge.tsx

export type ConversationStatus = "concluida" | "pendente" | "em_andamento";

const statusConfig: Record<
    ConversationStatus,
    {
        label: string;
        className: string;
    }
> = {
    concluida: {
        label: "Concluída",
        className: "bg-green-soft text-green",
    },
    pendente: {
        label: "Pendente",
        className: "bg-orange-soft text-orange",
    },
    em_andamento: {
        label: "Em andamento",
        className: "bg-blue-soft text-blue",
    },
};

export function StatusBadge({
                                            status,
                                        }: {
    status: ConversationStatus;
}) {
    const config = statusConfig[status];

    return (
        <span
            className={`inline-flex rounded-md px-2.5 py-1 text-xs font-bold ${config.className}`}
        >
            {config.label}
        </span>
    );
}

export const __uiDemo = {
    element: (
        <div className="flex items-center gap-3">
            <StatusBadge status="concluida" />
            <StatusBadge status="pendente" />
            <StatusBadge status="em_andamento" />
        </div>
    ),
    code: `<div className="flex items-center gap-3">
  <ConversationStatusBadge status="concluida" />
  <ConversationStatusBadge status="pendente" />
  <ConversationStatusBadge status="em_andamento" />
</div>`,
};