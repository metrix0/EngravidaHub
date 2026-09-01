// lib/ai/assistantToolContext.ts
import type { CurrentUserUnitLock } from "@/lib/auth/userAccess";

export type AssistantToolContext = {
    authUserId: string;
    sessionId: string;
    unitLock: CurrentUserUnitLock | null;
};

export function applyAssistantUnitScope(
    args: Record<string, unknown>,
    context: AssistantToolContext,
) {
    return context.unitLock
        ? { ...args, unit_name: context.unitLock.name }
        : args;
}

export function unitRestrictedToolOutput(
    context: AssistantToolContext,
    toolLabel: string,
) {
    return {
        output: {
            ok: false,
            error: `${toolLabel} não possui separação confiável por unidade e não está disponível para este acesso restrito.`,
        },
        cards: [] as [],
    };
}
