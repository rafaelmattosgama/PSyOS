import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireStepUp } from "@/lib/auth/guards";
import { decryptDek, decryptMessage, getMasterKek } from "@/lib/crypto";
import { logAuditEvent } from "@/lib/audit";

const querySchema = z.object({
  conversationId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  const { user, session } = await requireAuth();
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limitParsed = limitRaw ? Number(limitRaw) : undefined;
  const query = querySchema.parse({
    conversationId: url.searchParams.get("conversationId"),
    limit: Number.isFinite(limitParsed) ? limitParsed : undefined,
  });

  if (user.role === "ADMIN") {
    requireStepUp(session.stepUpUntil);
  }

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
    userId: user.id,
    role: user.role,
  });

  const messages = await prisma.message.findMany({
    where: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
    },
    orderBy: { createdAt: "asc" },
    take: query.limit ?? 50,
  });

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const items = messages.map((message) => ({
    id: message.id,
    direction: message.direction,
    authorType: message.authorType,
    createdAt: message.createdAt,
    content: decryptMessage(message.ciphertext, message.iv, message.authTag, dek),
    hasAttachment: Boolean((message as { attachmentCiphertext?: string }).attachmentCiphertext),
    attachmentMime: (message as { attachmentMime?: string | null }).attachmentMime ?? null,
  }));

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "message.read",
    targetType: "Conversation",
    targetId: conversation.id,
  });

  return NextResponse.json({ items });
}
