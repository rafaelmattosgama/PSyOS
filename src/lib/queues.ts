import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "@/lib/redis";

let inboundQueue: Queue | null = null;
let aiQueue: Queue | null = null;
let outboundQueue: Queue | null = null;

export function getInboundQueue() {
  if (!inboundQueue) {
    inboundQueue = new Queue("inbound_message_process", {
      connection: getRedisConnectionOptions(),
    });
  }
  return inboundQueue;
}

export function getAiQueue() {
  if (!aiQueue) {
    aiQueue = new Queue("ai_reply_generate", {
      connection: getRedisConnectionOptions(),
    });
  }
  return aiQueue;
}

export function getOutboundQueue() {
  if (!outboundQueue) {
    outboundQueue = new Queue("outbound_send_retry", {
      connection: getRedisConnectionOptions(),
    });
  }
  return outboundQueue;
}
