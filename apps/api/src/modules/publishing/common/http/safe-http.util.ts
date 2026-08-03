import { Logger } from "@nestjs/common";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-callback-secret",
  "cookie",
  "set-cookie",
  "x-n8n-token",
]);

const SENSITIVE_KEYS = new Set([
  "token",
  "accessToken",
  "access_token",
  "secret",
  "credential",
  "credentialRef",
  "credential_ref",
  "password",
  "Authorization",
  "x-api-key",
  "x-callback-secret",
]);

/**
 * Strips all credential/token/authorization fields from an error object
 * *before* it reaches any logger or generic catch block.
 *
 * This is the mandatory defense-in-depth complement to the allow-list
 * projector: library exception objects (e.g. Axios) embed the full request
 * config, including headers and auth tokens. This wrapper must wrap every
 * outbound HTTP call to n8n and the secrets manager.
 */
export function sanitizeErrorForLogging(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }

  const safe: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  };

  // Axios-specific sanitization
  const axiosErr = err as unknown as Record<string, unknown>;
  if (axiosErr["response"]) {
    const res = axiosErr["response"] as Record<string, unknown>;
    safe["status"] = res["status"];
    safe["statusText"] = res["statusText"];
    // Never log response data — may contain signed URLs or provider tokens
  }
  if (axiosErr["config"]) {
    const cfg = axiosErr["config"] as Record<string, unknown>;
    safe["method"] = cfg["method"];
    // Strip URL if it contains query params (may have tokens)
    if (typeof cfg["url"] === "string") {
      const u = cfg["url"];
      safe["url"] = u.split("?")[0];
    }
  }

  return safe;
}

/**
 * Strips sensitive headers from an outbound request headers object.
 * Call this before building any log entry that includes request metadata.
 */
export function stripSensitiveHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Recursively strips known sensitive keys from any plain object.
 * Used when persisting or logging request/response metadata fragments.
 */
export function deepStripSecrets<T>(obj: T): T {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj))
    return obj.map((v) => deepStripSecrets(v)) as unknown as T;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = deepStripSecrets(value);
    }
  }
  return result as T;
}

/**
 * Classifies an outbound HTTP exception as AMBIGUOUS (the request may have
 * reached the runner and the provider may already have published) versus a
 * DETERMINISTIC pre-send failure (misconfiguration / hard 4xx rejection before
 * any provider call). Ambiguous outcomes must never be retried blind.
 *
 * Inspected here, at the catch site, while the raw Axios error fields
 * (`code`, `isAxiosError`, `response.status`) are still available. The typed
 * {@link SafeHttpError} carries only the resulting boolean flag downstream so
 * no library internals (and no secrets) leak to callers or logs.
 */
export function classifyAmbiguousDelivery(err: unknown): boolean {
  if (!err) return false;
  const e = err as {
    code?: string;
    response?: { status?: number };
    isAxiosError?: boolean;
    name?: string;
    message?: string;
  };
  // Already-sanitized SafeHttpError: trust the precomputed flag.
  if (e instanceof SafeHttpError) return e.ambiguousDelivery;
  // Axios/transport ambiguity: timeout, connection reset, dropped connection.
  if (
    e.code === "ECONNABORTED" ||
    e.code === "ETIMEDOUT" ||
    e.code === "ECONNRESET" ||
    e.code === "ECONNREFUSED" ||
    e.code === "EPIPE" ||
    e.code === "EAI_AGAIN"
  ) {
    return true;
  }
  // A 5xx after the runner may have started executing is ambiguous.
  if (e.isAxiosError && typeof e.response?.status === "number") {
    return e.response.status >= 500;
  }
  // No response at all (network) and not a deterministic misconfig — ambiguous.
  if (e.isAxiosError && e.response === undefined) return true;
  return false;
}

/**
 * Typed, secret-free error thrown by {@link safeHttp}. Carries ONLY the
 * sanitized metadata plus an `ambiguousDelivery` flag so downstream handlers
 * (the dispatch processor) can classify the failure without re-inspecting
 * library internals — which sanitization has already stripped.
 */
export class SafeHttpError extends Error {
  readonly ambiguousDelivery: boolean;
  readonly safeMetadata: Record<string, unknown>;
  constructor(
    label: string,
    ambiguousDelivery: boolean,
    safeMetadata: Record<string, unknown>,
  ) {
    super(`[${label}] outbound HTTP call failed — see server logs`);
    this.name = "SafeHttpError";
    this.ambiguousDelivery = ambiguousDelivery;
    this.safeMetadata = safeMetadata;
  }
}

/** Wraps an async HTTP call, sanitizes any error, and re-throws a typed
 *  SafeHttpError that preserves the ambiguous-delivery classification without
 *  leaking library internals or secrets. */
export async function safeHttp<T>(
  logger: Logger,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const safe = sanitizeErrorForLogging(err);
    const ambiguous = classifyAmbiguousDelivery(err);
    logger.error(`[${label}] outbound HTTP error`, {
      ...safe,
      ambiguousDelivery: ambiguous,
    });
    throw new SafeHttpError(label, ambiguous, safe);
  }
}
