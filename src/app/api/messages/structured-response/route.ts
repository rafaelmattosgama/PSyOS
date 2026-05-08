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
import { getFlowConfig, uiSpecSchema } from "@/lib/ai/flow";

const prismaAny = prisma as typeof prisma & {
  aiFlowStep: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      tenantId: string;
      conversationId: string;
      flowSessionId: string;
      state: "PENDING" | "ANSWERED" | "EXPIRED" | "DISMISSED";
      uiSpecJson: unknown;
      expiresAt: Date | null;
      flowSession: {
        id: string;
        ignoredUiCount: number;
        burdenScore: number;
      };
    } | null>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiFlowSession: {
    updateMany: (args: unknown) => Promise<unknown>;
  };
  aiEventSession: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

const selectionSchema = z.object({
  optionId: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(120).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  freeText: z.string().trim().min(1).max(4000).optional(),
});

const schema = z
  .object({
    tenantId: z.string().min(1),
    conversationId: z.string().min(1),
    flowId: z.string().min(1),
    stepId: z.string().min(1),
    selection: selectionSchema,
  })
  .refine(
    (payload) =>
      Boolean(
        payload.selection.optionId ||
          payload.selection.freeText ||
          payload.selection.label ||
          payload.selection.value !== undefined,
      ),
    {
      message: "Selection is required",
      path: ["selection"],
    },
  );

function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

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

  const flowStep = await prismaAny.aiFlowStep.findFirst({
    where: {
      tenantId: user.tenantId,
      id: body.stepId,
      flowSessionId: body.flowId,
      conversationId: conversation.id,
    },
    include: {
      flowSession: true,
    },
  });

  if (!flowStep) {
    return NextResponse.json({ error: "Flow step not found" }, { status: 404 });
  }
  if (flowStep.state !== "PENDING") {
    return NextResponse.json({ error: "Flow step already answered" }, { status: 409 });
  }

  const now = new Date();
  if (flowStep.expiresAt && flowStep.expiresAt < now) {
    await prismaAny.aiFlowStep.updateMany({
      where: { id: flowStep.id, tenantId: user.tenantId },
      data: { state: "EXPIRED" },
    });
    return NextResponse.json({ error: "Flow step expired" }, { status: 410 });
  }

  const parsedUi = uiSpecSchema.safeParse(flowStep.uiSpecJson);
  if (!parsedUi.success) {
    return NextResponse.json({ error: "Invalid flow step UI" }, { status: 422 });
  }
  const uiSpec = parsedUi.data;

  const selectedOption = body.selection.optionId
    ? uiSpec.options.find((option) => option.id === body.selection.optionId)
    : null;
  if (body.selection.optionId && !selectedOption) {
    return NextResponse.json({ error: "Invalid option" }, { status: 400 });
  }

  const normalizedContent =
    body.selection.freeText?.trim() ||
    body.selection.label?.trim() ||
    selectedOption?.label?.trim() ||
    (body.selection.value !== undefined
      ? String(body.selection.value).trim()
      : "");

  if (!normalizedContent) {
    return NextResponse.json({ error: "Selection content is empty" }, { status: 400 });
  }

  const isOptOut =
    selectedOption?.id === "opt_out" ||
    body.selection.optionId === "opt_out" ||
    normalizedContent.toLowerCase() === "agora nao" ||
    normalizedContent.toLowerCase() === "ahora no" ||
    normalizedContent.toLowerCase() === "not now";

  const answerPayload: Record<string, unknown> = {
    optionId: selectedOption?.id ?? body.selection.optionId ?? null,
    label: normalizedContent,
    value:
      selectedOption?.value ??
      (body.selection.value !== undefined ? body.selection.value : null),
    freeText: body.selection.freeText ?? null,
    component: uiSpec.component,
    timestamp: now.toISOString(),
  };

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const encrypted = encryptMessage(normalizedContent, dek);
  const flowConfig = getFlowConfig();
  const nextBurdenScore = isOptOut
    ? Math.min(1, flowStep.flowSession.burdenScore + 0.35)
    : flowStep.flowSession.burdenScore;

  const createdMessage = isOptOut
    ? null
    : await prisma.message.create({
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

  await prismaAny.aiFlowStep.updateMany({
    where: { id: flowStep.id, tenantId: user.tenantId },
    data: {
      state: "ANSWERED",
      answerJson: answerPayload,
      answeredAt: now,
    },
  });

  await prismaAny.aiFlowSession.updateMany({
    where: { id: flowStep.flowSessionId, tenantId: user.tenantId },
    data: isOptOut
      ? {
          status: "ABORTED",
          cooldownUntil: addHours(now, flowConfig.cooldownHours),
          ignoredUiCount: flowStep.flowSession.ignoredUiCount + 1,
          burdenScore: nextBurdenScore,
        }
      : {
          status: "ACTIVE",
          burdenScore: nextBurdenScore,
        },
  });

  const openEvent = await prismaAny.aiEventSession.findFirst({
    where: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      status: "OPEN",
    },
    select: { id: true },
  });
  if (isOptOut) {
    if (openEvent) {
      await prismaAny.aiEventSession.updateMany({
        where: { id: openEvent.id, tenantId: user.tenantId, status: "OPEN" },
        data: {
          status: "ABORTED",
          closeReason: "opt_out",
          closedAt: now,
        },
      });
    }
  } else if (!openEvent) {
    await prismaAny.aiEventSession.create({
      data: {
        tenantId: user.tenantId,
        conversationId: conversation.id,
        patientUserId: conversation.patientUserId,
        status: "OPEN",
        flowSessionId: flowStep.flowSessionId,
      },
    });
  }

  let queuedAi = false;
  if (
    user.role === "PATIENT" &&
    conversation.aiEnabled &&
    !isOptOut &&
    createdMessage
  ) {
    await getAiQueue().add("ai_reply_generate", {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      triggerMessageId: createdMessage.id,
      flowContinuation: true,
    });
    queuedAi = true;
  }

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "flow.structured_response",
    targetType: "AiFlowStep",
    targetId: flowStep.id,
    meta: {
      flowId: flowStep.flowSessionId,
      queuedAi,
      isOptOut,
    },
  });

  return NextResponse.json({
    ok: true,
    messageId: createdMessage?.id ?? null,
    queuedAi,
    isOptOut,
  });
}
