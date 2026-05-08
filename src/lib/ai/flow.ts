import { z } from "zod";

const optionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const uiOptionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(32),
  value: optionValueSchema,
});

export const uiSpecSchema = z.object({
  component: z.enum(["choice_buttons", "yes_no"]),
  prompt: z.string().trim().min(1).max(180),
  multiple: z.boolean().optional().default(false),
  options: z.array(uiOptionSchema).min(2).max(6),
  allow_free_text: z.boolean().optional().default(true),
  store_as: z
    .object({
      domain: z.string().trim().min(1).max(64),
      keys: z.array(z.string().trim().min(1).max(64)).max(6).optional(),
    })
    .optional(),
  constraints: z
    .object({
      max_selections: z.number().int().min(1).max(3).optional(),
      expires_in_seconds: z.number().int().min(60).max(172800).optional(),
    })
    .optional(),
});

const estimateEntrySchema = z.object({
  value: z.unknown().optional(),
  confidence: z.number().min(0).max(1),
});

export const orchestratorOutputSchema = z.object({
  version: z.string().optional(),
  should_render_ui: z.boolean(),
  ui_spec: uiSpecSchema.optional(),
  flow: z
    .object({
      status: z.enum(["idle", "active", "completed", "aborted"]).optional(),
      should_continue_flow: z.boolean().optional(),
      next_target: z.string().trim().max(64).nullable().optional(),
      step_count_increment: z.number().int().min(0).max(1).optional(),
      stop_conditions_met: z.array(z.string().trim().max(64)).optional(),
    })
    .optional(),
  patient_state_estimate: z.record(z.string(), estimateEntrySchema).optional(),
  reason: z.string().trim().max(280).optional(),
});

export type UiSpec = z.infer<typeof uiSpecSchema>;
export type OrchestratorOutput = z.infer<typeof orchestratorOutputSchema>;

const DEFAULT_TARGETS = ["valence_arousal", "anxiety_intensity", "impact_delta"];

const OPT_OUT_LABEL: Record<"PT" | "ES" | "EN", string> = {
  PT: "Agora nao",
  ES: "Ahora no",
  EN: "Not now",
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type FlowConfig = {
  maxSteps: number;
  cooldownHours: number;
  confidenceThreshold: number;
  maxOptions: number;
};

export function getFlowConfig(): FlowConfig {
  const maxSteps = Number(process.env.AI_FLOW_MAX_STEPS ?? "3");
  const cooldownHours = Number(process.env.AI_FLOW_COOLDOWN_HOURS ?? "20");
  const confidenceThreshold = Number(
    process.env.AI_FLOW_CONFIDENCE_THRESHOLD ?? "0.75",
  );
  const maxOptions = Number(process.env.AI_FLOW_MAX_OPTIONS ?? "6");

  return {
    maxSteps: clampNumber(Number.isFinite(maxSteps) ? maxSteps : 3, 1, 6),
    cooldownHours: clampNumber(
      Number.isFinite(cooldownHours) ? cooldownHours : 20,
      0,
      72,
    ),
    confidenceThreshold: clampNumber(
      Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.75,
      0.5,
      0.95,
    ),
    maxOptions: clampNumber(Number.isFinite(maxOptions) ? maxOptions : 6, 3, 6),
  };
}

export function getDefaultFlowTargets() {
  return [...DEFAULT_TARGETS];
}

function trimLabel(value: string) {
  return value.trim().slice(0, 32);
}

function normalizeYesNoOptions(options: UiSpec["options"], language: "PT" | "ES" | "EN") {
  if (options.length >= 2) {
    return options.slice(0, 2).map((option) => ({
      ...option,
      label: trimLabel(option.label),
    }));
  }
  if (language === "PT") {
    return [
      { id: "yes", label: "Sim", value: "yes" },
      { id: "no", label: "Nao", value: "no" },
    ];
  }
  if (language === "EN") {
    return [
      { id: "yes", label: "Yes", value: "yes" },
      { id: "no", label: "No", value: "no" },
    ];
  }
  return [
    { id: "yes", label: "Si", value: "yes" },
    { id: "no", label: "No", value: "no" },
  ];
}

function ensureOptOutOption(options: UiSpec["options"], language: "PT" | "ES" | "EN") {
  if (options.some((option) => option.id === "opt_out")) {
    return options.map((option) => ({
      ...option,
      label: trimLabel(option.label),
    }));
  }
  return [
    ...options,
    {
      id: "opt_out",
      label: OPT_OUT_LABEL[language],
      value: "opt_out",
    },
  ];
}

export function sanitizeUiSpec(
  candidate: unknown,
  language: "PT" | "ES" | "EN",
  config: FlowConfig,
) {
  const parsed = uiSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  const uiSpec = parsed.data;
  let options =
    uiSpec.component === "yes_no"
      ? normalizeYesNoOptions(uiSpec.options, language)
      : uiSpec.options.map((option) => ({
          ...option,
          label: trimLabel(option.label),
        }));

  const uniqueById = new Map<string, (typeof options)[number]>();
  for (const option of options) {
    if (!uniqueById.has(option.id)) {
      uniqueById.set(option.id, option);
    }
  }
  options = Array.from(uniqueById.values()).slice(0, config.maxOptions);
  options = ensureOptOutOption(options, language).slice(0, config.maxOptions);

  if (!options.some((option) => option.id === "opt_out")) {
    options[options.length - 1] = {
      id: "opt_out",
      label: OPT_OUT_LABEL[language],
      value: "opt_out",
    };
  }

  return {
    ...uiSpec,
    prompt: uiSpec.prompt.trim().slice(0, 180),
    options,
    multiple: false,
    constraints: {
      max_selections: 1,
      expires_in_seconds: clampNumber(
        uiSpec.constraints?.expires_in_seconds ?? 86400,
        60,
        172800,
      ),
    },
  } satisfies UiSpec;
}

export function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function averageConfidence(
  estimate: OrchestratorOutput["patient_state_estimate"] | undefined,
  keys: string[],
) {
  if (!estimate) {
    return null;
  }
  const values = keys
    .map((key) => estimate[key]?.confidence)
    .filter((value): value is number => typeof value === "number");
  if (!values.length) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}
