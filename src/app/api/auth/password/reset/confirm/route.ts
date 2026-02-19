import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, isPasswordStrong } from "@/lib/auth/password";
import { logAuditEvent } from "@/lib/audit";
import crypto from "crypto";

const schema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
  password: z.string().min(1),
  confirmPassword: z.string().min(1),
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const email = body.email.trim().toLowerCase();

  if (body.password !== body.confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }

  if (!isPasswordStrong(body.password)) {
    return NextResponse.json(
      {
        error:
          "Senha fraca. Use no minimo 12 caracteres, maiuscula, minuscula, numero e simbolo.",
      },
      { status: 400 },
    );
  }

  const user = await prisma.user.findFirst({
    where: { email },
    __allowMissingTenant: true,
  } as Prisma.UserFindFirstArgs & { __allowMissingTenant?: boolean });

  if (!user || !user.isActive) {
    return NextResponse.json({ error: "Invalid reset token" }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
  const challenge = await prisma.mfaChallenge.findFirst({
    where: {
      tenantId: user.tenantId,
      userId: user.id,
      purpose: "password_reset",
      codeHash: tokenHash,
      expiresAt: { gt: new Date() },
    },
  });

  if (!challenge) {
    return NextResponse.json({ error: "Invalid reset token" }, { status: 400 });
  }

  const passwordHash = await hashPassword(body.password);
  await prisma.user.updateMany({
    where: { id: user.id, tenantId: user.tenantId },
    data: {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  await prisma.mfaChallenge.deleteMany({
    where: { userId: user.id, tenantId: user.tenantId, purpose: "password_reset" },
  });

  await prisma.session.deleteMany({
    where: { userId: user.id, tenantId: user.tenantId },
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "password.reset.confirm",
    targetType: "User",
    targetId: user.id,
  });

  return NextResponse.json({ ok: true });
}
