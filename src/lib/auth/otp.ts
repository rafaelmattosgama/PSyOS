import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";

const OTP_TTL_MINUTES = 10;

function hashOtp(code: string, salt?: Buffer) {
  const actualSalt = salt ?? randomBytes(16);
  const derived = scryptSync(code, actualSalt, 32);
  return `${actualSalt.toString("base64")}.${derived.toString("base64")}`;
}

function verifyOtp(code: string, storedHash: string) {
  const [saltB64, hashB64] = storedHash.split(".");
  if (!saltB64 || !hashB64) {
    return false;
  }
  const salt = Buffer.from(saltB64, "base64");
  const hashed = scryptSync(code, salt, 32);
  const expected = Buffer.from(hashB64, "base64");
  return timingSafeEqual(hashed, expected);
}

function generateOtpCode() {
  const code = randomInt(100000, 1000000);
  return String(code);
}

export async function createOtpChallenge(params: {
  tenantId: string;
  userId: string;
  purpose?: string;
  identifier: string;
}) {
  await enforceRateLimit({
    key: `otp:${params.identifier}`,
    limit: 5,
    windowSeconds: 60 * 10,
  });

  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const challenge = await prisma.mfaChallenge.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      codeHash,
      purpose: params.purpose ?? "login",
      expiresAt,
    },
  });

  return { challengeId: challenge.id, code, expiresAt };
}

export async function consumeOtpChallenge(params: {
  challengeId: string;
  tenantId: string;
  code: string;
  purpose?: string;
}) {
  const challenge = await prisma.mfaChallenge.findFirst({
    where: {
      id: params.challengeId,
      tenantId: params.tenantId,
      purpose: params.purpose ?? "login",
    },
  });

  if (!challenge) {
    throw new Error("Invalid OTP");
  }

  if (challenge.expiresAt < new Date()) {
    await prisma.mfaChallenge.deleteMany({
      where: { id: challenge.id, tenantId: params.tenantId },
    });
    throw new Error("OTP expired");
  }

  const valid = verifyOtp(params.code, challenge.codeHash);
  if (!valid) {
    throw new Error("Invalid OTP");
  }

  await prisma.mfaChallenge.deleteMany({
    where: { id: challenge.id, tenantId: params.tenantId },
  });

  return challenge.userId;
}
