/**
 * BullMQ reserves `:` in custom job ids. Keep the durable application id
 * unchanged for database idempotency, and sanitize only the Redis-facing id.
 */
export function toBullMqJobId(jobId: string): string {
  return jobId.replace(/:/g, "-");
}
