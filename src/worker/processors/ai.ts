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
import { getOutboundQueue } from "@/lib/queues";
import { logAuditEvent } from "@/lib/audit";

type AiJob = {
  tenantId: string;
  conversationId: string;
  triggerMessageId?: string;
};

const DEFAULT_MAX_TURNS = 3;
const DEFAULT_MAX_TOKENS = 300;
const DEFAULT_TEMPERATURE = 0.4;
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

export async function processAi(job: AiJob) {
  const conversation = await prisma.conversation.findFirst({
    where: { tenantId: job.tenantId, id: job.conversationId },
    include: { patient: { include: { patientProfile: true } } },
  });
  if (!conversation || !conversation.aiEnabled) {
    return;
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
    aiSettings?: { maxTokens?: number; maxTurns?: number; temperature?: number };
  })?.aiSettings;
  const maxTurns = Math.max(1, Math.min(settings?.maxTurns ?? DEFAULT_MAX_TURNS, 10));
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
  const signalDirectives = SIGNAL_DIRECTIVES[workerLanguage];
  const extraDirectives = [
    LANGUAGE_DIRECTIVE[patientLanguage],
    signals.anger ? signalDirectives.anger : "",
    signals.disconnect ? signalDirectives.disconnect : "",
    signals.rumination ? signalDirectives.rumination : "",
    signals.highRisk ? signalDirectives.highRisk : "",
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
    // eslint-disable-next-line no-console
    console.error("[ai] prompt snapshot failed:", (error as Error).message);
  }

  if (signals.highRisk) {
    reply = buildSafetyReply(workerLanguage);
    closeEpisode = true;
  } else if (remainingTurns <= 0) {
    reply = buildClosingReply(workerLanguage);
    closeEpisode = true;
  } else {
    try {
      reply = await callOpenAi({
        messages: [{ role: "system", content: prompt }, ...context],
        maxTokens,
        temperature,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[ai] OpenAI error:", (error as Error).message);
      reply = buildUnavailableReply(workerLanguage);
      closeEpisode = true;
    }

    if (!reply) {
      reply = buildClosingReply(workerLanguage);
      closeEpisode = true;
    } else if (remainingTurns === 1) {
      reply = `${reply} ${buildClosingReply(workerLanguage)}`.trim();
      closeEpisode = true;
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

  const updatedTurns = Math.min(episode.aiTurnsUsed + 1, maxTurns);
  await prisma.aiEpisode.updateMany({
    where: { id: episode.id, tenantId: job.tenantId },
    data: {
      aiTurnsUsed: updatedTurns,
      isOpen: closeEpisode ? false : episode.isOpen,
    },
  });

  await getOutboundQueue().add("outbound_send_retry", {
    tenantId: job.tenantId,
    conversationId: conversation.id,
    messageId: aiMessage.id,
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
      triggeredAt: new Date().toISOString(),
    },
  });
}
