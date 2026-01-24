import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireAuth,
  requireConversationAccess,
  requireRole,
} from "@/lib/auth/guards";
import { decryptDek, encryptMessage, getMasterKek } from "@/lib/crypto";
import { logAuditEvent } from "@/lib/audit";
import { aiQueue, outboundQueue } from "@/lib/queues";

const schema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  content: z.string().min(1),
});

export async function POST(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST", "PATIENT"]);
  const body = schema.parse(await request.json());

  if (body.tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: body.conversationId,
    userId: user.id,
    role: user.role,
  });

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const encrypted = encryptMessage(body.content, dek);

  const message = await prisma.message.create({
    data: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      direction: user.role === "PATIENT" ? "IN" : "OUT",
      authorType: user.role === "PATIENT" ? "PATIENT" : "PSYCHOLOGIST",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    },
  });

  if (user.role === "PATIENT" && conversation.aiEnabled) {
    await aiQueue.add("ai_reply_generate", {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      triggerMessageId: message.id,
    });
  }

  if (user.role === "PSYCHOLOGIST") {
    await outboundQueue.add("outbound_send_retry", {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      messageId: message.id,
    });
  }

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "message.send",
    targetType: "Message",
    targetId: message.id,
  });

  return NextResponse.json({ ok: true, messageId: message.id });
}
