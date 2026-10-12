# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type part of a player, team, game or referee name from anywhere in the app and jump to its page; Greek input finds Latin names.

**Architecture:**
- **Backend:** one cached public endpoint returns a small index.
- **Matching:** a pure, Angular-free matcher (`shared/search-match.ts`), checked by a tsx script.
- **UI:** a standalone dialog, opened from the top bar or rail and with `/` on desktop.

**Tech Stack:** Express 4 + Drizzle (postgres-js); Angular 20 standalone + signals; hand-rolled i18n.

**Spec:** `docs/superpowers/specs/2026-10-12-global-search-design.md`

## Global Constraints

- **Scope:** players, teams, current-season games, referees.
- **Limits:** at most 5 results per kind and 12 in total.
- **Endpoint:** `GET /api/search/index`, public, cached 10 min under the `responseCache` key `search:index`.
- **Greek → Latin table:**
  - letters: α→a, β→v, γ→g, δ→d, ε→e, ζ→z, η→i, θ→th, ι→i, κ→k, λ→l, μ→m, ν→n, ξ→x, ο→o, π→p, ρ→r, σ/ς→s, τ→t, υ→y, φ→f, χ→ch, ψ→ps, ω→o
  - digraphs, applied first: ου→ou, αι→ai, ει→ei, οι→oi; at the start of a word only: μπ→b, ντ→d, γκ→g
- **Normalizing:** lowercase, strip diacritics (NFD, then remove `\p{M}`), transliterate, then a loose form that folds v→b, y→i, ou→u, k→c, x→ks.
- **Matching:** every query word must prefix-match some word of the candidate.
- **No 5th mobile bottom tab** (CLAUDE.md). Every new string goes in EN and EL.
- Recent searches live in `localStorage` key `clutch-recent-search` (last 5, per device).

## Review Focus

1. **A one-letter query** shows grouped results, but no more than 12; an empty query shows recent searches, never the whole index. Task 1 test: `search(idx, "a").length <= 12` and `search(idx, "")` returns `[]`.
2. **Greek final sigma and tonos** ("Παπαπέτρου", "Σλούκας"): the accented letter and ς normalize like σ. Task 1 test.
3. **A player who has moved clubs** shows his current team code, from `players.team_id` after the daily roster sync. Task 2 checks the response field.
4. **A search opened before the index finishes loading** shows a spinner row, not "No results". Task 3 builds this state as `loading`.
5. **The `/` shortcut** must not fire while typing in an input or textarea, such as the delete-confirm field. Task 3: the handler ignores events whose target is `INPUT`, `TEXTAREA` or contenteditable.

---

### Task 1: Pure matcher with checks

**Files:**
- Create: `frontend/src/app/shared/search-match.ts` (no Angular imports)
- Test: `backend/src/scripts/check-search-match.ts` (imports `../../../frontend/src/app/shared/search-match.ts` by relative path)

**Interfaces:**
- Produces:
  ```ts
  export type SearchKind = "player" | "team" | "game" | "referee";
  export interface SearchIndex { /* exactly the spec's SearchIndex */ }
  export interface SearchResult { kind: SearchKind; id: string; title: string; subtitle: string; imageUrl: string | null; route: string[] }
  export function normalize(s: string): string;          // strict form
  export function loose(s: string): string;              // strict + v→b, y→i, ou→u, k→c, x→ks
  export function search(index: SearchIndex, query: string, now?: Date): SearchResult[];
  ```
  - Routes: `["/players", id]`, `["/teams", id]`, `["/games", id]`, `["/referees", id]`.
  - Titles: "First Last" for players and referees, the name for teams, `"HOME – AWAY"` for games.
  - Subtitles: the team code for players; the round and date, with the score when final, for games.

- [ ] **Step 1: Write the check script.** It uses a hand-made index containing SLOUKAS, KOSTAS (PAN); VEZENKOV, SASHA (OLY); PAPAPETROU, IOANNIS (PAN); teams PAN and OLY; a game PAN–ULK; and the referee "LAMONICA, ROBERT".
  ```ts
  assert.equal(normalize("Σλούκας"), "sloukas");
  assert.equal(normalize("Παπαπέτρου"), "papapetrou");
  assert.equal(normalize("ÉLAN Chalon"), "elan chalon");
  assert.ok(search(idx, "Σλούκας").some((r) => r.title === "Kostas Sloukas"));
  assert.ok(search(idx, "βεζένκοφ").some((r) => r.title === "Sasha Vezenkov"));
  assert.ok(search(idx, "vezenkov").some((r) => r.title === "Sasha Vezenkov"));
  assert.equal(search(idx, "pan ulk")[0].kind, "game");
  assert.ok(search(idx, "kos slou").length >= 1);            // every word prefix-matches
  assert.deepEqual(search(idx, ""), []);
  assert.ok(search(bigIdx, "a").length <= 12);                // bigIdx: 40 players named A…
  assert.ok(search(bigIdx, "a").filter((r) => r.kind === "player").length <= 5);
  ```
