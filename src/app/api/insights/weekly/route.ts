import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireConversationAccess, requireRole } from "@/lib/auth/guards";
import { decryptDek, decryptMessage, getMasterKek } from "@/lib/crypto";
import { detectSignals, resolveSignalConfig, type SignalKey } from "@/lib/ai/detection";

type WeeklySummary = {
  weekStart: string;
  weekEnd: string;
  events: Array<{ label: string; createdAt: string }>;
  dominantEmotions: Array<{ label: string; count: number }>;
  signalsTriggered: Array<{ key: SignalKey; count: number }>;
  changes: { messages: number; events: number; signals: number };
};

const querySchema = z.object({
  conversationId: z.string().min(1),
  weekStart: z.string().optional(),
  weeks: z.coerce.number().int().min(1).max(26).optional(),
  refresh: z.coerce.boolean().optional(),
});

const MAX_WEEKS = 8;

const startOfWeek = (value: Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
};

const addDays = (value: Date, days: number) => {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

async function loadSignalConfig(tenantId: string, userId: string) {
  const policy = await prisma.aiPolicy.findFirst({
    where: { tenantId, ownerUserId: userId },
    orderBy: { updatedAt: "desc" },
  });
  const flags = policy?.flagsJson ?? null;
  const config = resolveSignalConfig(
    (flags as { signalConfig?: unknown })?.signalConfig as
      | Partial<ReturnType<typeof resolveSignalConfig>>
      | undefined,
  );
  return config;
}

async function generateWeeklySummary(params: {
  tenantId: string;
  conversationId: string;
  weekStart: Date;
  weekEnd: Date;
  dek: Buffer;
  signalConfig: ReturnType<typeof resolveSignalConfig>;
}) {
  const { tenantId, conversationId, weekStart, weekEnd, dek, signalConfig } = params;
  const [messages, records] = await Promise.all([
    prisma.message.findMany({
      where: {
        tenantId,
        conversationId,
        createdAt: { gte: weekStart, lte: addDays(weekEnd, 1) },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.record.findMany({
      where: {
        tenantId,
        conversationId,
        createdAt: { gte: weekStart, lte: addDays(weekEnd, 1) },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const signalsMap = new Map<SignalKey, number>();
  let messagesCount = 0;
  messages.forEach((message) => {
    const content = decryptMessage(message.ciphertext, message.iv, message.authTag, dek);
    messagesCount += 1;
    const detected = detectSignals(content, signalConfig);
    (Object.keys(detected) as SignalKey[]).forEach((key) => {
      if (!detected[key]) {
        return;
      }
      signalsMap.set(key, (signalsMap.get(key) ?? 0) + 1);
    });
  });

  const events = records
    .map((record) => ({
      label: (record.dataJson as { event?: string })?.event ?? "",
      createdAt: record.createdAt.toISOString(),
    }))
    .filter((item) => item.label)
    .slice(0, 6);

  const emotionMap = new Map<string, number>();
  records.forEach((record) => {
    const emotion = (record.dataJson as { emotion?: string })?.emotion ?? "";
    const key = emotion.trim().toLowerCase();
    if (key) {
      emotionMap.set(key, (emotionMap.get(key) ?? 0) + 1);
    }
  });

  const dominantEmotions = Array.from(emotionMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, count }));

  const signalsTriggered = Array.from(signalsMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    events,
    dominantEmotions,
    signalsTriggered,
    changes: { messages: messagesCount, events: events.length, signals: signalsTriggered.reduce((sum, item) => sum + item.count, 0) },
  };
}

export async function GET(request: Request) {
  const { user } = await requireAuth();
  requireRole(user.role, ["PSYCHOLOGIST"]);

  const url = new URL(request.url);
  const query = querySchema.parse({
    conversationId: url.searchParams.get("conversationId"),
    weekStart: url.searchParams.get("weekStart") ?? undefined,
  });

  const conversation = await requireConversationAccess({
    tenantId: user.tenantId,
    conversationId: query.conversationId,
    userId: user.id,
    role: user.role,
  });

  const dek = decryptDek(conversation.encryptedDek, getMasterKek());
  const signalConfig = await loadSignalConfig(user.tenantId, user.id);

  let weekStarts: Date[] = [];
  if (query.weekStart) {
    const parsed = new Date(query.weekStart);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 });
    }
    weekStarts = [startOfWeek(parsed)];
  } else {
    const latestMessage = await prisma.message.findFirst({
      where: { tenantId: user.tenantId, conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const latestRecord = await prisma.record.findFirst({
      where: { tenantId: user.tenantId, conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const latest =
      latestMessage?.createdAt && latestRecord?.createdAt
        ? latestMessage.createdAt > latestRecord.createdAt
          ? latestMessage.createdAt
          : latestRecord.createdAt
        : latestMessage?.createdAt ?? latestRecord?.createdAt ?? new Date();
    const start = startOfWeek(latest);
    const count = query.weeks ?? MAX_WEEKS;
    weekStarts = Array.from({ length: count }, (_, idx) => addDays(start, -7 * idx));
  }

  const summaries = [];
  const prismaAny = prisma as typeof prisma & {
    weeklySummary: {
      upsert: (args: unknown) => Promise<unknown>;
      findMany: (args: unknown) => Promise<
        Array<{
          weekStart: Date;
          weekEnd: Date;
          summaryJson: unknown;
        }>
      >;
    };
  };

  for (const weekStart of weekStarts) {
    const weekEnd = addDays(weekStart, 6);
    if (!query.refresh) {
      const cached = await prismaAny.weeklySummary.findMany({
        where: {
          tenantId: user.tenantId,
          conversationId: conversation.id,
          weekStart,
        },
        take: 1,
      });
      if (cached.length > 0) {
        const cachedSummary = cached[0].summaryJson as WeeklySummary;
        summaries.push({
          ...cachedSummary,
          weekStart: cached[0].weekStart.toISOString(),
          weekEnd: cached[0].weekEnd.toISOString(),
        });
        continue;
      }
    }

    const summary = await generateWeeklySummary({
      tenantId: user.tenantId,
      conversationId: conversation.id,
      weekStart,
      weekEnd,
      dek,
      signalConfig,
    });

    await prismaAny.weeklySummary.upsert({
      where: {
        conversationId_weekStart: {
          conversationId: conversation.id,
          weekStart,
        },
      },
      update: {
        summaryJson: summary as unknown as object,
        weekEnd,
        generatedAt: new Date(),
      },
      create: {
        tenantId: user.tenantId,
        conversationId: conversation.id,
        weekStart,
        weekEnd,
        summaryJson: summary as unknown as object,
      },
    });

    summaries.push(summary);
  }

  summaries.sort(
    (a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime(),
  );

  return NextResponse.json({ items: summaries });
}
