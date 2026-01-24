import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { getPromptSnapshot } from "@/lib/ai/debug";

const querySchema = z.object({
  conversationId: z.string().min(1),
});

export async function GET(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["ADMIN", "PSYCHOLOGIST"]);

  const url = new URL(request.url);
  const query = querySchema.parse({
    conversationId: url.searchParams.get("conversationId"),
  });

  await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
    userId: user.id,
    role: user.role,
  });

  const snapshot = await getPromptSnapshot({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
  });

  return NextResponse.json({ item: snapshot });
}
