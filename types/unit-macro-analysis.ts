import type { AssistantCard } from "@/types/assistant";

export type UnitAnalysisType = "weekly" | "monthly";
export type MacroUnit = {
  id: string;
  name: string;
  city: string;
  state: string;
  active: boolean;
};
export type UnitMacroAnalysis = {
  id: string;
  unit_id: string;
  analysis_type: UnitAnalysisType;
  period_start: string;
  period_end: string;
  status: "pending" | "processing" | "completed" | "failed";
  report: string;
  cards: AssistantCard[];
  metrics: Record<string, unknown>;
  context: Record<string, unknown>;
  previous_analysis_ids: string[];
  model: string | null;
  error_message: string | null;
  attempt_count: number;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  usage: Record<string, number>;
  tool_names: string[];
};
