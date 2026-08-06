/**
 * BullMQ dispatch priority bands. Lower priority number = higher urgency.
 *
 * BullMQ processes jobs with the lowest `priority` value first. We map
 * proximity to the scheduled UTC time onto small bands so jobs that are
 * overdue (or due imminently) overtake far-future dispatch jobs while the
 * queue is processing a big batch.
 */

export function publishingPriorityFor(
  scheduledUtcAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!scheduledUtcAt) {
    return 4;
  }
  const msUntilDue = scheduledUtcAt.getTime() - now.getTime();
  if (msUntilDue <= 0) {
    return 0;
  }
  const minutesUntilDue = msUntilDue / 60_000;
  if (minutesUntilDue <= 60) {
    return 1;
  }
  if (minutesUntilDue <= 6 * 60) {
    return 2;
  }
  if (minutesUntilDue <= 24 * 60) {
    return 3;
  }
  return 4;
}