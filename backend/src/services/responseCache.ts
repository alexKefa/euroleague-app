/**
 * In-memory cache for heavy, mostly-static read endpoints (2026-10-08).
 * Neon's Free plan caps network transfer at 5 GB/month per project and
 * production was on pace for ~4.5 GB: the card catalog (~360 KB), player
 * advanced stats (~320 KB, loaded by the landing page for every visitor)
 * and the fantasy player pool (~175 KB) each re-read the database on every
 * page view. Each now reads once per TTL, or again right after the job or
 * admin action that changes its data calls invalidate().
 *
 * One Railway instance, so a process-local Map is enough. Concurrent misses
 * share one in-flight load instead of each hitting the database.
 */
type Entry = { value: unknown; expiresAt: number } | { pending: Promise<unknown> };

const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit) {
    if ("pending" in hit) return hit.pending as Promise<T>;
    if (hit.expiresAt > Date.now()) return hit.value as T;
  }
  const pending = load();
  store.set(key, { pending });
  try {
    const value = await pending;
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  } catch (err) {
    store.delete(key); // don't cache failures
    throw err;
  }
}

/** Drops every cached entry whose key starts with one of the prefixes. */
export function invalidate(...prefixes: string[]): void {
  for (const key of store.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) store.delete(key);
  }
}

export const CACHE_KEYS = {
  collectibles: "collectibles:catalog",
  advancedStats: "players:advanced-stats",
  fantasyPlayers: "fantasy:players:", // + season
  preview: "preview:", // + "game:<id>" | "round:<season>:<round>"
  lineup: "lineup:", // + "<teamId>:<season>:<sorted player codes>"
} as const;

/**
 * Router middleware: after any successful non-GET request through this
 * router finishes, drop the given cache prefixes. Runs on "finish" so a
 * concurrent GET can't re-cache the pre-write data.
 */
export function invalidateOnWrite(...prefixes: string[]) {
  return (req: { method: string }, res: { statusCode: number; on(event: "finish", cb: () => void): void }, next: () => void) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.on("finish", () => {
        if (res.statusCode < 400) invalidate(...prefixes);
      });
    }
    next();
  };
}
