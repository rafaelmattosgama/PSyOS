import { getRedis } from "@/lib/redis";

export async function enforceRateLimit(params: {
  key: string;
  limit: number;
  windowSeconds: number;
}) {
  const { key, limit, windowSeconds } = params;
  const redis = getRedis();
  const pipeline = redis.multi();
  pipeline.incr(key);
  pipeline.expire(key, windowSeconds, "NX");
  const results = await pipeline.exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  if (count > limit) {
    throw new Error("Rate limit exceeded");
  }
}
