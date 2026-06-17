// app/src/types/index.ts
export * from "./client";
export * from "./message";
export * from "./attendant";
export * from "./service";
export * from "./unit";



// src/types/index.ts
export * from "../../apps/insights/src/types/conversation";
export * from "../../apps/insights/src/types/conversation-analysis";
export * from "../../apps/insights/src/types/executive-dashboard-data";
export * from "../../apps/insights/src/types/filters";
export * from "../../apps/insights/src/types/analyze-conversation-input";

// export type ClientWithConversations = import("./client").Client & {
//     conversations: Array<
//         import("../../apps/insights/src/types/conversation").Conversation & {
//         messages: import("./message").Message[];
//         conversation_analysis: import("../../apps/insights/src/types/conversation-analysis").ConversationAnalysis | null;
//     }
//     >;
// };