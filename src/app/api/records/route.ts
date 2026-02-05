import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { logAuditEvent } from "@/lib/audit";

const schema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  event: z.string().min(1),
  thought: z.string().optional(),
  emotion: z.string().optional(),
  body: z.string().optional(),
  action: z.string().optional(),
  result: z.string().optional(),
});

const querySchema = z.object({
  conversationId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST"]);

  const url = new URL(request.url);
  const query = querySchema.parse({
    conversationId: url.searchParams.get("conversationId"),
    limit: url.searchParams.get("limit"),
  });

  await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
    userId: user.id,
    role: user.role,
  });

  const records = await prisma.record.findMany({
    where: { tenantId: user.tenantId, conversationId: query.conversationId },
    orderBy: { createdAt: "desc" },
    take: query.limit ?? 200,
  });

  return NextResponse.json({
    items: records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt.toISOString(),
      dataJson: record.dataJson,
    })),
  });
}

export async function POST(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST"]);

  const body = schema.parse(await request.json());
  if (body.tenantId !== user.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: body.conversationId,
    userId: user.id,
    role: user.role,
  });

  const record = await prisma.record.create({
    data: {
      tenantId: user.tenantId,
      conversationId: body.conversationId,
      createdByUserId: user.id,
      dataJson: {
        event: body.event,
        thought: body.thought,
        emotion: body.emotion,
        body: body.body,
        action: body.action,
        result: body.result,
      },
    },
  });

  await logAuditEvent({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action: "record.create",
    targetType: "Record",
    targetId: record.id,
  });

  return NextResponse.json({ ok: true, recordId: record.id }, { status: 201 });
}
