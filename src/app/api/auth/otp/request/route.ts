import { NextResponse } from "next/server";
import { z } from "zod";
import { findUserByIdentifier } from "@/lib/auth/user";
import { createOtpChallenge } from "@/lib/auth/otp";
import { sendEmail } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";

const schema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  purpose: z.enum(["login", "stepup"]).optional(),
});

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const identifier = body.email ?? body.phone ?? "";
  if (!identifier) {
    return NextResponse.json({ error: "Identifier required" }, { status: 400 });
  }

  if (body.purpose === "stepup") {
    const session = await requireSession();
    if (session.user.tenantId !== body.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const user = await findUserByIdentifier({
    tenantId: body.tenantId,
    email: body.email,
    phone: body.phone,
  });

  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const { challengeId, code, expiresAt } = await createOtpChallenge({
    tenantId: body.tenantId,
    userId: user.id,
    purpose: body.purpose,
    identifier,
  });

  if (body.email) {
    await sendEmail({
      to: body.email,
      subject: "Seu codigo de acesso",
      text: `Seu codigo de acesso e ${code}. Ele expira em ${expiresAt.toISOString()}.`,
    });
  } else {
    return NextResponse.json({ error: "SMS not configured" }, { status: 400 });
  }

  await logAuditEvent({
    tenantId: body.tenantId,
    actorUserId: user.id,
    action: "otp.request",
    targetType: "User",
    targetId: user.id,
    meta: { purpose: body.purpose ?? "login" },
  });

  return NextResponse.json({ ok: true, challengeId });
}
