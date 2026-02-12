import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";

const updateSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  phoneE164: z.string().min(6).optional(),
  isActive: z.boolean().optional(),
  preferredLanguage: z.enum(["PT", "ES", "EN"]).optional(),
  psychologistUserId: z.string().optional().nullable(),
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
    where: { id, tenantId: session.user.tenantId, role: "PATIENT" },
    data: {
      email: body.email,
      isActive: body.isActive,
    },
  });

  if (
    body.displayName !== undefined ||
    body.phoneE164 !== undefined ||
    body.preferredLanguage !== undefined
  ) {
    const profileData: Prisma.PatientProfileUpdateManyMutationInput = {};
    if (body.displayName !== undefined) {
      profileData.displayName = body.displayName;
    }
    if (body.phoneE164 !== undefined) {
      profileData.phoneE164 = body.phoneE164;
    }
    if (body.preferredLanguage !== undefined) {
      profileData.preferredLanguage = body.preferredLanguage;
    }
    await prisma.patientProfile.updateMany({
      where: { userId: id },
      data: profileData,
    });
  }

  if (body.psychologistUserId !== undefined) {
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
    const existingConversations = await prisma.conversation.findMany({
      where: { tenantId: session.user.tenantId, patientUserId: id },
    });
    if (body.psychologistUserId) {
      if (existingConversations.length) {
        await prisma.conversation.updateMany({
          where: { tenantId: session.user.tenantId, patientUserId: id },
          data: { psychologistUserId: body.psychologistUserId },
        });
      } else {
        const { generateDek, encryptDek, getMasterKek } = await import(
          "@/lib/crypto"
        );
        const dek = generateDek();
        const encryptedDek = encryptDek(dek, getMasterKek());
        await prisma.conversation.create({
          data: {
            tenantId: session.user.tenantId,
            psychologistUserId: body.psychologistUserId,
            patientUserId: id,
            aiEnabled: true,
            language: "ES",
            encryptedDek,
          },
        });
      }
    }
  }

  const updated = (await prisma.user.findFirst({
    where: { id, tenantId: session.user.tenantId },
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

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await logAuditEvent({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    action: "patient.update",
    targetType: "User",
    targetId: updated.id,
  });

  return NextResponse.json({
    patient: {
      id: updated.id,
      email: updated.email,
      isActive: updated.isActive,
      displayName: updated.patientProfile?.displayName ?? null,
      phoneE164: updated.patientProfile?.phoneE164 ?? null,
      preferredLanguage:
        (updated.patientProfile as { preferredLanguage?: "PT" | "ES" | "EN" })
          ?.preferredLanguage ?? "ES",
      psychologistUserId: body.psychologistUserId ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}
