import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";

const updateSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" || session.user.isSystemAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = updateSchema.parse(await request.json());

  if (body.email) {
    const existing = await prisma.user.findFirst({
      where: { email: body.email, NOT: { id } },
      __allowMissingTenant: true,
    } as Prisma.UserFindFirstArgs & { __allowMissingTenant?: boolean });
    if (existing) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 400 },
      );
    }
  }

  await prisma.user.updateMany({
    where: { id, tenantId: session.user.tenantId, role: "PSYCHOLOGIST" },
    data: {
      email: body.email,
      isActive: body.isActive,
    },
  });

  if (body.displayName) {
    await prisma.psychologistProfile.updateMany({
      where: { userId: id },
      data: { displayName: body.displayName },
    });
  }

  const updated = await prisma.user.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: { psychologistProfile: true },
  });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await logAuditEvent({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    action: "psychologist.update",
    targetType: "User",
    targetId: updated.id,
  });

  return NextResponse.json({
    psychologist: {
      id: updated.id,
      email: updated.email,
      isActive: updated.isActive,
      displayName: updated.psychologistProfile?.displayName ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}
