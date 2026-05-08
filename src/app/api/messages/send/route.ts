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
import { getAiQueue } from "@/lib/queues";

const schema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  content: z.string().trim().min(1).max(4000),
});

const prismaAny = prisma as typeof prisma & {
  aiFlowStep: {
    findFirst: (args: unknown) => Promise<
      | {
          id: string;
          flowSessionId: string;
          flowSession: {
            burdenScore: number;
            ignoredUiCount: number;
          };
        }
      | null
    >;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiFlowSession: {
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiEventSession: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
};

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
  if (user.role === "PATIENT") {
    const pendingFlowStep = await prismaAny.aiFlowStep.findFirst({
      where: {
        tenantId: user.tenantId,
        conversationId: conversation.id,
        state: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      include: { flowSession: true },
    });
    if (pendingFlowStep) {
      const now = new Date();
      const burdenScore = Math.min(1, pendingFlowStep.flowSession.burdenScore + 0.2);
      await prismaAny.aiFlowStep.updateMany({
        where: {
          id: pendingFlowStep.id,
          tenantId: user.tenantId,
          state: "PENDING",
        },
        data: {
          state: "DISMISSED",
          answeredAt: now,
          answerJson: {
            label: body.content,
            freeText: true,
            source: "text",
            timestamp: now.toISOString(),
          },
        },
      });
      await prismaAny.aiFlowSession.updateMany({
        where: {
          id: pendingFlowStep.flowSessionId,
          tenantId: user.tenantId,
        },
        data: {
          burdenScore,
          ignoredUiCount: pendingFlowStep.flowSession.ignoredUiCount + 1,
        },
      });
    }
  }

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

  if (user.role === "PATIENT") {
    const openEvent = await prismaAny.aiEventSession.findFirst({
      where: {
        tenantId: user.tenantId,
        conversationId: conversation.id,
        status: "OPEN",
      },
      select: { id: true },
    });
    if (!openEvent) {
      await prismaAny.aiEventSession.create({
        data: {
          tenantId: user.tenantId,
          conversationId: conversation.id,
          patientUserId: conversation.patientUserId,
          status: "OPEN",
        },
      });
    }
  }

  if (user.role === "PATIENT" && conversation.aiEnabled) {
    await getAiQueue().add("ai_reply_generate", {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      triggerMessageId: message.id,
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
