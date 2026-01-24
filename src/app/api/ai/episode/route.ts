import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess } from "@/lib/auth/guards";

const querySchema = z.object({
  conversationId: z.string().min(1),
});

export async function GET(request: Request) {
  const { user } = await requireAuth();
  const url = new URL(request.url);
  const query = querySchema.parse({
    conversationId: url.searchParams.get("conversationId"),
  });

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
    userId: user.id,
    role: user.role,
  });

  const episode = await prisma.aiEpisode.findFirst({
    where: {
      tenantId: user.tenantId,
      conversationId: conversation.id,
      isOpen: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    item: episode ? { aiTurnsUsed: episode.aiTurnsUsed, isOpen: episode.isOpen } : null,
  });
}
