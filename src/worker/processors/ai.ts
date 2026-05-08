import { prisma } from "@/lib/prisma";
import { decryptDek, decryptMessage, encryptMessage, getMasterKek } from "@/lib/crypto";
import { mergePolicies } from "@/lib/ai/policy";
import {
  detectSignals,
  resolveSignalConfig,
  type SignalConfig,
} from "@/lib/ai/detection";
import { callOpenAi } from "@/lib/ai/openai";
import { storePromptSnapshot } from "@/lib/ai/debug";
import { getOrCreateEpisode } from "@/lib/ai/episode";
import { logAuditEvent } from "@/lib/audit";
import { runFlowOrchestrator } from "@/lib/ai/orchestrator";
import { getDefaultFlowTargets, getFlowConfig, type UiSpec } from "@/lib/ai/flow";

type AiJob = {
  tenantId: string;
  conversationId: string;
  triggerMessageId?: string;
  flowContinuation?: boolean;
  eventCloseRequest?: boolean;
};

const prismaAny = prisma as typeof prisma & {
  aiFlowSession: {
    findFirst: (args: unknown) => Promise<
      | {
          id: string;
          status: "IDLE" | "ACTIVE" | "COMPLETED" | "ABORTED";
          stepCount: number;
          maxSteps: number;
          ignoredUiCount: number;
          burdenScore: number;
          lastTarget: string | null;
          targetsJson: unknown;
          confidenceJson: unknown;
          cooldownUntil: Date | null;
          updatedAt: Date;
        }
      | null
    >;
    create: (args: unknown) => Promise<{ id: string; stepCount: number }>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiFlowStep: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      createdAt: Date;
      messageId: string;
      expiresAt: Date | null;
    } | null>;
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        answeredAt: Date | null;
        answerJson: unknown;
        uiSpecJson: unknown;
      }>
    >;
    create: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiEventSession: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      status: "OPEN" | "CLOSED" | "ABORTED";
      flowSessionId: string | null;
      adherenceJson: unknown;
      updatedAt: Date;
    } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

const DEFAULT_MAX_TURNS = 3;
const DEFAULT_MAX_TOKENS = 300;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_FLOW_TARGETS = ["valence_arousal", "anxiety_intensity", "impact_delta"];
type EngagementStyle = "gentle" | "playful" | "direct";
const LANGUAGE_DIRECTIVE = {
  PT: "Responda sempre em portugues.",
  ES: "Responda sempre em espanhol.",
  EN: "Respond in English.",
} as const;

const SIGNAL_DIRECTIVES = {
  PT: {
    anger: "Use o modulo RAIN para ira/discussao.",
    disconnect: "Use ancoragem suave para desconexao.",
    rumination: "Se houver ruminacao, redirecione para observacao e acao sem interpretacao.",
    highRisk: "Risco alto: responder com orientacao de contato imediato.",
  },
  ES: {
    anger: "Usa el modulo RAIN para ira/discusion.",
    disconnect: "Usa anclaje suave para desconexion.",
    rumination:
      "Si hay rumiacion, redirige a observacion y accion sin interpretacion.",
    highRisk: "Riesgo alto: responder con orientacion de contacto inmediato.",
  },
  EN: {
    anger: "Use the RAIN module for anger/discussion.",
    disconnect: "Use gentle anchoring for disconnection.",
    rumination:
      "If rumination appears, redirect to observation and action without interpretation.",
    highRisk: "High risk: respond with immediate contact guidance.",
  },
} as const;

const WORKER_COPY = {
  PT: {
    safety:
      "Sinto muito que voce esteja passando por isso. Isso nao substitui sua sessao. " +
      "Se houver risco imediato, procure sua terapeuta ou servicos de emergencia. " +
      "Quer registrar o que aconteceu agora para levar a sessao?",
    closing:
      "Podemos fechar por agora para nao prolongar o episodio. " +
      "Se quiser, anote o que ficou mais vivo e leve para a sessao. " +
      "Este acompanhamento e supervisionado; fale com sua psicologa se precisar.",
    unavailable:
      "Estou com instabilidade agora e nao consigo responder com clareza. " +
      "Se quiser, podemos registrar o que aconteceu para levar a sessao.",
    eventClosedTitle: "Para fechar este registro de hoje:",
    eventClosedActions: [
      "Anote em 1 frase o que mais te ativou.",
      "Tire 3 minutos para respirar e baixar o corpo.",
      "Escolha 1 limite simples para a proxima conversa.",
    ],
    eventClosedEnd: "Se quiser, abrimos um novo registro quando voce voltar.",
    noLeak: "Nunca exponha dados de outros pacientes ou tenants.",
  },
  ES: {
    safety:
      "Siento mucho que estes pasando por esto. Esto no sustituye tu sesion. " +
      "Si hay riesgo inmediato, busca a tu terapeuta o servicios de emergencia. " +
      "Quieres registrar lo ocurrido para llevarlo a la sesion?",
    closing:
      "Podemos cerrar por ahora para no prolongar el episodio. " +
      "Si quieres, anota lo mas vivo y llevalo a la sesion. " +
      "Este acompanamiento es supervisado; habla con tu psicologa si lo necesitas.",
    unavailable:
      "Estoy con inestabilidad ahora y no logro responder con claridad. " +
      "Si quieres, podemos registrar lo ocurrido para llevarlo a la sesion.",
    eventClosedTitle: "Para cerrar este registro de hoy:",
    eventClosedActions: [
      "Anota en 1 frase lo que mas te activo.",
      "Toma 3 minutos para respirar y bajar activacion.",
      "Elige 1 limite simple para la proxima conversacion.",
    ],
    eventClosedEnd: "Si quieres, abrimos un nuevo registro cuando vuelvas.",
    noLeak: "Nunca expongas datos de otros pacientes o tenants.",
  },
  EN: {
    safety:
      "I'm sorry you're going through this. This does not replace your session. " +
      "If there's immediate risk, contact your therapist or emergency services. " +
      "Would you like to record what happened to bring to your session?",
    closing:
      "We can close for now to avoid prolonging the episode. " +
      "If you'd like, note what felt most alive and bring it to your session. " +
      "This accompaniment is supervised; contact your psychologist if needed.",
    unavailable:
      "I'm having instability right now and can't respond clearly. " +
      "If you'd like, we can record what happened to bring to your session.",
    eventClosedTitle: "To close today's check-in:",
    eventClosedActions: [
      "Write one sentence about what activated you most.",
      "Take 3 minutes to slow your body and breathing.",
      "Choose one simple boundary for the next conversation.",
    ],
    eventClosedEnd: "If you want, we can open a new check-in when you return.",
    noLeak: "Never expose data from other patients or tenants.",
  },
} as const;

