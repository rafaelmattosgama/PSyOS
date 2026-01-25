import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "@/lib/redis";

export const inboundQueue = new Queue("inbound_message_process", {
  connection: getRedisConnectionOptions(),
});

export const aiQueue = new Queue("ai_reply_generate", {
  connection: getRedisConnectionOptions(),
});

export const outboundQueue = new Queue("outbound_send_retry", {
  connection: getRedisConnectionOptions(),
});
