import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptDek, encryptMessage, getMasterKek } from "@/lib/crypto";
import { aiQueue } from "@/lib/queues";
import { logAuditEvent } from "@/lib/audit";

type InboundJob = {
  tenantId: string;
  externalMessageId?: string;
  fromPhone: string;
  text: string;
  source: "whatsapp" | "web";
};

export async function processInbound(job: InboundJob) {
  const patient = await prisma.user.findFirst({
    where: {
      tenantId: job.tenantId,
      role: "PATIENT",
      patientProfile: { phoneE164: job.fromPhone },
    },
  });

  if (!patient) {
    await logAuditEvent({
      tenantId: job.tenantId,
      action: "inbound.ignored",
      targetType: "Patient",
      targetId: null,
      meta: { reason: "patient_not_found" },
    });
    return;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: job.tenantId,
      patientUserId: patient.id,
      status: "OPEN",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!conversation) {
    await logAuditEvent({
      tenantId: job.tenantId,
      actorUserId: patient.id,
      action: "inbound.ignored",
      targetType: "Conversation",
      targetId: null,
      meta: { reason: "conversation_not_found" },
    });
    return;
  }

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const encrypted = encryptMessage(job.text, dek);

  let message;
  try {
    message = await prisma.message.create({
      data: {
        tenantId: job.tenantId,
        conversationId: conversation.id,
        direction: "IN",
        authorType: "PATIENT",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        externalMessageId: job.externalMessageId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }

  if (!message) {
    return;
  }

  if (conversation.aiEnabled) {
    await aiQueue.add("ai_reply_generate", {
      tenantId: job.tenantId,
      conversationId: conversation.id,
      triggerMessageId: message.id,
    });
  }

  await logAuditEvent({
    tenantId: job.tenantId,
    actorUserId: patient.id,
    action: "message.inbound",
    targetType: "Message",
    targetId: message.id,
    meta: { source: job.source },
  });
}