function buildSafetyReply(language: keyof typeof WORKER_COPY) {
  return WORKER_COPY[language].safety;
}

function buildClosingReply(language: keyof typeof WORKER_COPY) {
  return WORKER_COPY[language].closing;
}

function buildUnavailableReply(language: keyof typeof WORKER_COPY) {
  return WORKER_COPY[language].unavailable;
}

function buildEventClosedFallbackReply(language: keyof typeof WORKER_COPY) {
  const copy = WORKER_COPY[language];
  return `${copy.eventClosedTitle}\n- ${copy.eventClosedActions[0]}\n- ${copy.eventClosedActions[1]}\n- ${copy.eventClosedActions[2]}\n${copy.eventClosedEnd}`.trim();
}

function sanitizeEventClosedReply(
  rawText: string,
  language: keyof typeof WORKER_COPY,
) {
  const fallback = buildEventClosedFallbackReply(language);
  const clean = rawText.replace(/\r/g, "").trim();
  if (!clean) {
    return fallback;
  }

  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLike = lines.filter((line) =>
    /^([-*•]|\d+[\)\.])\s+/.test(line),
  );

  const intro =
    lines.find((line) => !/^([-*•]|\d+[\)\.])\s+/.test(line)) ??
    WORKER_COPY[language].eventClosedTitle;
  const actions = bulletLike.slice(0, 3).map((line) =>
    line.replace(/^([-*•]|\d+[\)\.])\s+/, "").trim(),
  );
  const safeActions =
    actions.length > 0
      ? actions
      : WORKER_COPY[language].eventClosedActions.slice(0, 3);

  const endLine = WORKER_COPY[language].eventClosedEnd;
  return [
    intro.slice(0, 220),
    ...safeActions.slice(0, 3).map((line) => `- ${line.slice(0, 200)}`),
    endLine,
  ].join("\n");
}

function sanitizeSingleQuestion(
  rawText: string,
  language: keyof typeof WORKER_COPY,
) {
  const fallbackByLanguage = {
    PT: "Como voce esta se sentindo agora?",
    ES: "Como te estas sintiendo ahora?",
    EN: "How are you feeling right now?",
  } as const;

  const clean = rawText.replace(/\r/g, " ").replace(/\n+/g, " ").trim();
  if (!clean) {
    return fallbackByLanguage[language];
  }

  const questionChunks = clean
    .split(/(?<=\?)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (questionChunks.length > 0) {
    return questionChunks[0].slice(0, 180);
  }

  const firstSentence = clean.split(/[.!]/)[0]?.trim() ?? "";
  if (firstSentence) {
    const sentence = firstSentence.slice(0, 170);
    return sentence.endsWith("?") ? sentence : `${sentence}?`;
  }

  return fallbackByLanguage[language];
}

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function safeJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getFlowTargets(value: unknown) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_FLOW_TARGETS];
  }
  const parsed = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_FLOW_TARGETS];
}

function resolveEngagementStyle(params: {
  burdenScore?: number;
  ignoredUiCount?: number;
  stepCount?: number;
}): EngagementStyle {
  if ((params.burdenScore ?? 0) > 0.55 || (params.ignoredUiCount ?? 0) >= 2) {
    return "direct";
  }
  if ((params.stepCount ?? 0) === 0) {
    return "playful";
  }
  return "gentle";
}

function stylePrompt(
  style: EngagementStyle,
  variants: { gentle: string; playful: string; direct: string },
) {
  if (style === "playful") {
    return variants.playful;
  }
  if (style === "direct") {
    return variants.direct;
  }
  return variants.gentle;
}

