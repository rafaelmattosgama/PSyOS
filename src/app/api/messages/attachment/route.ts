import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireStepUp } from "@/lib/auth/guards";
import { decryptDek, decryptBytes, getMasterKek } from "@/lib/crypto";

const querySchema = z.object({
  messageId: z.string().min(1),
});

export async function GET(request: Request) {
  const { user, session } = await requireAuth();
  const url = new URL(request.url);
  const query = querySchema.parse({
    messageId: url.searchParams.get("messageId"),
  });

  if (user.role === "ADMIN") {
    requireStepUp(session.stepUpUntil);
  }

  const message = (await prisma.message.findFirst({
    where: { id: query.messageId, tenantId: user.tenantId },
  })) as unknown as {
    id: string;
    conversationId: string;
    attachmentCiphertext?: string | null;
    attachmentIv?: string | null;
    attachmentAuthTag?: string | null;
    attachmentMime?: string | null;
  };

  if (!message || !message.attachmentCiphertext || !message.attachmentIv || !message.attachmentAuthTag) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: message.conversationId,
    userId: user.id,
    role: user.role,
  });

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const bytes = decryptBytes(
    message.attachmentCiphertext,
    message.attachmentIv,
    message.attachmentAuthTag,
    dek,
  );

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": message.attachmentMime ?? "application/octet-stream",
      "Content-Length": bytes.byteLength.toString(),
      "Cache-Control": "private, max-age=300",
    },
  });
}
