import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth/guards";
import { encryptDek, generateDek, getMasterKek } from "@/lib/crypto";
import { logAuditEvent } from "@/lib/audit";

const createSchema = z.object({
  tenantId: z.string().min(1),
  psychologistUserId: z.string().min(1),
  patientUserId: z.string().min(1),
  aiEnabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  const { user } = await requireAuth();
  const url = new URL(request.url);
  const psychologistId = url.searchParams.get("psychologistUserId");
  const patientId = url.searchParams.get("patientUserId");

  const baseWhere: {
    tenantId: string;
    psychologistUserId?: string;
    patientUserId?: string;
  } = { tenantId: user.tenantId };

  if (user.role === "PSYCHOLOGIST") {
    baseWhere.psychologistUserId = user.id;
  }
  if (user.role === "PATIENT") {
    baseWhere.patientUserId = user.id;
  }
  if (user.role === "ADMIN") {
    if (psychologistId) {
      baseWhere.psychologistUserId = psychologistId;
    }
    if (patientId) {
      baseWhere.patientUserId = patientId;
    }
  }

  const conversations = await prisma.conversation.findMany({
    where: baseWhere,
    orderBy: { updatedAt: "desc" },
    include: {
      patient: { select: { id: true, email: true, patientProfile: true } },
      psychologist: { select: { id: true, email: true, psychologistProfile: true } },
    },
  });

  return NextResponse.json({ items: conversations });
}

export async function POST(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["ADMIN", "PSYCHOLOGIST"]);

  const body = createSchema.parse(await request.json());
  if (body.tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (user.role === "PSYCHOLOGIST" && body.psychologistUserId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const masterKek = getMasterKek();
  const dek = generateDek();
  const encryptedDek = encryptDek(dek, masterKek);

  const conversation = await prisma.conversation.create({
    data: {
      tenantId: body.tenantId,
      psychologistUserId: body.psychologistUserId,
      patientUserId: body.patientUserId,
      aiEnabled: body.aiEnabled ?? true,
      encryptedDek,
    },
  });

  await logAuditEvent({
    tenantId: body.tenantId,
    actorUserId: user.id,
    action: "conversation.create",
    targetType: "Conversation",
    targetId: conversation.id,
  });

  return NextResponse.json({ item: conversation }, { status: 201 });
}

const toggleSchema = z.object({
  conversationId: z.string().min(1),
  aiEnabled: z.boolean(),
});

export async function PATCH(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST"]);

  const body = toggleSchema.parse(await request.json());

  const conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: user.tenantId,
      id: body.conversationId,
      psychologistUserId: user.id,
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const updated = await prisma.conversation.update({
    where: { id: conversation.id, tenantId: user.tenantId },
    data: { aiEnabled: body.aiEnabled },
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "conversation.ai.toggle",
    targetType: "Conversation",
    targetId: updated.id,
    meta: { aiEnabled: updated.aiEnabled },
  });

  return NextResponse.json({ item: updated });
}
