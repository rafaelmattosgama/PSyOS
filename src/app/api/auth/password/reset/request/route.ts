import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { enforceRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import crypto from "crypto";

const schema = z.object({
  email: z.string().email(),
});

function getBaseUrl(request: Request) {
  const env = process.env.APP_URL;
  if (env) {
    return env.replace(/\/+$/, "");
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: Request) {
  const body = schema.parse(await request.json());
  const email = body.email.trim().toLowerCase();
  const clientIp = getClientIp(request);

  try {
    await enforceRateLimit({
      key: `password-reset:email:${email}`,
      limit: 3,
      windowSeconds: 60 * 15,
    });
    await enforceRateLimit({
      key: `password-reset:ip:${clientIp}`,
      limit: 20,
      windowSeconds: 60 * 15,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: "Too many requests. Try again in a few minutes." },
        { status: 429 },
      );
    }
    throw error;
  }

  const user = await prisma.user.findFirst({
    where: { email },
    __allowMissingTenant: true,
  } as Prisma.UserFindFirstArgs & { __allowMissingTenant?: boolean });

  if (!user || !user.isActive) {
    return NextResponse.json({ ok: true });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.mfaChallenge.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      codeHash: tokenHash,
      purpose: "password_reset",
      expiresAt,
    },
  });

  const baseUrl = getBaseUrl(request);
  const link = `${baseUrl}/login?reset=${encodeURIComponent(
    token,
  )}&email=${encodeURIComponent(email)}`;

  await sendEmail({
    to: email,
    subject: "PsyOS - Redefinir senha",
    text: `Use o link para redefinir sua senha: ${link}`,
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "password.reset.request",
    targetType: "User",
    targetId: user.id,
  });

  return NextResponse.json({ ok: true });
}
