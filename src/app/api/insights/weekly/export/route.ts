import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";

const querySchema = z.object({
  conversationId: z.string().min(1),
  weeks: z.coerce.number().int().min(1).max(26).optional(),
  format: z.enum(["csv", "json"]).optional(),
});

const MAX_WEEKS = 8;

export async function GET(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST"]);

  const url = new URL(request.url);
  const query = querySchema.parse({
    conversationId: url.searchParams.get("conversationId"),
    weeks: url.searchParams.get("weeks") ?? undefined,
    format: (url.searchParams.get("format") ?? undefined) as "csv" | "json" | undefined,
  });

  await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
    userId: user.id,
    role: user.role,
  });

  const count = query.weeks ?? MAX_WEEKS;
  const prismaAny = prisma as typeof prisma & {
    weeklySummary: {
      findMany: (args: unknown) => Promise<
        Array<{
          weekStart: Date;
          weekEnd: Date;
          summaryJson: unknown;
        }>
      >;
    };
  };

  const summaries = await prismaAny.weeklySummary.findMany({
    where: { tenantId: user.tenantId, conversationId: query.conversationId },
    orderBy: { weekStart: "desc" },
    take: count,
  });

  if (query.format === "json") {
    return NextResponse.json({
      items: summaries.map((item) => ({
        weekStart: item.weekStart.toISOString(),
        weekEnd: item.weekEnd.toISOString(),
        summary: item.summaryJson,
      })),
    });
  }

  const rows = [
    [
      "week_start",
      "week_end",
      "events",
      "dominant_emotions",
      "signals_triggered",
      "messages_delta",
      "events_delta",
      "signals_delta",
    ],
  ];

  summaries.forEach((item) => {
    const summary = item.summaryJson as {
      events?: Array<{ label: string }>;
      dominantEmotions?: Array<{ label: string; count: number }>;
      signalsTriggered?: Array<{ key: string; count: number }>;
      changes?: { messages?: number; events?: number; signals?: number };
    };
    const events = (summary.events ?? []).map((e) => e.label).join(" | ");
    const emotions = (summary.dominantEmotions ?? [])
      .map((e) => `${e.label}:${e.count}`)
      .join(" | ");
    const signals = (summary.signalsTriggered ?? [])
      .map((s) => `${s.key}:${s.count}`)
      .join(" | ");
    rows.push([
      item.weekStart.toISOString().slice(0, 10),
      item.weekEnd.toISOString().slice(0, 10),
      events,
      emotions,
      signals,
      String(summary.changes?.messages ?? 0),
      String(summary.changes?.events ?? 0),
      String(summary.changes?.signals ?? 0),
    ]);
  });

  const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"weekly-summary.csv\"",
    },
  });
}
