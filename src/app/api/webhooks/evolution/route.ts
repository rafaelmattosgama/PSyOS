import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { getInboundQueue } from "@/lib/queues";
import { prisma } from "@/lib/prisma";

const payloadSchema = z.record(z.string(), z.unknown());

function extractText(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const message = (data?.message as Record<string, unknown> | undefined) ?? {};
  return (
    (message?.conversation as string | undefined) ||
    (message?.text as string | undefined) ||
    (data?.body as string | undefined) ||
    ""
  );
}

function extractMessageId(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const key = (data?.key as Record<string, unknown> | undefined) ?? {};
  return (
    (data?.id as string | undefined) ||
    (key?.id as string | undefined) ||
    (payload.messageId as string | undefined) ||
    ""
  );
}

function extractFrom(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const key = (data?.key as Record<string, unknown> | undefined) ?? {};
  const raw =
    (data?.from as string | undefined) ||
    (key?.remoteJid as string | undefined) ||
    "";
  return raw.replace(/[^\d]/g, "");
}

function getProvidedSecret(request: Request) {
  const direct =
    request.headers.get("x-webhook-secret") ??
    request.headers.get("x-evolution-secret");
  if (direct) {
    return direct;
  }
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return "";
}

function isWebhookAuthorized(request: Request) {
  const configuredSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return process.env.NODE_ENV !== "production";
  }
  const providedSecret = getProvidedSecret(request);
  if (!providedSecret) {
    return false;
  }

  const expected = Buffer.from(configuredSecret, "utf8");
  const provided = Buffer.from(providedSecret, "utf8");
  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}

export async function POST(request: Request) {
  if (!isWebhookAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = request.headers.get("x-tenant-id") ?? "";
  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenant" }, { status: 400 });
  }

  const raw = payloadSchema.parse(await request.json());
  const messageId = extractMessageId(raw);
  const text = extractText(raw).trim().slice(0, 4000);
  const from = extractFrom(raw);

  if (!messageId || !text || !from) {
    return NextResponse.json({ ok: true });
  }

  const existing = await prisma.message.findFirst({
    where: {
      tenantId,
      externalMessageId: messageId,
    },
  });

  if (existing) {
    return NextResponse.json({ ok: true });
  }

  await getInboundQueue().add("inbound_message_process", {
    tenantId,
    externalMessageId: messageId,
    fromPhone: from,
    text,
    source: "whatsapp",
  });

  return NextResponse.json({ ok: true });
}
