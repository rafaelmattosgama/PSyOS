import { getRedis } from "@/lib/redis";

export class RateLimitExceededError extends Error {
  constructor() {
    super("Rate limit exceeded");
    this.name = "RateLimitExceededError";
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
    // Fail-open when Redis is temporarily unavailable so auth does not break.
    console.error(
      "[rate-limit] Redis error, skipping rate-limit:",
      (error as Error).message,
    );
    return;
  }

  if (count > limit) {
    throw new RateLimitExceededError();
  }
}
