import { getRedis } from "@/lib/redis";

export class RateLimitExceededError extends Error {
  constructor() {
    super("Rate limit exceeded");
    this.name = "RateLimitExceededError";
  }
}

type InMemoryRateLimitEntry = {
  count: number;
  expiresAt: number;
};

const globalForRateLimit = globalThis as unknown as {
  inMemoryRateLimit?: Map<string, InMemoryRateLimitEntry>;
};

function getInMemoryRateLimitStore() {
  if (!globalForRateLimit.inMemoryRateLimit) {
    globalForRateLimit.inMemoryRateLimit = new Map<string, InMemoryRateLimitEntry>();
  }
  return globalForRateLimit.inMemoryRateLimit;
}

function enforceInMemoryRateLimit(params: {
  key: string;
  limit: number;
  windowSeconds: number;
}) {
  const store = getInMemoryRateLimitStore();
  const now = Date.now();
  const ttl = params.windowSeconds * 1000;

  // Opportunistic cleanup to avoid unbounded growth.
  if (store.size > 5000) {
    for (const [entryKey, entry] of store.entries()) {
      if (entry.expiresAt <= now) {
        store.delete(entryKey);
      }
    }
  }

  const entry = store.get(params.key);
  if (!entry || entry.expiresAt <= now) {
    store.set(params.key, { count: 1, expiresAt: now + ttl });
    return;
  }

  entry.count += 1;
  if (entry.count > params.limit) {
    throw new RateLimitExceededError();
  }
}

export async function enforceRateLimit(params: {
  key: string;
  limit: number;
  windowSeconds: number;
}) {
  const { key, limit, windowSeconds } = params;
  const redis = getRedis();

  let count = 0;
  try {
    count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
  } catch (error) {
    // Fall back to process-memory limit when Redis is temporarily unavailable.
    console.error(
      "[rate-limit] Redis error, falling back to in-memory limit:",
      (error as Error).message,
    );
    enforceInMemoryRateLimit(params);
    return;
  }

  if (count > limit) {
    throw new RateLimitExceededError();
  }
}
