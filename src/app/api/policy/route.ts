import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { logAuditEvent } from "@/lib/audit";

const getSchema = z.object({
  scope: z.enum(["tenant", "user", "conversation"]),
  ownerUserId: z.string().optional(),
  conversationId: z.string().optional(),
});

const updateSchema = z.object({
  tenantId: z.string().min(1),
  scope: z.enum(["tenant", "user", "conversation"]),
  ownerUserId: z.string().optional(),
  conversationId: z.string().optional(),
  policyText: z.string().min(1),
  flagsJson: z.record(z.unknown()).optional(),
});

export async function GET(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["ADMIN", "PSYCHOLOGIST"]);
  const url = new URL(request.url);
  const query = getSchema.parse({
    scope: url.searchParams.get("scope"),
    ownerUserId: url.searchParams.get("ownerUserId") ?? undefined,
    conversationId: url.searchParams.get("conversationId") ?? undefined,
  });

  if (query.scope === "tenant") {
    return NextResponse.json(
      { error: "Tenant policy disabled. Use psychologist policy." },
      { status: 400 },
    );
  }

  if (query.scope === "user" && query.ownerUserId && query.ownerUserId !== user.id) {
    requireRole(user.role, ["ADMIN"]);
  }

  if (query.scope === "conversation" && query.conversationId) {
    await requireConversationAccess({
      tenantId: user.tenantId,
      conversationId: query.conversationId,
      userId: user.id,
      role: user.role,
    });
  }

  const policy = await prisma.aiPolicy.findFirst({
    where: {
      tenantId: user.tenantId,
      ownerUserId:
        query.scope === "user" ? query.ownerUserId ?? user.id : undefined,
      conversationId:
        query.scope === "conversation" ? query.conversationId ?? undefined : undefined,
    },
  });

  return NextResponse.json({ item: policy });
}

export async function POST(request: Request) {
  const { user, session } = await requireAuth();
  const body = updateSchema.parse(await request.json());
  if (body.tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.scope === "tenant") {
    return NextResponse.json(
      { error: "Tenant policy disabled. Use psychologist policy." },
      { status: 400 },
    );
  }

  if (body.scope === "user") {
    requireRole(user.role, ["PSYCHOLOGIST"]);
    if (body.ownerUserId && body.ownerUserId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (body.scope === "conversation") {
    requireRole(user.role, ["PSYCHOLOGIST"]);
    if (!body.conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }
    await requireConversationAccess({
      tenantId: user.tenantId,
      conversationId: body.conversationId,
      userId: user.id,
      role: user.role,
    });
  }

  const existing = await prisma.aiPolicy.findFirst({
    where: {
      tenantId: user.tenantId,
      ownerUserId: body.scope === "user" ? body.ownerUserId ?? user.id : undefined,
      conversationId:
        body.scope === "conversation" ? body.conversationId ?? undefined : undefined,
    },
  });

  let policyId = existing?.id ?? null;
  if (existing) {
    await prisma.aiPolicy.updateMany({
      where: { id: existing.id, tenantId: user.tenantId },
      data: { policyText: body.policyText, flagsJson: body.flagsJson ?? null },
    });
  } else {
    const created = await prisma.aiPolicy.create({
      data: {
        tenantId: user.tenantId,
        ownerUserId: body.scope === "user" ? body.ownerUserId ?? user.id : null,
        conversationId: body.scope === "conversation" ? body.conversationId ?? null : null,
        policyText: body.policyText,
        flagsJson: body.flagsJson ?? null,
      },
    });
    policyId = created.id;
  }

  const policy = policyId
    ? await prisma.aiPolicy.findFirst({
        where: { tenantId: user.tenantId, id: policyId },
      })
    : null;

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "policy.update",
    targetType: "AiPolicy",
    targetId: policyId,
  });

  return NextResponse.json({ ok: true, policy });
}
