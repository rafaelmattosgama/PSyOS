import Redis, { type RedisOptions } from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function getRedis(): Redis {
  if (globalForRedis.redis) {
    return globalForRedis.redis;
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not configured");
  }

  const password = process.env.REDIS_PASSWORD;
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    ...(password ? { password } : {}),
  });

  globalForRedis.redis = redis;
  return redis;
}

export function getRedisConnectionOptions(): RedisOptions {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not configured");
  }

  const parsed = new URL(url);
  const options: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
  };

  if (parsed.password) {
    options.password = decodeURIComponent(parsed.password);
  }
  if (process.env.REDIS_PASSWORD) {
    options.password = process.env.REDIS_PASSWORD;
  }

  if (parsed.pathname && parsed.pathname !== "/") {
    const db = Number(parsed.pathname.replace("/", ""));
    if (!Number.isNaN(db)) {
      options.db = db;
    }
  }

  if (parsed.protocol === "rediss:") {
    options.tls = {};
  }

  return options;
}
