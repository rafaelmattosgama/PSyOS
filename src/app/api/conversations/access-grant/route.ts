import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole, requireStepUp } from "@/lib/auth/guards";
import { logAuditEvent } from "@/lib/audit";

const schema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  userId: z.string().min(1),
  expiresAt: z.string().optional(),
});

export async function POST(request: Request) {
  const { user, session } = await requireAuth();
  requireRole(user.role, ["ADMIN"]);
  requireStepUp(session.stepUpUntil);

  const body = schema.parse(await request.json());
  if (body.tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  const grant = await prisma.conversationAccessGrant.create({
    data: {
      tenantId: body.tenantId,
      conversationId: body.conversationId,
      userId: body.userId,
      grantedByUserId: user.id,
      expiresAt,
    },
  });

  await logAuditEvent({
    tenantId: body.tenantId,
    actorUserId: user.id,
    action: "conversation.access_grant",
    targetType: "Conversation",
    targetId: body.conversationId,
    meta: { grantId: grant.id },
  });

  return NextResponse.json({ ok: true, grantId: grant.id });
}
