import { getRedis } from "@/lib/redis";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PromptSnapshot = {
  tenantId: string;
  conversationId: string;
  createdAt: string;
  model: string;
  messages: ChatMessage[];
};

const TTL_SECONDS = 60 * 60;

function buildKey(tenantId: string, conversationId: string) {
  return `ai:prompt:${tenantId}:${conversationId}`;
}

export async function storePromptSnapshot(snapshot: PromptSnapshot) {
  const redis = getRedis();
  const key = buildKey(snapshot.tenantId, snapshot.conversationId);
  await redis.set(key, JSON.stringify(snapshot), "EX", TTL_SECONDS);
}

export async function getPromptSnapshot(params: {
  tenantId: string;
  conversationId: string;
}) {
  const redis = getRedis();
  const key = buildKey(params.tenantId, params.conversationId);
  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PromptSnapshot;
  } catch {
    return null;
  }
}
