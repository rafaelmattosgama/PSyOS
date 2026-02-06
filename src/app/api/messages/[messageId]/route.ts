import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { logAuditEvent } from "@/lib/audit";

const paramsSchema = z.object({
  messageId: z.string().min(1),
});

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ messageId?: string }> },
) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST", "PATIENT"]);
  const params = paramsSchema.parse(await context.params);

  const message = await prisma.message.findFirst({
    where: { tenantId: user.tenantId, id: params.messageId },
    include: { conversation: true },
  });

  if (!message) {
    return NextResponse.json({ ok: true });
  }

  await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: message.conversationId,
    userId: user.id,
    role: user.role,
  });

  if (message.authorType === "AI" || message.authorType === "SYSTEM") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (
    user.role === "PATIENT" &&
    (message.authorType !== "PATIENT" ||
      message.conversation.patientUserId !== user.id)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (
    user.role === "PSYCHOLOGIST" &&
    message.conversation.psychologistUserId !== user.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!message.deletedAt) {
    await prisma.message.updateMany({
      where: { id: message.id, tenantId: user.tenantId },
      data: { deletedAt: new Date(), deletedByUserId: user.id },
    });
  }

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "message.delete",
    targetType: "Message",
    targetId: message.id,
  });

  return NextResponse.json({ ok: true });
}