- [ ] **Step 2:** `cd backend && npx tsx src/scripts/check-search-match.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Score per candidate: an exact word match beats a prefix match; active players beat inactive; then kind order team > player > game > referee. For games, upcoming ones (by `tipoffAt` against `now`) sort soonest first and finished ones newest first. Turn "SURNAME, FIRST" into "First Last" with the same rule as `shared/player-name.ts` `formatPlayerName`.
- [ ] **Step 4:** Re-run. Expected: `all search-match checks passed`.
- [ ] **Step 5:** Commit: `Search: pure matcher with Greek transliteration`.

### Task 2: Index endpoint

**Files:**
- Create: `backend/src/routes/search.ts`
- Modify: `backend/src/index.ts` (mount `app.use("/api/search", searchRouter)`), and add `invalidate("search:index")` to the roster-sync and schedule-sync callbacks

**Interfaces:**
- Consumes: the `SearchIndex` shape from Task 1, matched field for field.
- Produces: `GET /api/search/index` → `SearchIndex`. It's one SQL statement made of `json_agg` subqueries, wrapped in `cached("search:index", 10 * 60_000, ...)`. Games are the current season only (`getCurrentSeason()`). Players include the inactive ones (`active` flag), with the team code from `players.team_id`.

- [ ] **Step 1:** With the dev server running, `curl -s localhost:4000/api/search/index` returns 404. That's the RED.
- [ ] **Step 2:** Implement the route and mount it.
- [ ] **Step 3:** `curl` again. Expected: 200 with four arrays; `players.length` ≥ 300 on dev; every game's `season` equals the current season; Santos's entry (code 013289) has `teamCode: "BAS"`. Time two calls back to back: the second answers in under 50 ms.
- [ ] **Step 4:** `tsc`, then commit: `Search: cached index endpoint`.

### Task 3: Search dialog, entry points, i18n

**Files:**
- Create: `frontend/src/app/core/search.service.ts`, `frontend/src/app/shared/search-dialog.ts`, `frontend/src/app/core/i18n/search.ts`
- Modify: `frontend/src/app/core/i18n/translations.ts` (merge the dictionary), `frontend/src/app/app.component.html` and `app.component.ts` (an icon button in the mobile top bar next to the profile/bell, an icon in the desktop rail header, the dialog host, and the `/` key handler)

**Interfaces:**
- Consumes: `search()` and types from Task 1, and `GET /api/search/index` from Task 2.
- Produces:
  - `SearchService`: `open = signal(false)`, `loading = signal(false)`, `index = signal<SearchIndex | null>(null)`, `show()` (loads the index on first call), `recent(): SearchResult[]`, `remember(r: SearchResult)`
  - `<app-search-dialog>`: rendered when `search.open()` is true

- [ ] **Step 1: i18n.** Keys with this exact EN copy, and EL in the same edit:

  | Key | EN |
  |---|---|
  | `search.placeholder` | Search players, teams, games, referees |
  | `search.players` | Players |
  | `search.teams` | Teams |
  | `search.games` | Games |
  | `search.referees` | Referees |
  | `search.recent` | Recent |
  | `search.none` | No results for "{q}" |
  | `search.open` | Search |
  | `search.loading` | Loading… |

- [ ] **Step 2: Service and dialog.**
  - **Layout:** full screen below `sm`, a centred 560 px panel from `sm` up, using the `app-dialog`-style backdrop.
  - **Input:** focused on open.
  - **Results:** grouped under the kind headings, at most 12 rows.
  - **Keys:** arrow keys move the highlighted row, Enter opens it, Esc closes.
  - **On select:** `remember()`, close, then `router.navigate(route)`.
  - **States:** while `loading()` and there's no index yet, a single `search.loading` row. An empty query shows `recent()` under `search.recent`.
- [ ] **Step 3: Entry points.**
  - The search icon button (aria-label `search.open`) goes in the mobile top bar and the desktop rail header.
  - Add a `document:keydown` handler for `/`. It ignores the key when the target is INPUT, TEXTAREA or contenteditable, and when the dialog is already open.
- [ ] **Step 4:** `cd frontend && npx ng build --configuration development`. Expected: complete, with no errors.
- [ ] **Step 5:** Commit: `Search: dialog, top bar and rail entry points, EN + EL`.
