// lib/conversations/analyzeConversationsByIds.ts
import { supabase } from "@/lib";

import { matchConversationsSheetAttribution } from "@/lib/conversations/matchConversationsSheetAttribution";
import { processPendingConversationsToAnalysisAndAdEvents } from "@/lib/conversations/processPendingConversationsToAnalysisAndAdEvents";

type ConversationRow = {
    id: string;
    client_id: string;
    attendant_id: string | null;
    attendant_chat_name: string | null;
    conversation_analysis_id: string | null;
};

type MessageRow = {
    id: string;
    sender_type: string;
    sender_name: string | null;
    external_attendant_id: string | null;
};

type ClientRow = {
    name: string | null;
};

type AttendantRow = {
    id: string;
    name: string;
    external_attendant_id: string | null;
};

type SenderPreparationResult =
    | {
          ok: true;
          conversation_id: string;
          already_analyzed: boolean;
          conversation_analysis_id: string | null;
      }
    | {
          ok: false;
          conversation_id: string;
          skipped: true;
          reason: "conversation_not_found" | "missing_attendant_name";
          message_id?: string;
      };

export type AnalyzeConversationsByIdsResult = {
    requested_conversation_ids: string[];
    ready_conversation_ids: string[];
    sender_preparation: SenderPreparationResult[];
    sheet_attribution_match: Awaited<
        ReturnType<typeof matchConversationsSheetAttribution>
    > | null;
    results: Awaited<
        ReturnType<typeof processPendingConversationsToAnalysisAndAdEvents>
    >;
};

export async function analyzeConversationById(conversationId: string) {
    const response = await analyzeConversationsByIds([conversationId]);

    return {
        ...response,
        result:
            response.results.find(
                (item) => item.conversation_id === conversationId,
            ) ??
            response.sender_preparation.find(
                (item) => item.conversation_id === conversationId,
            ) ??
            null,
    };
}

export async function analyzeConversationsByIds(
    conversationIds: string[],
): Promise<AnalyzeConversationsByIdsResult> {
    const uniqueConversationIds = Array.from(
        new Set(conversationIds.filter(Boolean)),
    );

    console.log("[analyzeConversationsByIds] starting targeted pipeline", {
        requested_conversations: uniqueConversationIds.length,
        first_conversation_ids: uniqueConversationIds.slice(0, 10),
    });

    if (uniqueConversationIds.length === 0) {
        return {
            requested_conversation_ids: [],
            ready_conversation_ids: [],
            sender_preparation: [],
            sheet_attribution_match: null,
            results: [],
        };
    }

    const senderPreparation: SenderPreparationResult[] = [];

    for (const conversationId of uniqueConversationIds) {
        senderPreparation.push(
            await prepareConversationSenderNames(conversationId),
        );
    }

    const readyConversationIds = senderPreparation
        .filter(
            (
                item,
            ): item is Extract<SenderPreparationResult, { ok: true }> =>
                item.ok && !item.already_analyzed,
        )
        .map((item) => item.conversation_id);

    console.log("[analyzeConversationsByIds] sender names prepared", {
        requested_conversations: uniqueConversationIds.length,
        ready_conversations: readyConversationIds.length,
        already_analyzed: senderPreparation.filter(
            (item) => item.ok && item.already_analyzed,
        ).length,
        skipped_missing_attendant_name: senderPreparation.filter(
            (item) =>
                "reason" in item &&
                item.reason === "missing_attendant_name",
        ).length,
        missing_conversations: senderPreparation.filter(
            (item) =>
                "reason" in item &&
                item.reason === "conversation_not_found",
        ).length,
    });

    if (readyConversationIds.length === 0) {
        return {
            requested_conversation_ids: uniqueConversationIds,
            ready_conversation_ids: [],
            sender_preparation: senderPreparation,
            sheet_attribution_match: null,
            results: [],
        };
    }

    console.log(
        "[analyzeConversationsByIds] matching spreadsheet tunnel/origin",
        {
            conversations: readyConversationIds.length,
        },
    );

    const sheetAttributionMatch =
        await matchConversationsSheetAttribution({
            limit: readyConversationIds.length,
            conversationIds: readyConversationIds,
        });

    console.log(
        "[analyzeConversationsByIds] spreadsheet tunnel/origin matched",
        sheetAttributionMatch,
    );

    console.log("[analyzeConversationsByIds] analyzing conversations", {
        conversations: readyConversationIds.length,
    });

    const results =
        await processPendingConversationsToAnalysisAndAdEvents({
            limit: readyConversationIds.length,
            conversationIds: readyConversationIds,
        });

    console.log("[analyzeConversationsByIds] targeted pipeline finished", {
        requested_conversations: uniqueConversationIds.length,
        ready_conversations: readyConversationIds.length,
        succeeded: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
    });

    return {
        requested_conversation_ids: uniqueConversationIds,
        ready_conversation_ids: readyConversationIds,
        sender_preparation: senderPreparation,
        sheet_attribution_match: sheetAttributionMatch,
        results,
    };
}

