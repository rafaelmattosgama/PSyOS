import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";

const createSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" || session.user.isSystemAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const psychologists = await prisma.user.findMany({
    where: { tenantId: session.user.tenantId, role: "PSYCHOLOGIST" },
    include: { psychologistProfile: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    items: psychologists.map((user) => ({
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      displayName: user.psychologistProfile?.displayName ?? null,
      createdAt: user.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" || session.user.isSystemAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = createSchema.parse(await request.json());
  const existing = await prisma.user.findFirst({
    where: { email: body.email },
    __allowMissingTenant: true,
  } as Prisma.UserFindFirstArgs & { __allowMissingTenant?: boolean });
  if (existing) {
    return NextResponse.json(
      { error: "Email already in use" },
      { status: 400 },
    );
  }

  const psychologist = await prisma.user.create({
    data: {
      tenantId: session.user.tenantId,
      role: "PSYCHOLOGIST",
      email: body.email,
      isActive: true,
      psychologistProfile: {
        create: {
          displayName: body.displayName,
        },
      },
    },
    include: { psychologistProfile: true },
  });

  await logAuditEvent({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    action: "psychologist.create",
    targetType: "User",
    targetId: psychologist.id,
  });

  return NextResponse.json({
    psychologist: {
      id: psychologist.id,
      email: psychologist.email,
      isActive: psychologist.isActive,
      displayName: psychologist.psychologistProfile?.displayName ?? null,
      createdAt: psychologist.createdAt.toISOString(),
    },
  });
}
