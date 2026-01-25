import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import { getRedis } from "@/lib/redis";

const CHALLENGE_TTL_SECONDS = 5 * 60;

export function webauthnConfig() {
  return {
    rpName: process.env.WEBAUTHN_RP_NAME ?? "PsyOS",
    rpId: process.env.WEBAUTHN_RP_ID ?? "localhost",
    origin: process.env.WEBAUTHN_ORIGIN ?? "http://localhost:3000",
  };
}

function toBase64Url(input: Uint8Array) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url");
}

function toUserIdBytes(userId: string) {
  return Buffer.from(userId, "utf8");
}

export async function storeChallenge(key: string, challenge: string) {
  const redis = getRedis();
  await redis.setex(`webauthn:${key}`, CHALLENGE_TTL_SECONDS, challenge);
}

export async function consumeChallenge(key: string) {
  const redis = getRedis();
  const fullKey = `webauthn:${key}`;
  const challenge = await redis.get(fullKey);
  if (challenge) {
    await redis.del(fullKey);
  }
  return challenge;
}

export async function startRegistration(params: {
  userId: string;
  username: string;
  credentialIds: string[];
}) {
  const { rpName, rpId } = webauthnConfig();
  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userID: toUserIdBytes(params.userId),
    userName: params.username,
    attestationType: "none",
    excludeCredentials: params.credentialIds.map((id) => ({
      id: fromBase64Url(id),
      type: "public-key",
    })),
  });
  await storeChallenge(`register:${params.userId}`, options.challenge);
  return options;
}

export async function finishRegistration(params: {
  userId: string;
  response: unknown;
}) {
  const { rpId, origin } = webauthnConfig();
  const expectedChallenge = await consumeChallenge(`register:${params.userId}`);
  if (!expectedChallenge) {
    throw new Error("WebAuthn challenge expired");
  }
  const verification: VerifiedRegistrationResponse =
    await verifyRegistrationResponse({
      response: params.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
    });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("WebAuthn registration failed");
  }
  const { credentialID, credentialPublicKey, counter } =
    verification.registrationInfo;
  return {
    credentialId: toBase64Url(credentialID),
    publicKey: Buffer.from(credentialPublicKey).toString("base64"),
    counter,
  };
}

export async function startAuthentication(params: {
  userId: string;
  credentialIds: string[];
}) {
  const options = await generateAuthenticationOptions({
    userVerification: "preferred",
    allowCredentials: params.credentialIds.map((id) => ({
      id: fromBase64Url(id),
      type: "public-key",
    })),
  });
  await storeChallenge(`login:${params.userId}`, options.challenge);
  return options;
}

export async function finishAuthentication(params: {
  userId: string;
  response: unknown;
  credential: {
    id: string;
    publicKey: string;
    counter: number;
  };
}) {
  const { rpId, origin } = webauthnConfig();
  const expectedChallenge = await consumeChallenge(`login:${params.userId}`);
  if (!expectedChallenge) {
    throw new Error("WebAuthn challenge expired");
  }
  const verification: VerifiedAuthenticationResponse =
    await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      authenticator: {
        credentialID: fromBase64Url(params.credential.id),
        credentialPublicKey: Buffer.from(params.credential.publicKey, "base64"),
        counter: params.credential.counter,
      },
    });
  if (!verification.verified) {
    throw new Error("WebAuthn authentication failed");
  }
  return {
    newCounter: verification.authenticationInfo.newCounter,
  };
}
