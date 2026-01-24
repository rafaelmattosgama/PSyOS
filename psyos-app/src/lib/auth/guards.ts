import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isStepUpValid, requireSession } from "@/lib/auth/session";

export async function requireAuth() {
  const session = await requireSession();
  return {
    session,
    user: session.user,
  };
}

export function requireRole(userRole: Role, allowed: Role[]) {
  if (!allowed.includes(userRole)) {
    throw new Error("Forbidden");
  }
}

export function requireStepUp(stepUpUntil: Date | null) {
  if (!isStepUpValid(stepUpUntil)) {
    throw new Error("Step-up authentication required");
  }
}

export async function getConversationForAccess(params: {
  tenantId: string;
  conversationId: string;
}) {
  return prisma.conversation.findFirst({
    where: {
      tenantId: params.tenantId,
      id: params.conversationId,
    },
  });
}

export async function requireConversationAccess(params: {
  tenantId: string;
  conversationId: string;
  userId: string;
  role: Role;
}) {
  const conversation = await getConversationForAccess({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
  });
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (params.role === "PSYCHOLOGIST") {
    if (conversation.psychologistUserId !== params.userId) {
      throw new Error("Forbidden");
    }
  }

  if (params.role === "PATIENT") {
    if (conversation.patientUserId !== params.userId) {
      throw new Error("Forbidden");
    }
  }

  if (params.role === "ADMIN") {
    const accessGrant = await prisma.conversationAccessGrant.findFirst({
      where: {
        tenantId: params.tenantId,
        conversationId: conversation.id,
        userId: params.userId,
      },
    });
    const canAccess =
      accessGrant && (!accessGrant.expiresAt || accessGrant.expiresAt > new Date());
    if (!canAccess) {
      throw new Error("Admin access requires explicit grant");
    }
  }

  return conversation;
}
