import {
  executeAssistantAdvancedDataTool,
  isAssistantAdvancedDataTool,
} from "@/lib/ai/assistantAdvancedDataTools";
import { executeAssistantDataTool } from "@/lib/ai/assistantDataTools";
import {
  executeAssistantOperationalTool,
  isAssistantOperationalTool,
} from "@/lib/ai/assistantOperationalTools";
import {
  executeAssistantSocialDataTool,
  isAssistantSocialDataTool,
} from "@/lib/ai/assistantSocialDataTools";
import type { AssistantToolContext } from "@/lib/ai/assistantToolContext";
import { getUnitMacroHistory } from "@/lib/units/macroHistory";

export async function executeAssistantTool(
  name: string,
  args: Record<string, unknown>,
  context: AssistantToolContext,
) {
  if (name === "get_unit_macro_history")
    return getUnitMacroHistory(args, context);
  if (isAssistantAdvancedDataTool(name))
    return executeAssistantAdvancedDataTool(name, args, context);
  if (isAssistantOperationalTool(name))
    return executeAssistantOperationalTool(name, args, context);
  if (isAssistantSocialDataTool(name))
    return executeAssistantSocialDataTool(name, args, context);
  return executeAssistantDataTool(name, args, context);
}