async function prepareConversationSenderNames(
    conversationId: string,
): Promise<SenderPreparationResult> {
    const { data: conversation, error: conversationError } =
        await supabase
            .from("conversations")
            .select(
                "id, client_id, attendant_id, attendant_chat_name, conversation_analysis_id",
            )
            .eq("id", conversationId)
            .maybeSingle();

    if (conversationError) {
        throw new Error(
            `Failed to load conversation before analysis: ${conversationError.message}`,
        );
    }

    if (!conversation) {
        console.warn(
            "[analyzeConversationsByIds] conversation not found",
            {
                conversation_id: conversationId,
            },
        );

        return {
            ok: false,
            skipped: true,
            reason: "conversation_not_found",
            conversation_id: conversationId,
        };
    }

    const typedConversation = conversation as ConversationRow;

    if (typedConversation.conversation_analysis_id) {
        console.log(
            "[analyzeConversationsByIds] conversation already analyzed",
            {
                conversation_id: conversationId,
                conversation_analysis_id:
                    typedConversation.conversation_analysis_id,
            },
        );

        return {
            ok: true,
            conversation_id: conversationId,
            already_analyzed: true,
            conversation_analysis_id:
                typedConversation.conversation_analysis_id,
        };
    }

    const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select(
            "id, sender_type, sender_name, external_attendant_id",
        )
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true })
        .order("sequence_index", { ascending: true });

    if (messagesError) {
        throw new Error(
            `Failed to load conversation messages before analysis: ${messagesError.message}`,
        );
    }

    const typedMessages = (messages ?? []) as MessageRow[];

    const [{ data: client, error: clientError }, assignedAttendant] =
        await Promise.all([
            supabase
                .from("clients")
                .select("name")
                .eq("id", typedConversation.client_id)
                .maybeSingle(),
            typedConversation.attendant_id
                ? loadAttendantById(typedConversation.attendant_id)
                : Promise.resolve(null),
        ]);

    if (clientError) {
        throw new Error(
            `Failed to load conversation client before analysis: ${clientError.message}`,
        );
    }

    const externalAttendantIds = Array.from(
        new Set(
            typedMessages
                .filter(
                    (message) =>
                        message.sender_type === "attendant" &&
                        !normalizeName(message.sender_name) &&
                        message.external_attendant_id,
                )
                .map((message) => message.external_attendant_id)
                .filter((value): value is string => Boolean(value)),
        ),
    );

    const attendantsByExternalId =
        await loadAttendantsByExternalIds(externalAttendantIds);

    const clientName =
        normalizeName((client as ClientRow | null)?.name) ?? "Cliente";

    const assignedAttendantName =
        normalizeName(assignedAttendant?.name) ??
        normalizeName(typedConversation.attendant_chat_name);

    const updates: Array<{ id: string; sender_name: string }> = [];
    let firstResolvedAttendantName: string | null =
        assignedAttendantName;

    for (const message of typedMessages) {
        const existingName = normalizeName(message.sender_name);

        if (existingName) {
            if (
                message.sender_type === "attendant" &&
                !firstResolvedAttendantName
            ) {
                firstResolvedAttendantName = existingName;
            }

            continue;
        }

        if (message.sender_type === "client") {
            updates.push({
                id: message.id,
                sender_name: clientName,
            });
            continue;
        }

        if (message.sender_type === "bot") {
            updates.push({
                id: message.id,
                sender_name: "Bot",
            });
            continue;
        }

        if (message.sender_type === "system") {
            updates.push({
                id: message.id,
                sender_name: "Sistema",
            });
            continue;
        }

        if (message.sender_type === "attendant") {
            const externalAttendantName = message.external_attendant_id
                ? normalizeName(
                      attendantsByExternalId.get(
                          message.external_attendant_id,
                      )?.name,
                  )
                : null;

            const attendantName =
                externalAttendantName ?? assignedAttendantName ?? "Atendente";

            firstResolvedAttendantName ??= attendantName;

            updates.push({
                id: message.id,
                sender_name: attendantName,
            });
        }
    }

    for (const update of updates) {
        const { error: updateError } = await supabase
            .from("messages")
            .update({
                sender_name: update.sender_name,
            })
            .eq("id", update.id)
            .eq("conversation_id", conversationId);

        if (updateError) {
            throw new Error(
                `Failed to update message sender name: ${updateError.message}`,
            );
        }
    }

    if (
        firstResolvedAttendantName &&
        normalizeName(typedConversation.attendant_chat_name) !==
            firstResolvedAttendantName
    ) {
        const { error: conversationUpdateError } = await supabase
            .from("conversations")
            .update({
                attendant_chat_name: firstResolvedAttendantName,
            })
            .eq("id", conversationId);

        if (conversationUpdateError) {
            throw new Error(
                `Failed to update conversation attendant name: ${conversationUpdateError.message}`,
            );
        }
    }

    console.log(
        "[analyzeConversationsByIds] sender preparation completed",
        {
            conversation_id: conversationId,
            updated_messages: updates.length,
            client_fallback_used:
                clientName === "Cliente" &&
                !normalizeName((client as ClientRow | null)?.name),
            missing_attendant_message_id: null,
        },
    );

    return {
        ok: true,
        conversation_id: conversationId,
        already_analyzed: false,
        conversation_analysis_id: null,
    };
}

async function loadAttendantById(attendantId: string) {
    const { data, error } = await supabase
        .from("attendants")
        .select("id, name, external_attendant_id")
        .eq("id", attendantId)
        .maybeSingle();

    if (error) {
        throw new Error(
            `Failed to load assigned attendant before analysis: ${error.message}`,
        );
    }

    return (data ?? null) as AttendantRow | null;
}

async function loadAttendantsByExternalIds(
    externalAttendantIds: string[],
) {
    const attendantsByExternalId = new Map<string, AttendantRow>();

    for (const ids of chunk(externalAttendantIds, 100)) {
        const { data, error } = await supabase
            .from("attendants")
            .select("id, name, external_attendant_id")
            .in("external_attendant_id", ids);

        if (error) {
            throw new Error(
                `Failed to load attendants before analysis: ${error.message}`,
            );
        }

        for (const attendant of (data ?? []) as AttendantRow[]) {
            if (attendant.external_attendant_id) {
                attendantsByExternalId.set(
                    attendant.external_attendant_id,
                    attendant,
                );
            }
        }
    }

    return attendantsByExternalId;
}

function normalizeName(value: string | null | undefined) {
    if (!value) return null;

    const normalized = value.trim();
    return normalized || null;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}
