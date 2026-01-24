import { Queue } from "bullmq";
import { getRedis } from "@/lib/redis";

export const inboundQueue = new Queue("inbound_message_process", {
  connection: getRedis(),
});

export const aiQueue = new Queue("ai_reply_generate", {
  connection: getRedis(),
});

export const outboundQueue = new Queue("outbound_send_retry", {
  connection: getRedis(),
});