function buildSequentialFlowPrompt(
  language: keyof typeof WORKER_COPY,
  target: string,
  style: EngagementStyle,
) {
  if (target === "anxiety_intensity") {
    if (language === "PT") {
      return {
        prompt: stylePrompt(style, {
          gentle: "Em qual faixa a ansiedade esta agora?",
          playful: "Check rapido: em qual faixa esta a ansiedade agora?",
          direct: "Ansiedade agora: escolha a faixa.",
        }),
        options: [
          { id: "anx_0_3", label: "0-3 (baixa)", value: "0-3" },
          { id: "anx_4_6", label: "4-6 (media)", value: "4-6" },
          { id: "anx_7_8", label: "7-8 (alta)", value: "7-8" },
          { id: "anx_9_10", label: "9-10 (muito alta)", value: "9-10" },
          { id: "opt_out", label: "Agora nao", value: "opt_out" },
        ],
      };
    }
    if (language === "EN") {
      return {
        prompt: stylePrompt(style, {
          gentle: "Which range best fits your anxiety right now?",
          playful: "Quick check: which range matches your anxiety right now?",
          direct: "Anxiety now: pick the range.",
        }),
        options: [
          { id: "anx_0_3", label: "0-3 (low)", value: "0-3" },
          { id: "anx_4_6", label: "4-6 (medium)", value: "4-6" },
          { id: "anx_7_8", label: "7-8 (high)", value: "7-8" },
          { id: "anx_9_10", label: "9-10 (very high)", value: "9-10" },
          { id: "opt_out", label: "Not now", value: "opt_out" },
        ],
      };
    }
    return {
      prompt: stylePrompt(style, {
        gentle: "En que rango esta la ansiedad ahora?",
        playful: "Chequeo rapido: en que rango esta la ansiedad ahora?",
        direct: "Ansiedad ahora: elige el rango.",
      }),
      options: [
        { id: "anx_0_3", label: "0-3 (baja)", value: "0-3" },
        { id: "anx_4_6", label: "4-6 (media)", value: "4-6" },
        { id: "anx_7_8", label: "7-8 (alta)", value: "7-8" },
        { id: "anx_9_10", label: "9-10 (muy alta)", value: "9-10" },
        { id: "opt_out", label: "Ahora no", value: "opt_out" },
      ],
    };
  }

  if (target === "impact_delta") {
    if (language === "PT") {
      return {
        prompt: stylePrompt(style, {
          gentle: "Desde ontem, como isso ficou?",
          playful: "Comparando com ontem, como ficou hoje?",
          direct: "Desde ontem: melhor, igual ou pior?",
        }),
        options: [
          { id: "delta_better", label: "Melhor", value: "better" },
          { id: "delta_same", label: "Igual", value: "same" },
          { id: "delta_worse", label: "Pior", value: "worse" },
          { id: "opt_out", label: "Agora nao", value: "opt_out" },
        ],
      };
    }
    if (language === "EN") {
      return {
        prompt: stylePrompt(style, {
          gentle: "Compared with yesterday, how is it now?",
          playful: "Quick compare with yesterday: better, same, or worse?",
          direct: "Since yesterday: better, same, or worse?",
        }),
        options: [
          { id: "delta_better", label: "Better", value: "better" },
          { id: "delta_same", label: "Same", value: "same" },
          { id: "delta_worse", label: "Worse", value: "worse" },
          { id: "opt_out", label: "Not now", value: "opt_out" },
        ],
      };
    }
    return {
      prompt: stylePrompt(style, {
        gentle: "Comparado con ayer, como esta ahora?",
        playful: "Comparacion rapida con ayer: mejor, igual o peor?",
        direct: "Desde ayer: mejor, igual o peor?",
      }),
      options: [
        { id: "delta_better", label: "Mejor", value: "better" },
        { id: "delta_same", label: "Igual", value: "same" },
        { id: "delta_worse", label: "Peor", value: "worse" },
        { id: "opt_out", label: "Ahora no", value: "opt_out" },
      ],
    };
  }

  if (language === "PT") {
    return {
      prompt: stylePrompt(style, {
        gentle: "Qual opcao descreve melhor como voce esta agora?",
        playful: "Check-in rapido: como voce esta agora?",
        direct: "Como voce esta agora? Escolha uma opcao.",
      }),
      options: [
        { id: "va_calm", label: "Mais calmo(a)", value: "calmer" },
        { id: "va_same", label: "Sem mudanca", value: "same" },
        { id: "va_activated", label: "Mais ativado(a)", value: "activated" },
        { id: "opt_out", label: "Agora nao", value: "opt_out" },
      ],
    };
  }
  if (language === "EN") {
    return {
      prompt: stylePrompt(style, {
        gentle: "Which option best describes how you feel right now?",
        playful: "Quick check-in: how do you feel right now?",
        direct: "How do you feel now? Pick one option.",
      }),
      options: [
        { id: "va_calm", label: "Calmer", value: "calmer" },
        { id: "va_same", label: "About the same", value: "same" },
        { id: "va_activated", label: "More activated", value: "activated" },
        { id: "opt_out", label: "Not now", value: "opt_out" },
      ],
    };
  }
  return {
    prompt: stylePrompt(style, {
      gentle: "Que opcion describe mejor como estas ahora?",
      playful: "Chequeo rapido: como estas ahora?",
      direct: "Como estas ahora? Elige una opcion.",
    }),
    options: [
      { id: "va_calm", label: "Mas calmado(a)", value: "calmer" },
      { id: "va_same", label: "Mas o menos igual", value: "same" },
      { id: "va_activated", label: "Mas activado(a)", value: "activated" },
      { id: "opt_out", label: "Ahora no", value: "opt_out" },
    ],
  };
}

