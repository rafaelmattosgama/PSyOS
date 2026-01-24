import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { finishRegistration, startRegistration } from "@/lib/auth/webauthn";
import { logAuditEvent } from "@/lib/audit";

const startSchema = z.object({
  tenantId: z.string().min(1),
  action: z.literal("start"),
});

const finishSchema = z.object({
  tenantId: z.string().min(1),
  action: z.literal("finish"),
  response: z.unknown(),
});

export async function POST(request: Request) {
  const body = await request.json();
  if (body?.action === "start") {
    const parsed = startSchema.parse(body);
    const session = await requireSession();
    if (session.user.tenantId !== parsed.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const credentials = await prisma.webAuthnCredential.findMany({
      where: { tenantId: parsed.tenantId, userId: session.userId },
    });

    const options = await startRegistration({
      userId: session.userId,
      username: session.user.email ?? session.user.phone ?? session.userId,
      credentialIds: credentials.map((cred) => cred.credentialId),
    });

    return NextResponse.json(options);
  }

  const parsed = finishSchema.parse(body);
  const session = await requireSession();
  if (session.user.tenantId !== parsed.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await finishRegistration({
    userId: session.userId,
    response: parsed.response,
  });

  await prisma.webAuthnCredential.create({
    data: {
      tenantId: parsed.tenantId,
      userId: session.userId,
      credentialId: result.credentialId,
      publicKey: result.publicKey,
      counter: result.counter,
    },
  });

  await prisma.user.updateMany({
    where: { id: session.userId, tenantId: parsed.tenantId },
    data: { webauthnEnabled: true },
  });

  await logAuditEvent({
    tenantId: parsed.tenantId,
    actorUserId: session.userId,
    action: "webauthn.register",
    targetType: "WebAuthnCredential",
    targetId: result.credentialId,
  });

  return NextResponse.json({ ok: true });
}
