// Game story cards (2026-10-09): the public entry points. A final game's
// facts, story and PNG are computed on first request and kept in a small
// bounded cache (the newest 60 entries); clearStoryCache() runs whenever a
// game's stats or stints can change (see backend/src/index.ts).
import { pickStory } from "./angles.js";
import { storyText, type Lang } from "./copy.js";
import { loadGameFacts } from "./facts.js";
import { renderStoryPng } from "./render.js";
import type { Angle } from "./types.js";

export type { Lang } from "./copy.js";

export interface StorySummary {
  angle: Angle;
  label: string;
  headline: string;
  lede: string;
  shareText: string;
}

const MAX_ENTRIES = 60;
const cache = new Map<string, Promise<unknown>>();

function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency.
    cache.delete(key);
    cache.set(key, hit);
    return hit as Promise<T>;
  }
  const p = load();
  cache.set(key, p);
  // Failures aren't kept, so the next request retries.
  p.catch(() => cache.delete(key));
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return p;
}

export function clearStoryCache(): void {
  cache.clear();
}

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "el";
}

export function getStorySummary(gameId: string, lang: Lang): Promise<StorySummary | null> {
  return remember(`summary:${gameId}:${lang}`, async () => {
    const facts = await loadGameFacts(gameId);
    if (!facts) return null;
    const story = pickStory(facts);
    const t = storyText(story, facts, lang);
    return { angle: story.angle, label: t.label, headline: t.headline, lede: t.lede, shareText: t.shareText };
  });
}

export function getStoryPng(gameId: string, lang: Lang): Promise<Buffer | null> {
  return remember(`png:${gameId}:${lang}`, async () => {
    const facts = await loadGameFacts(gameId);
    if (!facts) return null;
    const story = pickStory(facts);
    return renderStoryPng(story, facts, storyText(story, facts, lang));
  });
}
