// Game story cards (2026-10-09): a small bounded cache for summaries and
// PNGs, and a version stamp for the image URL. Pure; checked by
// scripts/check-game-story.ts.
import type { Story } from "./types.js";

/**
 * Keeps the newest `max` results. A null result (unknown, live or
 * scheduled game) is never kept, so it can't hide a game that just went
 * final or push real cards out. A failed load is dropped, but only if it's
 * still the entry for that key.
 */
export class BoundedCache {
  private readonly map = new Map<string, Promise<unknown>>();
  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  remember<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key); // refresh recency
      this.map.set(key, hit);
      return hit as Promise<T | null>;
    }
    const p = load();
    this.map.set(key, p);
    const dropIfCurrent = () => {
      if (this.map.get(key) === p) this.map.delete(key);
    };
    p.then((v) => v === null && dropIfCurrent(), dropIfCurrent);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
    return p;
  }
}

/** Short stamp of a story's content, for cache-busting the image URL. */
export function storyVersion(story: Story): string {
  const s = `${story.angle}|${JSON.stringify(story.data)}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
