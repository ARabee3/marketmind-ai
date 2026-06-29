import { withTimeout } from "./timeout";

export type ExternalHttpJsonOptions = {
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
};

export async function getExternalJson<T>(
  url: string,
  options: ExternalHttpJsonOptions = {},
): Promise<T> {
  const response = await fetch(url, {
    headers: options.headers,
    signal: withTimeout(options.timeoutMs ?? 8000),
  });

  if (!response.ok) {
    throw new Error(`External request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getExternalText(
  url: string,
  options: ExternalHttpJsonOptions = {},
): Promise<string> {
  const response = await fetch(url, {
    headers: options.headers,
    signal: withTimeout(options.timeoutMs ?? 8000),
  });

  if (!response.ok) {
    throw new Error(`External request failed with ${response.status}`);
  }

  return response.text();
}

export async function postExternalJson<T>(
  url: string,
  body: unknown,
  options: ExternalHttpJsonOptions = {},
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
    signal: withTimeout(options.timeoutMs ?? 8000),
  });

  if (!response.ok) {
    throw new Error(`External request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}
