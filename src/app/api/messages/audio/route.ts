import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { decryptDek, encryptBytes, encryptMessage, getMasterKek } from "@/lib/crypto";
import { logAuditEvent } from "@/lib/audit";

const schema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
});

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

export async function POST(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST", "PATIENT"]);

  const formData = await request.formData();
  const tenantId = String(formData.get("tenantId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const file = formData.get("file");

  const parsed = schema.safeParse({ tenantId, conversationId });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "File missing" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Audio too large" }, { status: 400 });
  }
  const normalizedMime = file.type.trim().toLowerCase();
  if (!normalizedMime || !ALLOWED_AUDIO_MIME_TYPES.has(normalizedMime)) {
    return NextResponse.json({ error: "Unsupported audio format" }, { status: 400 });
  }

  if (tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId,
    userId: user.id,
    role: user.role,
  });

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const buffer = Buffer.from(await file.arrayBuffer());
  const encryptedAudio = encryptBytes(buffer, dek);
  const encryptedText = encryptMessage("", dek);

  const message = await prisma.message.create({
    data: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      direction: user.role === "PATIENT" ? "IN" : "OUT",
      authorType: user.role === "PATIENT" ? "PATIENT" : "PSYCHOLOGIST",
      ciphertext: encryptedText.ciphertext,
      iv: encryptedText.iv,
      authTag: encryptedText.authTag,
      attachmentCiphertext: encryptedAudio.ciphertext,
      attachmentIv: encryptedAudio.iv,
      attachmentAuthTag: encryptedAudio.authTag,
      attachmentMime: normalizedMime,
      attachmentSize: file.size,
    },
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "message.audio",
    targetType: "Message",
    targetId: message.id,
  });

  return NextResponse.json({ ok: true, messageId: message.id });
}
