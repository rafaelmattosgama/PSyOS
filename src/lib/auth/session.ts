import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "psyos_session";
const SESSION_TTL_HOURS = 12;
const STEP_UP_MINUTES = 15;

function createToken() {
  return randomBytes(32).toString("base64url");
}

function now() {
  return new Date();
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export async function createSession(params: {
  userId: string;
  tenantId: string;
  stepUp?: boolean;
}) {
  const token = createToken();
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
  const stepUpUntil = params.stepUp
    ? new Date(issuedAt.getTime() + STEP_UP_MINUTES * 60 * 1000)
    : null;
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for") ?? headerStore.get("x-real-ip");
  const userAgent = headerStore.get("user-agent");

  await prisma.session.create({
    data: {
      token,
      userId: params.userId,
      tenantId: params.tenantId,
      expiresAt,
      lastSeenAt: issuedAt,
      stepUpUntil,
      ip,
      userAgent,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.delete({ where: { token } }).catch(() => undefined);
  }
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  if (!session.user.isActive) {
    await prisma.session.delete({ where: { token } }).catch(() => undefined);
    return null;
  }

  if (session.expiresAt < now()) {
    await prisma.session.delete({ where: { token } }).catch(() => undefined);
    return null;
  }

  await prisma.session.update({
    where: { token },
    data: { lastSeenAt: now() },
  });

  return session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export function isStepUpValid(stepUpUntil: Date | null) {
  if (!stepUpUntil) {
    return false;
  }
  return stepUpUntil > now();
}

export async function markStepUp(token: string) {
  const until = new Date(now().getTime() + STEP_UP_MINUTES * 60 * 1000);
  await prisma.session.update({
    where: { token },
    data: { stepUpUntil: until },
  });
}
