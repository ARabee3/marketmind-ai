export const FACEBOOK_PERFORMANCE_QUEUE = "facebook-performance-sync" as const;
export const FACEBOOK_PERFORMANCE_JOB = "sync-window" as const;

export const PERFORMANCE_RECONCILE_INTERVAL_MS = 30_000;
export const PERFORMANCE_LEASE_DURATION_MS = 5 * 60_000;
export const PERFORMANCE_MAX_ATTEMPTS = 5;
export const PERFORMANCE_RETRY_BASE_MS = 60_000;
export const PERFORMANCE_REFRESH_COOLDOWN_MS = 60_000;
export const PERFORMANCE_RECONCILE_BATCH_SIZE = 25;
