/**
 * The API key the browser holds for a gated server (#346).
 *
 * Design: `docs/specs/lan-web-access.md`. On an ungated server (every loopback
 * install) nothing here is ever written: the key is stored only after the
 * server refused the browser with the Cerefox challenge and the user typed it.
 *
 * Storage is per origin (scheme, host AND port), which is why this is not a
 * cookie: a NAS serves several apps from one address, and a cookie for that
 * host would reach all of them. `sessionStorage` by default; `localStorage`
 * when the user ticks "Remember on this browser". Every access is wrapped,
 * because a browser that blocks storage throws on the accessor itself; the key
 * then lives in memory until reload.
 */

const STORAGE_KEY = "cerefox.apiKey";

export type AuthPrompt = null | "missing" | "rejected";

let memoryKey: string | null = null;
let prompt: AuthPrompt = null;
/** Bumped whenever the user sets or forgets the key, so a refusal can be
 *  matched to the key state its request was sent under, not just the value
 *  (the user can re-enter the very key a late refusal is about). */
let generation = 0;
const listeners = new Set<() => void>();

function storages(): Storage[] {
  return [safeSession(), safeLocal()].filter((store): store is Storage => store !== null);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getApiKey(): string | null {
  if (memoryKey) return memoryKey;
  for (const store of storages()) {
    try {
      const value = store.getItem(STORAGE_KEY);
      if (value) {
        memoryKey = value;
        return value;
      }
    } catch {
      /* unreadable; try the next one */
    }
  }
  return null;
}

/** Keep `key`; in `localStorage` when `remember`, else in `sessionStorage`. */
export function setApiKey(key: string, remember: boolean): void {
  forgetStored();
  memoryKey = key;
  generation++;
  try {
    (remember ? safeLocal() : safeSession())?.setItem(STORAGE_KEY, key);
  } catch {
    /* blocked or full: the in-memory copy still works until reload */
  }
  prompt = null;
  notify();
}

/** Drop the key everywhere. The next refused call brings the prompt back. */
export function forgetApiKey(): void {
  memoryKey = null;
  generation++;
  forgetStored();
  notify();
}

function forgetStored(): void {
  for (const store of storages()) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to remove */
    }
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

function safeLocal(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Is this response the Cerefox gate refusing the caller?
 *
 * Only `apiAuth()` sets this challenge, so an unrelated 401 (or a 403) never
 * opens the prompt.
 */
export function isCerefoxChallenge(status: number, wwwAuthenticate: string | null): boolean {
  return status === 401 && /\bbearer\b/i.test(wwwAuthenticate ?? "") &&
    /realm="cerefox"/i.test(wwwAuthenticate ?? "");
}

/**
 * Record a refusal of a call that carried `sentKey` (null: none). A key that
 * was refused is dropped (rotated, or the container recreated with a new one),
 * so the prompt says so rather than repeating the call with it. Only THAT key:
 * a call sent before the user entered a key can be refused after they did, and
 * must not take the new one with it, even when it is the same value typed
 * again: `sentGeneration` (from {@link getKeyGeneration} when the call was
 * sent) marks a refusal from before the user's last change as stale.
 */
export function noteChallenge(sentKey: string | null, sentGeneration?: number): void {
  if (sentGeneration !== undefined && sentGeneration !== generation) return;
  const hadKey = sentKey !== null && getApiKey() === sentKey;
  if (!hadKey && getApiKey() !== null) return;
  if (hadKey) {
    memoryKey = null;
    forgetStored();
  }
  const next: AuthPrompt = hadKey ? "rejected" : prompt ?? "missing";
  if (next !== prompt) {
    prompt = next;
    notify();
  }
}

export function getKeyGeneration(): number {
  return generation;
}

export function getAuthPrompt(): AuthPrompt {
  return prompt;
}

export function subscribeApiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook: back to the boot state. */
export function resetApiKeyStateForTests(): void {
  memoryKey = null;
  prompt = null;
  generation = 0;
  listeners.clear();
}
