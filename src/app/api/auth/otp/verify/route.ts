import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeOtpChallenge } from "@/lib/auth/otp";
import { prisma } from "@/lib/prisma";
import { createSession, markStepUp, requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";

const schema = z.object({
  tenantId: z.string().min(1),
  challengeId: z.string().min(1),
  code: z.string().min(4),
  purpose: z.enum(["login", "stepup"]).optional(),
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const purpose = body.purpose ?? "login";

  let userId: string;
  try {
    userId = await consumeOtpChallenge({
      tenantId: body.tenantId,
      challengeId: body.challengeId,
      code: body.code,
      purpose,
    });
  } catch (error) {
    return NextResponse.json({ error: "Invalid OTP" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: { tenantId: body.tenantId, id: userId },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }

  if (purpose === "stepup") {
    const session = await requireSession();
    if (session.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await markStepUp(session.token);
    await logAuditEvent({
      tenantId: body.tenantId,
      actorUserId: user.id,
      action: "otp.stepup",
      targetType: "Session",
      targetId: session.id,
    });
    return NextResponse.json({ ok: true, stepUp: true });
  }

  await createSession({
    userId: user.id,
    tenantId: body.tenantId,
    stepUp: true,
  });

  await logAuditEvent({
    tenantId: body.tenantId,
    actorUserId: user.id,
    action: "otp.login",
    targetType: "User",
    targetId: user.id,
  });

  return NextResponse.json({ ok: true });
}
