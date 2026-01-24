import { prisma } from "@/lib/prisma";
import { decryptDek, decryptMessage, getMasterKek } from "@/lib/crypto";
import { sendEvolutionMessage } from "@/lib/evolution";
import { logAuditEvent } from "@/lib/audit";

type OutboundJob = {
  tenantId: string;
  conversationId: string;
  messageId: string;
};

export async function processOutbound(job: OutboundJob) {
  const [conversation, message] = await Promise.all([
    prisma.conversation.findFirst({
      where: { tenantId: job.tenantId, id: job.conversationId },
    }),
    prisma.message.findFirst({
      where: { tenantId: job.tenantId, id: job.messageId },
    }),
  ]);

  if (!conversation || !message) {
    return;
  }

  if (message.direction !== "OUT") {
    return;
  }

  const patient = await prisma.patientProfile.findFirst({
    where: { userId: conversation.patientUserId },
  });

  if (!patient) {
    return;
  }

  const instance = process.env.EVOLUTION_INSTANCE;
  if (!instance) {
    throw new Error("EVOLUTION_INSTANCE is not configured");
  }

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const content = decryptMessage(message.ciphertext, message.iv, message.authTag, dek);

  await sendEvolutionMessage({
    instance,
    to: patient.phoneE164,
    message: content,
  });

  await logAuditEvent({
    tenantId: job.tenantId,
    action: "message.outbound",
    targetType: "Message",
    targetId: message.id,
  });
}
