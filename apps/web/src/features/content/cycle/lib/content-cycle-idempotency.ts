type StoredIdempotencyRecord = {
  idempotencyKey: string;
  requestFingerprint: string;
};

/**
 * Computes a SHA-256 hex string of a string input using Web Crypto API.
 * Falls back safely if crypto.subtle is unavailable (e.g. in test envs).
 */
export async function computeFingerprint(payloadString: string): Promise<string> {
  if (
    typeof window !== "undefined" &&
    window.crypto &&
    window.crypto.subtle &&
    typeof TextEncoder !== "undefined"
  ) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(payloadString);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback below
    }
  }

  // Simple string hash fallback for server / test environments without crypto.subtle
  let hash = 0;
  for (let i = 0; i < payloadString.length; i++) {
    const char = payloadString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fb_${Math.abs(hash).toString(16)}`;
}

export function generateUUID(): string {
  if (
    typeof window !== "undefined" &&
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }
  // Simple fallback UUID v4 format generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function storageKey(scope: string): string {
  return `mm_idempotency:${scope}`;
}

export function getOrCreateIdempotencyKey(
  scope: string,
  fingerprint: string,
): string {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return generateUUID();
  }

  const key = storageKey(scope);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw) {
      const parsed: StoredIdempotencyRecord = JSON.parse(raw);
      if (parsed.requestFingerprint === fingerprint && parsed.idempotencyKey) {
        return parsed.idempotencyKey;
      }
    }
    const newKey = generateUUID();
    const record: StoredIdempotencyRecord = {
      idempotencyKey: newKey,
      requestFingerprint: fingerprint,
    };
    window.sessionStorage.setItem(key, JSON.stringify(record));
    return newKey;
  } catch {
    return generateUUID();
  }
}

export function clearIdempotencyKey(scope: string): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(storageKey(scope));
  } catch {
    // ignore
  }
}
