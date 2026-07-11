import { setTimeout } from "node:timers/promises";

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }

  await setTimeout(ms, undefined, signal ? { signal } : undefined);
}
