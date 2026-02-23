import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { decryptDek, encryptBytes, encryptMessage, getMasterKek } from "@/lib/crypto";
import { logAuditEvent } from "@/lib/audit";
import { transcribeAudio } from "@/lib/ai/openai";
import { getAiQueue } from "@/lib/queues";

const schema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
});

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

function resolveAudioExtension(mime: string) {
  switch (mime) {
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    default:
      return "bin";
  }
}

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
  const baseMime = normalizedMime.split(";")[0] ?? "";
  if (!baseMime || !ALLOWED_AUDIO_MIME_TYPES.has(baseMime)) {
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
  const transcriptionFile = new File(
    [buffer],
    `audio.${resolveAudioExtension(baseMime)}`,
    { type: baseMime },
  );

  let transcriptionText = "";
  try {
    transcriptionText = await transcribeAudio({
      file: transcriptionFile,
    });
  } catch (error) {
    console.error("[audio] transcription failed:", (error as Error).message);
  }

  const encryptedText = encryptMessage(transcriptionText, dek);

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
      attachmentMime: baseMime,
      attachmentSize: file.size,
    },
  });

  if (user.role === "PATIENT" && conversation.aiEnabled) {
    await getAiQueue().add("ai_reply_generate", {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      triggerMessageId: message.id,
    });
  }

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "message.audio",
    targetType: "Message",
    targetId: message.id,
    meta: { transcribed: Boolean(transcriptionText) },
  });

  return NextResponse.json({ ok: true, messageId: message.id });
}
