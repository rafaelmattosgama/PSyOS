import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireAuth,
  requireConversationAccess,
  requireRole,
} from "@/lib/auth/guards";
import { getAiQueue } from "@/lib/queues";
import { getFlowConfig } from "@/lib/ai/flow";
import { logAuditEvent } from "@/lib/audit";

const querySchema = z.object({
  conversationId: z.string().min(1),
});

const closeSchema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
});

const prismaAny = prisma as typeof prisma & {
  aiEventSession: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      status: "OPEN" | "CLOSED" | "ABORTED";
      flowSessionId: string | null;
      startedAt: Date;
    } | null>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiFlowSession: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      stepCount: number;
      maxSteps: number;
      status: "IDLE" | "ACTIVE" | "COMPLETED" | "ABORTED";
    } | null>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiFlowStep: {
    count: (args: unknown) => Promise<number>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

export async function GET(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST", "PATIENT", "ADMIN"]);

  const url = new URL(request.url);
  const query = querySchema.parse({
    conversationId: url.searchParams.get("conversationId"),
  });

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
    userId: user.id,
    role: user.role,
  });

  const openEvent = await prismaAny.aiEventSession.findFirst({
    where: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      status: "OPEN",
    },
    orderBy: { updatedAt: "desc" },
  });
  const activeFlow = await prismaAny.aiFlowSession.findFirst({
    where: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!openEvent && !activeFlow) {
    return NextResponse.json({ item: null });
  }

  const pendingSteps = activeFlow
    ? await prismaAny.aiFlowStep.count({
        where: {
          tenantId: user.tenantId,
          conversationId: conversation.id,
          flowSessionId: activeFlow.id,
          state: "PENDING",
        },
      })
    : 0;

  return NextResponse.json({
    item: {
      eventId: openEvent?.id ?? null,
      eventStatus: openEvent?.status ?? null,
      eventStartedAt: openEvent?.startedAt ?? null,
      flowId: activeFlow?.id ?? null,
      status: activeFlow?.status ?? openEvent?.status ?? null,
      stepCount: activeFlow?.stepCount ?? 0,
      maxSteps: activeFlow?.maxSteps ?? 0,
      pendingSteps,
    },
  });
}

export async function POST(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST", "PATIENT"]);

  const body = closeSchema.parse(await request.json());
  if (body.tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: body.conversationId,
    userId: user.id,
    role: user.role,
  });

  const openEvent = await prismaAny.aiEventSession.findFirst({
    where: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      status: "OPEN",
    },
    orderBy: { updatedAt: "desc" },
  });
  const activeFlow = await prismaAny.aiFlowSession.findFirst({
    where: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      status: "ACTIVE",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!openEvent && !activeFlow) {
    return NextResponse.json({ ok: true, closed: false, queuedAi: false });
  }

  const now = new Date();
  const flowConfig = getFlowConfig();
  if (activeFlow) {
    await prismaAny.aiFlowStep.updateMany({
      where: {
        tenantId: user.tenantId,
        conversationId: conversation.id,
        flowSessionId: activeFlow.id,
        state: "PENDING",
      },
      data: {
        state: "DISMISSED",
        answeredAt: now,
        answerJson: {
          source: "manual_close",
          actorRole: user.role,
          timestamp: now.toISOString(),
        },
      },
    });

    await prismaAny.aiFlowSession.updateMany({
      where: {
        id: activeFlow.id,
        tenantId: user.tenantId,
      },
      data: {
        status: "COMPLETED",
        cooldownUntil: addHours(now, flowConfig.cooldownHours),
      },
    });
  }

  if (openEvent) {
    await prismaAny.aiEventSession.updateMany({
      where: {
        id: openEvent.id,
        tenantId: user.tenantId,
        status: "OPEN",
      },
      data: {
        status: "CLOSED",
        closeReason: "manual_close",
        closedAt: now,
        adherenceJson: activeFlow
          ? {
              stepCount: activeFlow.stepCount,
              maxSteps: activeFlow.maxSteps,
            }
          : undefined,
      },
    });
  }

  let queuedAi = false;
  if (user.role === "PATIENT" && conversation.aiEnabled) {
    await getAiQueue().add("ai_reply_generate", {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      eventCloseRequest: true,
    });
    queuedAi = true;
  }

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "flow.manual_close",
    targetType: "AiEventSession",
    targetId: openEvent?.id ?? activeFlow?.id ?? null,
    meta: {
      queuedAi,
      actorRole: user.role,
      flowId: activeFlow?.id ?? null,
    },
  });

  return NextResponse.json({ ok: true, closed: true, queuedAi });
}
