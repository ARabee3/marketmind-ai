import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { config } from "dotenv";

config();

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const queue = new Queue("publishing-dispatch", { connection: { url: redisUrl } });

  const stale = await prisma.publishingIntent.findMany({
    where: { status: { in: ["SCHEDULED", "DISPATCHING"] } },
    select: { id: true, status: true, version: true },
  });
  console.log("stale intents:", JSON.stringify(stale));

  for (const intent of stale) {
    const key = `publish:${intent.id}:${intent.version}`;
    const removed = await queue.remove(key);
    console.log(`removed job ${key}: ${removed}`);
  }

  await prisma.publishingIntent.updateMany({
    where: { status: { in: ["SCHEDULED", "DISPATCHING"] } },
    data: { status: "CANCELLED" },
  });
  console.log("stale intents set to CANCELLED");

  await queue.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("cleanup failed:", e);
  process.exit(1);
});
