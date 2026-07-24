const INTERNAL_REF = "internal:reviewed-marketing-methodology";
const DEFAULT_OPTIONS = Object.freeze({
  attempts: 3,
  retryDelayMs: 250,
  headTimeoutMs: 15000,
  getTimeoutMs: 20000,
});

async function fetchSource(url, method, options) {
  let lastError;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(
          method === "HEAD" ? options.headTimeoutMs : options.getTimeoutMs,
        ),
      });
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === options.attempts) return { response };
      await response.body?.cancel();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      lastError = error;
      if (attempt === options.attempts) return { error };
    }
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs * attempt));
  }
  return { error: lastError };
}

async function cancelResponseBody(response) {
  if (!response?.body) return;
  try {
    await response.body.cancel();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
}

export async function resolveSource(url, overrides = {}) {
  if (url === INTERNAL_REF) return { ok: true, skipped: true };
  const options = { ...DEFAULT_OPTIONS, ...overrides };

  const head = await fetchSource(url, "HEAD", options);
  if (head.response?.status < 400) {
    return { ok: true, status: head.response.status };
  }

  const get = await fetchSource(url, "GET", options);
  await cancelResponseBody(get.response);
  if (get.response?.status < 400) {
    return { ok: true, status: get.response.status };
  }
  if (get.response) return { ok: false, status: get.response.status };
  return {
    ok: false,
    error: get.error?.message || head.error?.message || "fetch failed",
  };
}
