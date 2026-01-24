import { prisma } from "@/lib/prisma";

type AuditMeta = Record<string, unknown>;

export async function logAuditEvent(params: {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  meta?: AuditMeta;
}) {
  const { tenantId, actorUserId, action, targetType, targetId, meta } = params;
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: actorUserId ?? null,
      action,
      targetType,
      targetId: targetId ?? null,
      metaJson: meta ?? null,
    },
  });
}
