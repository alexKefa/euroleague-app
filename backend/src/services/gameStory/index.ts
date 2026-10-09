// Game story cards (2026-10-09): the public entry points. A final game's
// summary and PNG are computed on first request and kept in a bounded
// cache (newest 60, never a null); clearStoryCache() runs whenever a
// game's stats or stints can change (see backend/src/index.ts).
import { pickStory } from "./angles.js";
import { BoundedCache, storyVersion } from "./cache.js";
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
  // Link-preview title: headline + matchup (just the matchup when the
  // headline is the score).
  title: string;
  // Changes whenever the card's content does; the image URL carries it as
  // ?v= so browsers and link-preview crawlers never keep a stale card.
  version: string;
}

const cache = new BoundedCache(60);

export function clearStoryCache(): void {
  cache.clear();
}

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "el";
}

export function getStorySummary(gameId: string, lang: Lang): Promise<StorySummary | null> {
  return cache.remember(`summary:${gameId}:${lang}`, async () => {
    const facts = await loadGameFacts(gameId);
    if (!facts) return null;
    const story = pickStory(facts);
    const t = storyText(story, facts, lang);
    const title = story.angle === "numbers" ? t.matchup : `${t.headline} · ${t.matchup}`;
    return { angle: story.angle, label: t.label, headline: t.headline, lede: t.lede, shareText: t.shareText, title, version: storyVersion(story) };
  });
}

export function getStoryPng(gameId: string, lang: Lang): Promise<Buffer | null> {
  return cache.remember(`png:${gameId}:${lang}`, async () => {
    const facts = await loadGameFacts(gameId);
    if (!facts) return null;
    const story = pickStory(facts);
    return renderStoryPng(story, facts, storyText(story, facts, lang));
  });
}
