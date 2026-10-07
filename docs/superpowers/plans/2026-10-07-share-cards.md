# Share Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/share` page that turns a player's (or two players') stat line for a chosen period into a Kit-style PNG and shares or downloads it.

**Architecture:** Pure stat logic in `share-card.logic.ts` (checked with a Node script), a presentational `KitCardComponent` rendered at 1080 px, an export helper around `html-to-image`, and a page component wiring the controls. Two entry buttons. No backend changes.

**Tech Stack:** Angular 20 standalone + signals, Tailwind, `html-to-image`, Web Share API.

**Spec:** `docs/superpowers/specs/2026-10-07-share-cards-design.md`

## Global Constraints

- No backend/schema changes; data from `getPlayer(id)` and `getPlayerGames(id)` only.
- EN + EL for every string in `core/i18n/share-card.ts`, merged in `translations.ts`. Stat labels stay untranslated.
- Card text uses the team's `secondaryColor` on `primaryColor` (fallbacks `#1f2937` / `#ffffff`).
- Export sizes: post 1080×1350, story 1080×1920. Footer: Clutch wordmark + `getclutchapp.com`.
- Guests allowed. No new nav item. Back link `navHistory.previousUrl() ?? '/stats'`.

## Review Focus

1. **Player with zero games** (early season, new signing). Expected: no crash; periods that need games are disabled, and the Share button stays usable only when a period with games is selected. Check `computeLine` with `[]` → all null values.
2. **Shooting % with zero attempts.** Expected: `–`, never `NaN%`. Check `formatValue("threePct", null, ...)`.
3. **Head-to-head ties and TOV.** Expected: equal values → no winner; TOV lower wins. Checks in Task 1.
4. **Games with null/0 minutes (DNP rows)** must not drag averages down. Check in Task 1.
5. **Photo fails or blocks capture** (CORS/404). Expected: the card still exports without the photo. Handled in `share-export.ts` by hiding a failed `<img>` before capture.

---

### Task 1: Stat logic + check script

**Files:** Create `frontend/src/app/features/share-card/share-card.logic.ts`; Test `frontend/scripts/check-share-card.ts`.

**Produces:**
```ts
export type StatKey = "pts" | "reb" | "ast" | "stl" | "blk" | "tov" | "pir" | "min" | "twoPct" | "threePct" | "ftPct";
export const STAT_KEYS: StatKey[];             // order above
export const STAT_LABELS: Record<StatKey, string>; // PTS REB AST STL BLK TOV PIR MIN 2P% 3P% FT%
export const DEFAULT_STATS: StatKey[];         // ["pts","reb","ast","pir"]
export type Period = { kind: "season" } | { kind: "last5" } | { kind: "lastGame" } | { kind: "vsTeam"; teamId: string };
export function playedGames(rows: PlayerGameLogEntry[]): PlayerGameLogEntry[]; // minutes > 0, newest first
export function gamesForPeriod(rows: PlayerGameLogEntry[], period: Period, playerTeamId: string): PlayerGameLogEntry[];
export function opponentsFaced(rows: PlayerGameLogEntry[], playerTeamId: string): { id: string; code: string; name: string }[]; // sorted by name, unique
export interface StatLine { games: number; values: Record<StatKey, number | null>; single: boolean }
export function computeLine(games: PlayerGameLogEntry[], single: boolean): StatLine;
export function formatValue(key: StatKey, value: number | null, single: boolean): string;
export function winner(key: StatKey, a: number | null, b: number | null): "a" | "b" | null;
export function splitName(feedName: string): { first: string; last: string }; // "SLOUKAS, KOSTAS" -> Kostas / Sloukas
```

Rules (spec "Numbers"): averages over games; percentages = sum makes / sum attempts (null when 0 attempts); `single` = Last game; formatting 1 decimal for averages, whole for single games, whole `%` for percentages, `–` for null; TOV lower wins; ties → null. `computeLine([])` → games 0, all values null.

- [ ] Write check script (cases: averages, last5 picks 5 newest, lastGame single, vsTeam filters by opponent, DNP rows excluded, pct from totals, zero-attempt pct → null → "–", winner incl. TOV + tie, splitName, empty games).
- [ ] Run → fails (module missing).
- [ ] Implement.
- [ ] Run → all ok. Commit.

### Task 2: Kit card component

**Files:** Create `features/share-card/kit-card.ts`.

**Produces:** `<app-kit-card>` with inputs `size: "post" | "story"`, `mode: "player" | "h2h"`, `players: KitPlayer[]` (1 or 2), `stats: StatKey[]`, `periodLabel: string`, where
`interface KitPlayer { first: string; last: string; jersey: number | null; teamCode: string; primary: string; secondary: string; photoUrl: string | null; line: StatLine }`.
Root element is exactly 1080×1350 / 1080×1920 px (inline styles, no Tailwind dependence for export-critical sizing); exposes the root `ElementRef` via `@ViewChild` as `cardEl`.

- [ ] Implement per spec "The Kit card" (photo `crossorigin="anonymous"`, `(error)` hides it).
- [ ] Build passes. Commit.

### Task 3: Export helper

**Files:** Create `features/share-card/share-export.ts`; modify `frontend/package.json` (add `html-to-image`).

**Produces:** `export async function exportCard(el: HTMLElement, fileName: string): Promise<"shared" | "downloaded" | "cancelled">` — awaits `document.fonts.ready` and every `<img>` decode (failed images hidden), renders with `toBlob(el, { pixelRatio: 1, cacheBust: true })`, shares via `navigator.share({ files })` when `navigator.canShare` accepts the file, else downloads. `AbortError` → `"cancelled"`. Other errors throw.

- [ ] `npm install html-to-image` in `frontend/`.
- [ ] Implement. Build passes. Commit.

### Task 4: `/share` page, route, i18n, entry buttons

**Files:** Create `features/share-card/share-card-page.ts`, `core/i18n/share-card.ts`; modify `core/i18n/translations.ts`, `app.routes.ts`, the player page template, `features/compare/player-compare` template.

- Loads `getPlayer` + `getPlayerGames` for each id in `?player=` or `?a=&b=`; shows a skeleton while loading and a plain error with a back link on failure.
- Controls per spec "The maker page"; preview scales the 1080 px card with `transform: scale(columnWidth / 1080)` inside a box of the scaled height.
- Share button calls `exportCard`; shows "Creating image…" while busy and the error + Try again on failure.
- i18n keys `shareCard.*` (title, period labels, picker labels, size labels, share/creating/error/retry, makeCard, shareComparison, noGames, pickStats hint).

- [ ] Implement page + i18n + route + buttons.
- [ ] Logic check + `ng build` + backend type-check pass. Commit.

### Task 5: Dev deploy

- [ ] Fast-forward `dev`, push, `railway up --environment dev`, confirm the served bundle contains `app-kit-card`. Ask the user to share a real card from a phone.
