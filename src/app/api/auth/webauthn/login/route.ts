import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  finishAuthentication,
  startAuthentication,
} from "@/lib/auth/webauthn";
import { createSession, getSession, markStepUp } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";

const startSchema = z.object({
  tenantId: z.string().min(1),
  action: z.literal("start"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const finishSchema = z.object({
  tenantId: z.string().min(1),
  action: z.literal("finish"),
  userId: z.string().min(1),
  response: z.unknown(),
  stepUp: z.boolean().optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  if (body?.action === "start") {
    const parsed = startSchema.parse(body);
    if (!parsed.email && !parsed.phone) {
      return NextResponse.json({ error: "Identifier required" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: {
        tenantId: parsed.tenantId,
        ...(parsed.email ? { email: parsed.email } : { phone: parsed.phone }),
      },
    });

    if (!user) {
      return NextResponse.json({ ok: true });
    }

    const credentials = await prisma.webAuthnCredential.findMany({
      where: { tenantId: parsed.tenantId, userId: user.id },
    });

    const options = await startAuthentication({
      userId: user.id,
      credentialIds: credentials.map((cred) => cred.credentialId),
    });

    return NextResponse.json({ options, userId: user.id });
  }

  const parsed = finishSchema.parse(body);
  const credentialId = (parsed.response as { id?: string })?.id;
  if (!credentialId) {
    return NextResponse.json({ error: "Missing credential id" }, { status: 400 });
  }

  const credential = await prisma.webAuthnCredential.findFirst({
    where: {
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      credentialId,
    },
  });

  if (!credential) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  const result = await finishAuthentication({
    userId: parsed.userId,
    response: parsed.response,
    credential: {
      id: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
    },
  });

  await prisma.webAuthnCredential.updateMany({
    where: { id: credential.id, tenantId: parsed.tenantId },
    data: { counter: result.newCounter },
  });

  if (parsed.stepUp) {
    const session = await getSession();
    if (!session || session.userId !== parsed.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await markStepUp(session.token);
  } else {
    await createSession({
      userId: parsed.userId,
      tenantId: parsed.tenantId,
      stepUp: true,
    });
  }

  await logAuditEvent({
    tenantId: parsed.tenantId,
    actorUserId: parsed.userId,
    action: "webauthn.login",
    targetType: "User",
    targetId: parsed.userId,
  });

  return NextResponse.json({ ok: true });
}
