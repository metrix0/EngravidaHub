// lib/ai/assistantResponseState.ts
import type {
    ResponseInputItem,
    ResponseOutputItem,
} from "openai/resources/responses/responses";

export function toStatelessContinuationItems(
    output: ResponseOutputItem[] | Array<Record<string, unknown>>,
): ResponseInputItem[] {
    return [...output] as ResponseInputItem[];
}