export async function processAi(job: AiJob) {
  const startedAt = Date.now();
  console.log("[ai] process start", {
    conversationId: job.conversationId,
    tenantId: job.tenantId,
    triggerMessageId: job.triggerMessageId,
    eventCloseRequest: Boolean(job.eventCloseRequest),
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  });
  const conversation = await prisma.conversation.findFirst({
    where: { tenantId: job.tenantId, id: job.conversationId },
    include: { patient: { include: { patientProfile: true } } },
  });
  if (!conversation || !conversation.aiEnabled) {
    console.log("[ai] skipped: no conversation or AI disabled");
    return;
  }

  if (job.triggerMessageId && !job.eventCloseRequest) {
    const [triggerMessage, latestPatientMessage, latestAiMessage] = await Promise.all([
      prisma.message.findFirst({
        where: {
          tenantId: job.tenantId,
          conversationId: conversation.id,
          id: job.triggerMessageId,
        },
        select: { id: true, createdAt: true, authorType: true },
      }),
      prisma.message.findFirst({
        where: {
          tenantId: job.tenantId,
          conversationId: conversation.id,
          authorType: "PATIENT",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true },
      }),
      prisma.message.findFirst({
        where: {
          tenantId: job.tenantId,
          conversationId: conversation.id,
          authorType: "AI",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true },
      }),
    ]);

    if (!triggerMessage || triggerMessage.authorType !== "PATIENT") {
      console.log("[ai] skipped stale job", {
        reason: "missing_or_invalid_trigger_message",
        triggerMessageId: job.triggerMessageId,
      });
      return;
    }

    if (latestPatientMessage && latestPatientMessage.id !== triggerMessage.id) {
      console.log("[ai] skipped stale job", {
        reason: "not_latest_patient_message",
        triggerMessageId: triggerMessage.id,
        latestPatientMessageId: latestPatientMessage.id,
      });
      return;
    }

    if (latestAiMessage && latestAiMessage.createdAt > triggerMessage.createdAt) {
      console.log("[ai] skipped stale job", {
        reason: "already_replied_after_trigger",
        triggerMessageId: triggerMessage.id,
        latestAiMessageId: latestAiMessage.id,
      });
      return;
    }
  }

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());

  const [psychologistPolicy, conversationPolicy] = await Promise.all([
    prisma.aiPolicy.findFirst({
      where: {
        tenantId: job.tenantId,
        ownerUserId: conversation.psychologistUserId,
        conversationId: null,
      },
    }),
    prisma.aiPolicy.findFirst({
      where: { tenantId: job.tenantId, conversationId: conversation.id },
    }),
  ]);

  const messages = await prisma.message.findMany({
    where: { tenantId: job.tenantId, conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const decrypted = messages
    .slice()
    .reverse()
    .map((message) => ({
      ...message,
      content: decryptMessage(message.ciphertext, message.iv, message.authTag, dek),
    }));

  const lastPatient = [...decrypted]
    .reverse()
    .find((message) => message.authorType === "PATIENT");
  const signalConfig = resolveSignalConfig(
    (psychologistPolicy?.flagsJson as { signalConfig?: unknown })?.signalConfig as
      | Partial<SignalConfig>
      | undefined,
  );
  const signals = detectSignals(lastPatient?.content ?? "", signalConfig);

  const settings = (psychologistPolicy?.flagsJson as {
    aiSettings?: {
      maxTokens?: number;
      maxTurns?: number;
      temperature?: number;
      disableEpisodeLimit?: boolean;
    };
  })?.aiSettings;
  const disableEpisodeLimit = Boolean(settings?.disableEpisodeLimit);
  const maxTurns = disableEpisodeLimit
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, Math.min(settings?.maxTurns ?? DEFAULT_MAX_TURNS, 10));
  const maxTokens = Math.max(
    50,
    Math.min(settings?.maxTokens ?? DEFAULT_MAX_TOKENS, 2000),
  );
  const temperature = Math.max(
    0,
    Math.min(settings?.temperature ?? DEFAULT_TEMPERATURE, 1),
  );

  const episode = await getOrCreateEpisode({
    tenantId: job.tenantId,
    conversationId: conversation.id,
    maxTurns,
  });

  let reply = "";
  let closeEpisode = false;

  const remainingTurns = maxTurns - episode.aiTurnsUsed;

  const policy = mergePolicies({
    psychologistPolicy: psychologistPolicy?.policyText,
    conversationPolicy: conversationPolicy?.policyText,
  });

  const patientLanguage =
    (conversation.patient?.patientProfile as {
      preferredLanguage?: keyof typeof LANGUAGE_DIRECTIVE;
    })?.preferredLanguage ?? "ES";
  const workerLanguage =
    (patientLanguage as keyof typeof WORKER_COPY) ?? "ES";
  const sequentialFlowMode =
    process.env.AI_FLOW_SEQUENTIAL_MODE !== "false";
  const signalDirectives = SIGNAL_DIRECTIVES[workerLanguage];
  const flowDisciplineDirective =
    workerLanguage === "PT"
      ? "Quando fizer perguntas, faca no maximo 1 pergunta por mensagem, sem listas e sem repeticao no mesmo registro. Em fechamentos, proponha no maximo 3 acoes simples."
      : workerLanguage === "EN"
        ? "When asking questions, ask at most 1 question per message, no list, and avoid repetition in the same check-in. In closings, suggest at most 3 simple actions."
        : "Cuando hagas preguntas, haz como maximo 1 pregunta por mensaje, sin listas, y evita repeticion en el mismo registro. En cierres, propone como maximo 3 acciones simples.";
  const extraDirectives = [
    LANGUAGE_DIRECTIVE[patientLanguage],
    signals.anger ? signalDirectives.anger : "",
    signals.disconnect ? signalDirectives.disconnect : "",
    signals.rumination ? signalDirectives.rumination : "",
    signals.highRisk ? signalDirectives.highRisk : "",
    flowDisciplineDirective,
    WORKER_COPY[workerLanguage].noLeak,
  ]
    .filter(Boolean)
    .join(" ");

  const prompt = `${policy}\n\n${extraDirectives}`.trim();
  const context = decrypted.map((message) => {
    if (message.authorType === "PATIENT") {
      return { role: "user" as const, content: message.content };
    }
    if (message.authorType === "PSYCHOLOGIST") {
      return { role: "assistant" as const, content: `Psicologo: ${message.content}` };
    }
    return { role: "assistant" as const, content: message.content };
  });
  const flowConfig = getFlowConfig();
  const now = new Date();
  const [activeFlow, latestFlow, currentEvent] = await Promise.all([
    prismaAny.aiFlowSession.findFirst({
      where: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
        status: "ACTIVE",
      },
      orderBy: { updatedAt: "desc" },
    }),
    prismaAny.aiFlowSession.findFirst({
      where: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prismaAny.aiEventSession.findFirst({
      where: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
        status: "OPEN",
      },
      select: {
        id: true,
        status: true,
        flowSessionId: true,
        adherenceJson: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  let openEvent = currentEvent;
  let eventSessionId = openEvent?.id ?? null;

  let pendingFlowStep = activeFlow
    ? await prismaAny.aiFlowStep.findFirst({
        where: {
          tenantId: job.tenantId,
          conversationId: conversation.id,
          flowSessionId: activeFlow.id,
          state: "PENDING",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true, messageId: true, expiresAt: true },
      })
    : null;

  if (pendingFlowStep?.expiresAt && pendingFlowStep.expiresAt <= now) {
    await prismaAny.aiFlowStep.updateMany({
      where: { id: pendingFlowStep.id, tenantId: job.tenantId, state: "PENDING" },
      data: { state: "EXPIRED" },
    });
    pendingFlowStep = null;
  }

  if (pendingFlowStep && job.triggerMessageId) {
    const triggerMessage = await prisma.message.findFirst({
      where: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
        id: job.triggerMessageId,
      },
      select: { createdAt: true },
    });
    if (triggerMessage && pendingFlowStep.createdAt < triggerMessage.createdAt) {
      await prismaAny.aiFlowStep.updateMany({
        where: { id: pendingFlowStep.id, tenantId: job.tenantId, state: "PENDING" },
        data: { state: "DISMISSED", answeredAt: now },
      });
      pendingFlowStep = null;
    }
  }

  const ensureOpenEventSession = async (flowSessionId?: string | null) => {
    if (openEvent) {
      if (flowSessionId && !openEvent.flowSessionId) {
        await prismaAny.aiEventSession.updateMany({
          where: { id: openEvent.id, tenantId: job.tenantId },
          data: { flowSessionId },
        });
        openEvent = {
          ...openEvent,
          flowSessionId,
        };
      }
      eventSessionId = openEvent.id;
      return openEvent.id;
    }

    const createdEvent = await prismaAny.aiEventSession.create({
      data: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
        patientUserId: conversation.patientUserId,
        status: "OPEN",
        flowSessionId: flowSessionId ?? null,
      },
    });
    eventSessionId = createdEvent.id;
    openEvent = {
      id: createdEvent.id,
      status: "OPEN",
      flowSessionId: flowSessionId ?? null,
      adherenceJson: null,
      updatedAt: new Date(),
    };
    return createdEvent.id;
  };

  const recentStructuredResponses = await prismaAny.aiFlowStep.findMany({
    where: {
      tenantId: job.tenantId,
      conversationId: conversation.id,
      state: "ANSWERED",
      answeredAt: {
        gte: new Date(now.getTime() - 72 * 60 * 60 * 1000),
      },
    },
    orderBy: { answeredAt: "desc" },
    take: 20,
    select: {
      id: true,
      answeredAt: true,
      answerJson: true,
      uiSpecJson: true,
    },
  });

  try {
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    await storePromptSnapshot({
      tenantId: job.tenantId,
      conversationId: conversation.id,
      createdAt: new Date().toISOString(),
      model,
      messages: [{ role: "system", content: prompt }, ...context],
    });
  } catch (error) {
    console.error("[ai] prompt snapshot failed:", (error as Error).message);
  }

  let flowUiSpec: UiSpec | null = null;
  let flowSessionIdForStep: string | null = activeFlow?.id ?? null;
  let flowSessionStepCount = activeFlow?.stepCount ?? 0;
  let flowNextTarget: string | null = activeFlow?.lastTarget ?? null;
  let flowConfidenceJson: Record<string, unknown> | null = null;
  let shouldFinalizeFlow = false;
  let isFlowQuestionReply = false;
  let flowCloseReason: string | null = null;
  let finalizedFlowSessionId: string | null = null;
  const engagementStyle = resolveEngagementStyle({
    burdenScore: activeFlow?.burdenScore,
    ignoredUiCount: activeFlow?.ignoredUiCount,
    stepCount: activeFlow?.stepCount ?? 0,
  });

  if (job.eventCloseRequest) {
    shouldFinalizeFlow = true;
    flowCloseReason = "manual_close";
    closeEpisode = !disableEpisodeLimit;
    try {
      const closePrompt =
        workerLanguage === "PT"
          ? "Voce esta encerrando um registro do paciente. Responda em portugues, com no maximo 1 frase de acolhimento e 2 ou 3 acoes praticas em lista. Nao faca perguntas. Nao ultrapasse 7 linhas."
          : workerLanguage === "EN"
            ? "You are closing the patient's check-in. Reply in English with at most one supportive sentence and 2 or 3 practical actions as a list. Do not ask questions. Keep it under 7 lines."
            : "Estas cerrando el registro del paciente. Responde en espanol con maximo 1 frase de apoyo y 2 o 3 acciones practicas en lista. No hagas preguntas. No mas de 7 lineas.";
      const closeContext = lastPatient?.content
        ? `Ultimo mensaje del paciente:\n${lastPatient.content}`
        : "No ultimo mensaje del paciente.";
      const rawCloseReply = await callOpenAi({
        messages: [
          { role: "system", content: `${prompt}\n\n${closePrompt}`.trim() },
          { role: "user", content: closeContext },
        ],
        maxTokens: Math.min(maxTokens, 220),
        temperature: Math.min(temperature, 0.35),
      });
      reply = sanitizeEventClosedReply(rawCloseReply, workerLanguage);
    } catch (error) {
      console.error("[ai] event close generation failed:", (error as Error).message);
      reply = buildEventClosedFallbackReply(workerLanguage);
    }
  } else if (signals.highRisk) {
    reply = buildSafetyReply(workerLanguage);
    shouldFinalizeFlow = true;
    flowCloseReason = "high_risk";
    closeEpisode = !disableEpisodeLimit;
  } else if (!disableEpisodeLimit && remainingTurns <= 0) {
    reply = buildClosingReply(workerLanguage);
    shouldFinalizeFlow = true;
    flowCloseReason = "episode_limit";
    closeEpisode = true;
  } else {
    const canAskSequentialFlowQuestion = Boolean(
      sequentialFlowMode &&
        activeFlow &&
        activeFlow.status === "ACTIVE" &&
        !pendingFlowStep &&
        activeFlow.stepCount < flowConfig.maxSteps,
    );

    if (canAskSequentialFlowQuestion && activeFlow) {
      const targets = getFlowTargets(activeFlow.targetsJson);
      const targetIndex = Math.min(activeFlow.stepCount, targets.length - 1);
      const nextTarget = targets[targetIndex] ?? DEFAULT_FLOW_TARGETS[0];
      flowSessionIdForStep = activeFlow.id;
      flowSessionStepCount = activeFlow.stepCount;
      flowNextTarget = nextTarget;
      flowConfidenceJson = safeJsonObject(activeFlow.confidenceJson);
      try {
        const questionDirective =
          workerLanguage === "PT"
            ? `Voce esta em coleta de check-in emocional (alvo: ${nextTarget}). Responda com exatamente 1 pergunta curta (maximo 18 palavras), sem lista, sem explicacoes, sem multiplas perguntas.`
            : workerLanguage === "EN"
              ? `You are in an emotional check-in flow (target: ${nextTarget}). Reply with exactly 1 short question (max 18 words), no list, no explanation, no multiple questions.`
              : `Estas en flujo de check-in emocional (objetivo: ${nextTarget}). Responde con exactamente 1 pregunta corta (maximo 18 palabras), sin lista, sin explicaciones, sin multiples preguntas.`;

        const flowQuestion = await callOpenAi({
          messages: [
            { role: "system", content: `${prompt}\n\n${questionDirective}`.trim() },
            ...context,
          ],
          maxTokens: Math.min(maxTokens, 140),
          temperature: Math.min(temperature, 0.35),
        });
        reply = sanitizeSingleQuestion(flowQuestion, workerLanguage);
      } catch (error) {
        console.error("[ai] flow question generation failed:", (error as Error).message);
        const fallback = buildSequentialFlowPrompt(
          workerLanguage,
          nextTarget,
          engagementStyle,
        );
        reply = fallback.prompt;
      }
    } else {
      if (activeFlow && activeFlow.stepCount >= flowConfig.maxSteps) {
        shouldFinalizeFlow = true;
        flowCloseReason = "max_steps";
      }
      try {
        const openAiStartedAt = Date.now();
        console.log("[ai] calling OpenAI", {
          model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          maxTokens,
          temperature,
          messages: context.length,
        });
        reply = await callOpenAi({
          messages: [{ role: "system", content: prompt }, ...context],
          maxTokens,
          temperature,
        });
        console.log("[ai] OpenAI reply length", reply?.length ?? 0, {
          elapsedMs: Date.now() - openAiStartedAt,
        });
      } catch (error) {
        console.error("[ai] OpenAI error:", (error as Error).message);
        console.error("[ai] OpenAI error stack:", (error as Error).stack ?? "no stack");
        reply = buildUnavailableReply(workerLanguage);
        closeEpisode = !disableEpisodeLimit;
      }

      if (!reply) {
        if (!disableEpisodeLimit) {
          reply = buildClosingReply(workerLanguage);
          closeEpisode = true;
        }
        console.error("[ai] Empty reply after OpenAI call; using fallback", {
          disableEpisodeLimit,
          remainingTurns,
          model: process.env.OPENAI_MODEL,
        });
      } else if (!disableEpisodeLimit && remainingTurns === 1) {
        reply = `${reply} ${buildClosingReply(workerLanguage)}`.trim();
        closeEpisode = true;
      }
    }
  }

  const ignoreCooldown =
    process.env.AI_FLOW_IGNORE_COOLDOWN === "true" ||
    flowConfig.cooldownHours === 0;
  const inCooldown = Boolean(
    !ignoreCooldown &&
      !activeFlow &&
      !openEvent &&
      latestFlow?.cooldownUntil &&
      latestFlow.cooldownUntil > now,
  );
  const canEvaluateFlow = Boolean(
    !job.eventCloseRequest &&
    !closeEpisode &&
    !signals.highRisk &&
    reply &&
    !isFlowQuestionReply &&
    !pendingFlowStep &&
    (!inCooldown || Boolean(activeFlow)),
  );
  if (!canEvaluateFlow) {
    console.log("[ai] flow skipped", {
      eventCloseRequest: Boolean(job.eventCloseRequest),
      flowContinuation: Boolean(job.flowContinuation),
      closeEpisode,
      highRisk: signals.highRisk,
      hasReply: Boolean(reply),
      hasPendingFlowStep: Boolean(pendingFlowStep),
      inCooldown,
      ignoreCooldown,
      activeFlowStatus: activeFlow?.status ?? null,
      latestFlowCooldownUntil: latestFlow?.cooldownUntil?.toISOString?.() ?? null,
    });
  }

  if (canEvaluateFlow) {
    const avgResponseLength =
      recentStructuredResponses.length > 0
        ? Math.round(
            recentStructuredResponses.reduce((sum, item) => {
              const answer = safeJsonObject(item.answerJson);
              const label = answer.label;
              const value = answer.value;
              const content =
                typeof label === "string"
                  ? label
                  : typeof value === "string"
                    ? value
                    : "";
              return sum + content.length;
            }, 0) / recentStructuredResponses.length,
          )
        : 0;

    const responseDelays = recentStructuredResponses
      .map((item) => {
        if (!item.answeredAt) {
          return null;
        }
        return Math.max(
          0,
          Math.round((item.answeredAt.getTime() - now.getTime()) / 1000) * -1,
        );
      })
      .filter((value): value is number => value !== null);
    const avgDelaySec =
      responseDelays.length > 0
        ? Math.round(
            responseDelays.reduce((sum, value) => sum + value, 0) /
              responseDelays.length,
          )
        : 0;

    try {
      const orchestrator = await runFlowOrchestrator({
        assistantText: reply,
        patientLastMessage: lastPatient?.content ?? "",
        flowSessionSummary: activeFlow
          ? {
              id: activeFlow.id,
              status: activeFlow.status,
              stepCount: activeFlow.stepCount,
              ignoredUiCount: activeFlow.ignoredUiCount,
              burdenScore: activeFlow.burdenScore,
              maxSteps: activeFlow.maxSteps,
              lastTarget: activeFlow.lastTarget,
            }
          : null,
        recentStructuredResponses: recentStructuredResponses.map((item) => ({
          id: item.id,
          answeredAt: item.answeredAt?.toISOString(),
          answerJson: item.answerJson,
          uiSpecJson: item.uiSpecJson,
        })),
        burdenSignals: {
          ignored_ui_count: activeFlow?.ignoredUiCount ?? 0,
          burden_score: activeFlow?.burdenScore ?? 0,
          avg_response_length: avgResponseLength,
          time_to_respond_sec_avg: avgDelaySec,
        },
        patientLanguage,
      });

      if (orchestrator) {
        flowNextTarget = orchestrator.nextTarget;
        flowConfidenceJson = safeJsonObject(orchestrator.patientStateEstimate ?? {});

        const maxStepsReached = flowSessionStepCount >= flowConfig.maxSteps;
        const confidenceReached =
          (orchestrator.averageConfidence ?? 0) >= flowConfig.confidenceThreshold;

        if (
          orchestrator.shouldRenderUi &&
          orchestrator.uiSpec &&
          !maxStepsReached &&
          !confidenceReached
        ) {
          if (!flowSessionIdForStep) {
            const createdFlow = await prismaAny.aiFlowSession.create({
              data: {
                tenantId: job.tenantId,
                conversationId: conversation.id,
                patientUserId: conversation.patientUserId,
                status: "ACTIVE",
                maxSteps: flowConfig.maxSteps,
                targetsJson: getDefaultFlowTargets(),
                confidenceJson: flowConfidenceJson ?? {},
                lastTarget: orchestrator.nextTarget ?? null,
              },
            });
            flowSessionIdForStep = createdFlow.id;
            flowSessionStepCount = createdFlow.stepCount;
            await ensureOpenEventSession(createdFlow.id);
          }
          flowUiSpec = orchestrator.uiSpec;
        }

        if (
          activeFlow &&
          (maxStepsReached ||
            confidenceReached ||
            !orchestrator.shouldContinueFlow)
        ) {
          shouldFinalizeFlow = true;
          flowCloseReason = maxStepsReached
            ? "max_steps"
            : confidenceReached
              ? "confidence_reached"
              : "orchestrator_stop";
        }
      }
    } catch (error) {
      console.error("[ai] flow orchestrator failed:", (error as Error).message);
    }

    if (sequentialFlowMode) {
      const canStillAskFlowQuestion =
        flowSessionStepCount < flowConfig.maxSteps &&
        !shouldFinalizeFlow;

      if (flowUiSpec && canStillAskFlowQuestion) {
        isFlowQuestionReply = true;
      } else if (!flowUiSpec && canStillAskFlowQuestion) {
        const targets = getFlowTargets(activeFlow?.targetsJson);
        const targetIndex = Math.min(flowSessionStepCount, targets.length - 1);
        const nextTarget = targets[targetIndex] ?? DEFAULT_FLOW_TARGETS[0];
        const followUp = buildSequentialFlowPrompt(
          workerLanguage,
          nextTarget,
          engagementStyle,
        );

        flowUiSpec = {
          component: "choice_buttons",
          prompt: followUp.prompt,
          multiple: false,
          options: followUp.options,
          allow_free_text: true,
          store_as: {
            domain: "mood_checkin",
            keys: [nextTarget],
          },
          constraints: {
            max_selections: 1,
            expires_in_seconds: 86400,
          },
        };
        flowNextTarget = nextTarget;
        flowConfidenceJson = flowConfidenceJson ?? safeJsonObject(activeFlow?.confidenceJson);
        if (!reply) {
          reply = followUp.prompt;
        }
        isFlowQuestionReply = true;
      }
    }
  } else if (activeFlow && (closeEpisode || signals.highRisk)) {
    shouldFinalizeFlow = true;
    if (!flowCloseReason) {
      flowCloseReason = signals.highRisk ? "high_risk" : "episode_close";
    }
  }

  const encryptedReply = encryptMessage(reply, dek);
  const aiMessage = await prisma.message.create({
    data: {
      tenantId: job.tenantId,
      conversationId: conversation.id,
      direction: "OUT",
      authorType: "AI",
      ciphertext: encryptedReply.ciphertext,
      iv: encryptedReply.iv,
      authTag: encryptedReply.authTag,
    },
  });

  if (flowUiSpec && !flowSessionIdForStep) {
    const createdFlow = await prismaAny.aiFlowSession.create({
      data: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
        patientUserId: conversation.patientUserId,
        status: "ACTIVE",
        maxSteps: flowConfig.maxSteps,
        targetsJson: activeFlow?.targetsJson ?? getDefaultFlowTargets(),
        confidenceJson: flowConfidenceJson ?? {},
        lastTarget: flowNextTarget,
      },
    });
    flowSessionIdForStep = createdFlow.id;
    flowSessionStepCount = createdFlow.stepCount;
    await ensureOpenEventSession(createdFlow.id);
  }

  if (flowUiSpec && flowSessionIdForStep) {
    await ensureOpenEventSession(flowSessionIdForStep);
    await prismaAny.aiFlowStep.create({
      data: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
        flowSessionId: flowSessionIdForStep,
        messageId: aiMessage.id,
        uiSpecJson: flowUiSpec,
        expiresAt: new Date(
          now.getTime() + (flowUiSpec.constraints?.expires_in_seconds ?? 86400) * 1000,
        ),
      },
    });
    console.log("[ai] flow step created", {
      flowSessionId: flowSessionIdForStep,
      prompt: flowUiSpec.prompt,
      options: flowUiSpec.options.length,
    });

    await prismaAny.aiFlowSession.updateMany({
      where: { id: flowSessionIdForStep, tenantId: job.tenantId },
      data: {
        status: "ACTIVE",
        stepCount: flowSessionStepCount + 1,
        maxSteps: flowConfig.maxSteps,
        lastTarget: flowNextTarget,
        confidenceJson: flowConfidenceJson ?? undefined,
      },
    });
  } else if (activeFlow && shouldFinalizeFlow) {
    await prismaAny.aiFlowSession.updateMany({
      where: { id: activeFlow.id, tenantId: job.tenantId },
      data: {
        status: "COMPLETED",
        cooldownUntil: addHours(now, flowConfig.cooldownHours),
        lastTarget: flowNextTarget,
        confidenceJson: flowConfidenceJson ?? undefined,
      },
    });
    finalizedFlowSessionId = activeFlow.id;
  }

  if (shouldFinalizeFlow && openEvent) {
    const nextEventStatus =
      flowCloseReason === "high_risk" ? "ABORTED" : "CLOSED";
    await prismaAny.aiEventSession.updateMany({
      where: { id: openEvent.id, tenantId: job.tenantId, status: "OPEN" },
      data: {
        status: nextEventStatus,
        closedAt: now,
        closeReason: flowCloseReason ?? "flow_completed",
        flowSessionId:
          finalizedFlowSessionId ??
          flowSessionIdForStep ??
          openEvent.flowSessionId ??
          undefined,
        adherenceJson: {
          stepCount: activeFlow?.stepCount ?? flowSessionStepCount,
          maxSteps: activeFlow?.maxSteps ?? flowConfig.maxSteps,
          ignoredUiCount: activeFlow?.ignoredUiCount ?? 0,
          burdenScore: activeFlow?.burdenScore ?? 0,
        },
      },
    });
  }

  const updatedTurns = isFlowQuestionReply
    ? episode.aiTurnsUsed
    : Math.min(episode.aiTurnsUsed + 1, maxTurns);
  await prisma.aiEpisode.updateMany({
    where: { id: episode.id, tenantId: job.tenantId },
    data: {
      aiTurnsUsed: updatedTurns,
      isOpen: closeEpisode ? false : true,
    },
  });

  await logAuditEvent({
    tenantId: job.tenantId,
    action: "ai.reply",
    targetType: "Message",
    targetId: aiMessage.id,
    meta: {
      signals: {
        anger: signals.anger,
        disconnect: signals.disconnect,
        rumination: signals.rumination,
        highRisk: signals.highRisk,
      },
      flow: {
        hasUi: Boolean(flowUiSpec),
        flowSessionId: flowSessionIdForStep,
        finalized: shouldFinalizeFlow,
        closeReason: flowCloseReason,
        eventSessionId,
      },
      triggeredAt: new Date().toISOString(),
    },
  });

  console.log("[ai] process done", {
    conversationId: conversation.id,
    elapsedMs: Date.now() - startedAt,
  });
}
