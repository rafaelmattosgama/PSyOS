import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { getRedisConnectionOptions } from "@/lib/redis";
import { processInbound } from "@/worker/processors/inbound";
import { processAi } from "@/worker/processors/ai";

const connection = getRedisConnectionOptions();

const inboundWorker = new Worker(
  "inbound_message_process",
  async (job) => processInbound(job.data),
  {
    connection,
    lockDuration: 120000,
    stalledInterval: 30000,
    maxStalledCount: 3,
  },
);

const aiWorker = new Worker(
  "ai_reply_generate",
  async (job) => processAi(job.data),
  {
    connection,
    lockDuration: 120000,
    stalledInterval: 30000,
    maxStalledCount: 3,
  },
);

const logFailure =
  (label: string) => (job: Job | undefined, error: Error) => {
    console.error(`[worker:${label}] job ${job?.id ?? "unknown"} failed:`, error.message);
  };

inboundWorker.on("failed", logFailure("inbound"));
aiWorker.on("failed", logFailure("ai"));
aiWorker.on("completed", (job) => {
  console.log(`[worker:ai] job ${job.id} completed`);
});
aiWorker.on("active", (job) => {
  console.log(`[worker:ai] job ${job.id} active`);
});
aiWorker.on("error", (error) => {
  console.error("[worker:ai] worker error:", error.message);
});

console.log(
  "Worker running",
  `| OPENAI_MODEL=${process.env.OPENAI_MODEL ?? "unset"}`,
  `| OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? "set" : "missing"}`,
);
