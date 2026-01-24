import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { logAuditEvent } from "@/lib/audit";

const schema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  event: z.string().min(1),
  thought: z.string().optional(),
  emotion: z.string().optional(),
  body: z.string().optional(),
  action: z.string().optional(),
  result: z.string().optional(),
});

export async function POST(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST"]);

  const body = schema.parse(await request.json());
  if (body.tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: body.conversationId,
    userId: user.id,
    role: user.role,
  });

  const record = await prisma.record.create({
    data: {
      tenantId: user.tenantId,
      conversationId: body.conversationId,
      createdByUserId: user.id,
      dataJson: {
        event: body.event,
        thought: body.thought,
        emotion: body.emotion,
        body: body.body,
        action: body.action,
        result: body.result,
      },
    },
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "record.create",
    targetType: "Record",
    targetId: record.id,
  });

  return NextResponse.json({ ok: true, recordId: record.id }, { status: 201 });
}
