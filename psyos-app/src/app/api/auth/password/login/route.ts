import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { resolveHomeForUser } from "@/lib/auth/portal";
import { logAuditEvent } from "@/lib/audit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function POST(request: Request) {
  const body = schema.parse(await request.json());

  await enforceRateLimit({
    key: `password:${body.email}`,
    limit: 10,
    windowSeconds: 60 * 5,
  });

  const user = await prisma.user.findFirst({
    where: { email: body.email },
    __allowMissingTenant: true,
  } as Prisma.UserFindFirstArgs & { __allowMissingTenant?: boolean });

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (!user.isActive) {
    return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  }
  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "Password not set" },
      { status: 400 },
    );
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json({ error: "Account locked" }, { status: 403 });
  }

  const valid = await verifyPassword(user.passwordHash, body.password);
  if (!valid) {
    const nextAttempts = user.failedLoginAttempts + 1;
    const lockedUntil =
      nextAttempts >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;
    await prisma.user.updateMany({
      where: { id: user.id, tenantId: user.tenantId },
      data: {
        failedLoginAttempts: nextAttempts,
        lockedUntil,
      },
    });

    await logAuditEvent({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: "password.login_failed",
      targetType: "User",
      targetId: user.id,
    });

    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await prisma.user.updateMany({
    where: { id: user.id, tenantId: user.tenantId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  await createSession({
    userId: user.id,
    tenantId: user.tenantId,
    stepUp: true,
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "password.login",
    targetType: "User",
    targetId: user.id,
  });

  const redirectTo = resolveHomeForUser(user);

  return NextResponse.json({ ok: true, redirectTo });
}
