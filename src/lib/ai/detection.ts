export type SignalKey = "anger" | "disconnect" | "rumination" | "highRisk";

export type SignalConfig = Record<
  SignalKey,
  {
    keywords: string[];
    directive: string;
  }
>;

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  anger: {
    keywords: [
      "enfadada",
      "me dijo",
      "salte",
      "saltei",
      "conteste",
      "contestei",
      "otra vez igual",
    ],
    directive: "Use o modulo RAIN para ira/discussao.",
  },
  disconnect: {
    keywords: ["nada", "no se", "no sei", "vacio", "vazio", "agotada"],
    directive: "Use ancoragem suave para desconexao.",
  },
  rumination: {
    keywords: ["por que sou assim", "por que soy asi", "nao paro de pensar"],
    directive: "Se houver ruminacao, redirecione para observacao e acao sem interpretacao.",
  },
  highRisk: {
    keywords: [
      "suicid",
      "me matar",
      "morrer",
      "sem vontade de viver",
      "autoagress",
      "overdose",
    ],
    directive: "Risco alto: responder com orientacao de contato imediato.",
  },
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function resolveSignalConfig(
  partial?: Partial<SignalConfig> | null,
): SignalConfig {
  const output: SignalConfig = { ...DEFAULT_SIGNAL_CONFIG };
  if (!partial) {
    return output;
  }
  (Object.keys(DEFAULT_SIGNAL_CONFIG) as SignalKey[]).forEach((key) => {
    const item = partial[key];
    if (!item) {
      return;
    }
    output[key] = {
      keywords: Array.isArray(item.keywords) && item.keywords.length > 0
        ? item.keywords
        : DEFAULT_SIGNAL_CONFIG[key].keywords,
      directive:
        typeof item.directive === "string" && item.directive.trim()
          ? item.directive
          : DEFAULT_SIGNAL_CONFIG[key].directive,
    };
  });
  return output;
}

export function detectSignals(input: string, config?: SignalConfig) {
  const text = normalize(input);
  const resolved = config ?? DEFAULT_SIGNAL_CONFIG;
  return {
    anger: resolved.anger.keywords.some((keyword) => text.includes(keyword)),
    disconnect: resolved.disconnect.keywords.some((keyword) => text.includes(keyword)),
    rumination: resolved.rumination.keywords.some((keyword) => text.includes(keyword)),
    highRisk: resolved.highRisk.keywords.some((keyword) => text.includes(keyword)),
  };
}
