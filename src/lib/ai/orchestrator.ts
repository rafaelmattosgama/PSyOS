import { callOpenAiOrchestrator } from "@/lib/ai/openai";
import {
  averageConfidence,
  extractJsonObject,
  getFlowConfig,
  orchestratorOutputSchema,
  sanitizeUiSpec,
  type OrchestratorOutput,
  type UiSpec,
} from "@/lib/ai/flow";

type OrchestratorInput = {
  assistantText: string;
  patientLastMessage: string;
  flowSessionSummary: Record<string, unknown> | null;
  recentStructuredResponses: Array<Record<string, unknown>>;
  burdenSignals: Record<string, unknown>;
  patientLanguage: "PT" | "ES" | "EN";
};

type OrchestratorResult = {
  shouldRenderUi: boolean;
  uiSpec: UiSpec | null;
  shouldContinueFlow: boolean;
  nextTarget: string | null;
  patientStateEstimate: OrchestratorOutput["patient_state_estimate"] | null;
  averageConfidence: number | null;
  reason: string;
};

const SYSTEM_PROMPT = `
You are a UI orchestration classifier for a therapeutic support chat.

Your only job:
1) Decide if a lightweight interactive UI should be rendered for the next patient response.
2) If yes, generate a strict JSON ui_spec with short, low-burden options.
3) Decide if the adaptive flow should continue.
4) Estimate patient state dimensions with confidence (no diagnosis).

Conservative rules:
- If uncertain, set should_render_ui=false.
- Never create UI for medication, diagnosis, or medical decisions.
- Max 6 options, ideal 3-5. Labels must be short.
- Include an easy opt-out option id "opt_out".
- Return JSON only, no markdown, no extra text.
`.trim();

function buildUserPrompt(input: OrchestratorInput) {
  const config = getFlowConfig();
  return `
MAX_STEPS: ${config.maxSteps}
PATIENT_LANGUAGE: ${input.patientLanguage}

assistant_text:
${input.assistantText}

flow_session:
${JSON.stringify(input.flowSessionSummary ?? {}, null, 2)}

recent_structured_responses_72h:
${JSON.stringify(input.recentStructuredResponses, null, 2)}

burden_signals:
${JSON.stringify(input.burdenSignals, null, 2)}

patient_last_message:
${input.patientLastMessage}

Output JSON schema:
{
  "version": "1.0",
  "should_render_ui": true,
  "ui_spec": {
    "component": "choice_buttons",
    "prompt": "short question",
    "multiple": false,
    "options": [
      { "id": "opt1", "label": "Option 1", "value": "opt1" },
      { "id": "opt2", "label": "Option 2", "value": "opt2" },
      { "id": "opt_out", "label": "Not now", "value": "opt_out" }
    ],
    "allow_free_text": true,
    "constraints": {
      "max_selections": 1,
      "expires_in_seconds": 86400
    }
  },
  "flow": {
    "status": "active",
    "should_continue_flow": true,
    "next_target": "anxiety_intensity",
    "step_count_increment": 1,
    "stop_conditions_met": []
  },
  "patient_state_estimate": {
    "valence": { "value": -0.1, "confidence": 0.6 },
    "arousal": { "value": 0.7, "confidence": 0.65 },
    "anxiety_intensity": { "value": 6, "confidence": 0.6 }
  },
  "reason": "short internal reason"
}
`.trim();
}

export async function runFlowOrchestrator(input: OrchestratorInput) {
  const config = getFlowConfig();
  const raw = await callOpenAiOrchestrator({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
    maxTokens: 500,
    temperature: 0.1,
  });

  const rawJson = extractJsonObject(raw);
  const parsed = orchestratorOutputSchema.safeParse(rawJson);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;
  const uiSpec =
    data.should_render_ui && data.ui_spec
      ? sanitizeUiSpec(data.ui_spec, input.patientLanguage, config)
      : null;

  const avgConfidence = averageConfidence(data.patient_state_estimate, [
    "valence",
    "arousal",
    "anxiety_intensity",
  ]);

  return {
    shouldRenderUi: Boolean(data.should_render_ui && uiSpec),
    uiSpec,
    shouldContinueFlow: Boolean(data.flow?.should_continue_flow),
    nextTarget: data.flow?.next_target ?? null,
    patientStateEstimate: data.patient_state_estimate ?? null,
    averageConfidence: avgConfidence,
    reason: data.reason ?? "",
  } satisfies OrchestratorResult;
}
