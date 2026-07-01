import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { withTimeout } from "./timeout";

export type ExternalHttpJsonOptions = {
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly validateUrl?: boolean;
  readonly maxBodyBytes?: number;
  readonly maxRedirects?: number;
  readonly signal?: AbortSignal;
};

const DEFAULT_MAX_REDIRECTS = 3;

export async function getExternalJson<T>(
  url: string,
  options: ExternalHttpJsonOptions = {},
): Promise<T> {
  const response = await fetchExternal(url, options);

  if (!response.ok) {
    throw new Error(`External request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getExternalText(
  url: string,
  options: ExternalHttpJsonOptions = {},
): Promise<string> {
  const response = await fetchExternal(url, options);

  if (!response.ok) {
    throw new Error(`External request failed with ${response.status}`);
  }

  return responseText(response, options.maxBodyBytes);
}

export async function postExternalJson<T>(
  url: string,
  body: unknown,
  options: ExternalHttpJsonOptions = {},
): Promise<T> {
  if (options.validateUrl) {
    await assertSafeExternalUrl(url);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
    signal: requestSignal(options.timeoutMs ?? 8000, options.signal),
  });

  if (!response.ok) {
    throw new Error(`External request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchExternal(
  url: string,
  options: ExternalHttpJsonOptions,
): Promise<Response> {
  let currentUrl = url;
  const redirectLimit = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  for (
    let redirectCount = 0;
    redirectCount <= redirectLimit;
    redirectCount += 1
  ) {
    if (options.validateUrl) {
      await assertSafeExternalUrl(currentUrl);
    }

    const response = await fetch(currentUrl, {
      headers: options.headers,
      redirect: "manual",
      signal: requestSignal(options.timeoutMs ?? 8000, options.signal),
    });

    if (!isRedirect(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("External request exceeded redirect limit");
}

export async function assertSafeExternalUrl(rawUrl: string): Promise<void> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Unsafe external URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsafe external URL");
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Unsafe external URL");
  }

  if (isUnsafeIp(hostname)) {
    throw new Error("Unsafe external URL");
  }

  if (isIP(hostname) !== 0) {
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.some((address) => isUnsafeIp(address.address))) {
    throw new Error("Unsafe external URL");
  }
}

async function responseText(
  response: Response,
  maxBodyBytes: number | undefined,
): Promise<string> {
  if (!maxBodyBytes) {
    return response.text();
  }

  const contentLength = Number.parseInt(
    response.headers?.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new Error(`External response exceeded ${maxBodyBytes} bytes`);
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
      throw new Error(`External response exceeded ${maxBodyBytes} bytes`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let receivedBytes = 0;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      return body + decoder.decode();
    }

    receivedBytes += chunk.value.byteLength;
    if (receivedBytes > maxBodyBytes) {
      await reader.cancel();
      throw new Error(`External response exceeded ${maxBodyBytes} bytes`);
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isUnsafeIp(value: string): boolean {
  const ipVersion = isIP(value);

  if (ipVersion === 4) {
    return isUnsafeIpv4(value);
  }

  if (ipVersion === 6) {
    return isUnsafeIpv6(value);
  }

  return false;
}

function isUnsafeIpv4(value: string): boolean {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  const [first, second] = parts;

  if (first === undefined || second === undefined) {
    return true;
  }

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function isUnsafeIpv6(value: string): boolean {
  const normalized = value.toLowerCase();

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff")
  );
}

function normalizeHostname(value: string): string {
  const hostname = value.toLowerCase();

  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function requestSignal(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): AbortSignal {
  const timeoutSignal = withTimeout(timeoutMs);
  return parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
}
