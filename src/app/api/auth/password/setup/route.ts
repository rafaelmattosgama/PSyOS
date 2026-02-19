import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, isPasswordStrong } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";
import { resolveHomeForUser } from "@/lib/auth/portal";

const schema = z.object({
  email: z.string().email(),
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

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.isActive) {
    return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  }

  if (user.passwordHash) {
    return NextResponse.json(
      { error: "Password already set" },
      { status: 400 },
    );
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

  await createSession({
    userId: user.id,
    tenantId: user.tenantId,
    stepUp: true,
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "password.setup",
    targetType: "User",
    targetId: user.id,
  });

  return NextResponse.json({ ok: true, redirectTo: resolveHomeForUser(user) });
}
