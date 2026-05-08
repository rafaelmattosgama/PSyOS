import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireStepUp } from "@/lib/auth/guards";
import { decryptDek, decryptMessage, getMasterKek } from "@/lib/crypto";
import { logAuditEvent } from "@/lib/audit";
import { uiSpecSchema } from "@/lib/ai/flow";

const prismaAny = prisma as typeof prisma & {
  aiFlowStep: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        flowSessionId: string;
        messageId: string;
        state: "PENDING" | "ANSWERED" | "EXPIRED" | "DISMISSED";
        uiSpecJson: unknown;
        expiresAt: Date | null;
      }>
    >;
  };
};

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
    orderBy: { createdAt: "desc" },
    take: query.limit ?? 50,
  });
  const messageIds = messages.map((message) => message.id);
  const flowSteps =
    messageIds.length > 0
      ? await prismaAny.aiFlowStep.findMany({
          where: {
            tenantId: user.tenantId,
            messageId: { in: messageIds },
          },
          select: {
            id: true,
            flowSessionId: true,
            messageId: true,
            state: true,
            uiSpecJson: true,
            expiresAt: true,
          },
        })
      : [];
  const flowStepByMessageId = new Map(
    flowSteps.map((step) => [step.messageId, step]),
  );

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const now = Date.now();
  const items = messages
    .slice()
    .reverse()
    .map((message) => ({
      ...(function () {
        const step = flowStepByMessageId.get(message.id);
        if (!step) {
          return {};
        }
        if (step.state !== "PENDING") {
          return {};
        }
        if (step.expiresAt && step.expiresAt.getTime() < now) {
          return {};
        }
        const parsedUi = uiSpecSchema.safeParse(step.uiSpecJson);
        if (!parsedUi.success) {
          return {};
        }
        return {
          interactive: {
            flowId: step.flowSessionId,
            stepId: step.id,
            state: step.state,
            uiSpec: parsedUi.data,
          },
        };
      })(),
      id: message.id,
      direction: message.direction,
      authorType: message.authorType,
      createdAt: message.createdAt,
      deletedAt: message.deletedAt,
      content: message.deletedAt
        ? ""
        : decryptMessage(message.ciphertext, message.iv, message.authTag, dek),
      hasAttachment: message.deletedAt
        ? false
        : Boolean(
            (message as { attachmentCiphertext?: string }).attachmentCiphertext,
          ),
      attachmentMime: message.deletedAt
        ? null
        : (message as { attachmentMime?: string | null }).attachmentMime ?? null,
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
