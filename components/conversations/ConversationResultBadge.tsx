// components/conversations/ConversationResultBadge.tsx
import { Badge } from "@/components/ui/Badge";

export type ConversationResult =
    | "resolvida"
    | "parcial"
    | "nao_resolvida"
    | "pendente";

export function ConversationResultBadge({
    result,
}: {
    result: ConversationResult;
}) {
    return <Badge value={result} />;}

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
