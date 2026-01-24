import "dotenv/config";
import { Worker } from "bullmq";
import { getRedis } from "@/lib/redis";
import { processInbound } from "@/worker/processors/inbound";
import { processAi } from "@/worker/processors/ai";
import { processOutbound } from "@/worker/processors/outbound";

const connection = getRedis();

const inboundWorker = new Worker(
  "inbound_message_process",
  async (job) => processInbound(job.data),
  { connection },
);

const aiWorker = new Worker(
  "ai_reply_generate",
  async (job) => processAi(job.data),
  { connection },
);

const outboundWorker = new Worker(
  "outbound_send_retry",
  async (job) => processOutbound(job.data),
  { connection },
);

const logFailure = (label: string) => (job: { id?: string }, error: Error) => {
  // eslint-disable-next-line no-console
  console.error(`[worker:${label}] job ${job?.id ?? "unknown"} failed:`, error.message);
};

inboundWorker.on("failed", logFailure("inbound"));
aiWorker.on("failed", logFailure("ai"));
outboundWorker.on("failed", logFailure("outbound"));

// eslint-disable-next-line no-console
console.log("Worker running");
