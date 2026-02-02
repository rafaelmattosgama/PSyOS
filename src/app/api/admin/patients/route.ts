import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";
import { encryptDek, generateDek, getMasterKek } from "@/lib/crypto";

const createSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  phoneE164: z.string().min(6),
  psychologistUserId: z.string().optional(),
  preferredLanguage: z.enum(["PT", "ES", "EN"]).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" || session.user.isSystemAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const patients = await prisma.user.findMany({
    where: { tenantId: session.user.tenantId, role: "PATIENT" },
    include: { patientProfile: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    items: patients.map((user) => ({
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      displayName: user.patientProfile?.displayName ?? null,
      phoneE164: user.patientProfile?.phoneE164 ?? null,
      preferredLanguage:
        (user.patientProfile as { preferredLanguage?: "PT" | "ES" | "EN" })
          ?.preferredLanguage ?? "ES",
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

  if (body.psychologistUserId) {
    const psychologist = await prisma.user.findFirst({
      where: {
        tenantId: session.user.tenantId,
        id: body.psychologistUserId,
        role: "PSYCHOLOGIST",
      },
    });
    if (!psychologist) {
      return NextResponse.json(
        { error: "Psychologist not found" },
        { status: 400 },
      );
    }
  }

  const patient = (await prisma.user.create({
    data: {
      tenantId: session.user.tenantId,
      role: "PATIENT",
      email: body.email,
      isActive: true,
      patientProfile: {
        create: {
          displayName: body.displayName,
          phoneE164: body.phoneE164,
          preferredLanguage: body.preferredLanguage ?? "ES",
        },
      },
    },
    include: { patientProfile: true },
  })) as unknown as {
    id: string;
    email: string | null;
    isActive: boolean;
    createdAt: Date;
    patientProfile?: {
      displayName?: string | null;
      phoneE164?: string | null;
      preferredLanguage?: "PT" | "ES" | "EN";
    } | null;
  };

  if (body.psychologistUserId) {
    const dek = generateDek();
    const encryptedDek = encryptDek(dek, getMasterKek());
    await prisma.conversation.create({
      data: {
        tenantId: session.user.tenantId,
        psychologistUserId: body.psychologistUserId,
        patientUserId: patient.id,
        aiEnabled: true,
        language: (body.preferredLanguage ?? "ES") as "PT" | "ES" | "EN",
        encryptedDek,
      },
    });
  }

  await logAuditEvent({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    action: "patient.create",
    targetType: "User",
    targetId: patient.id,
  });

  return NextResponse.json({
    patient: {
      id: patient.id,
      email: patient.email,
      isActive: patient.isActive,
      displayName: patient.patientProfile?.displayName ?? null,
      phoneE164: patient.patientProfile?.phoneE164 ?? null,
      preferredLanguage: patient.patientProfile?.preferredLanguage ?? "ES",
      psychologistUserId: body.psychologistUserId ?? null,
      createdAt: patient.createdAt.toISOString(),
    },
  });
}
