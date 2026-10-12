# Global Search — Design

Date: 2026-10-12
Status: awaiting review

## Goal

Find any player, team, game or referee from anywhere in the app by typing
part of a name, and jump to its page. Today the only route to a player is
Teams → team → roster → player, or scrolling a stats list.

## Decisions

| Topic | Decision |
|---|---|
| Finds | Players, teams, games (current season), referees (chosen 2026-10-12) |
| Where it runs | **In the browser**, over a small index fetched once. The production corpus is tiny (476 players, 21 teams, 71 referees, 380 games), so typing is instant and costs no DB round trip per key. |
| Greek | A Greek query matches Latin feed names through transliteration, so "Σλούκας" finds SLOUKAS, KOSTAS. Accents and case are ignored in both scripts. |
| Entry point | A search button in the desktop rail and the mobile top bar. Not a 5th bottom tab (CLAUDE.md). |
| Schema | None |

## Backend

`GET /api/search/index`: public and cached in memory for 10 minutes (the
existing `responseCache`, new key `search:index`). Returns:

```ts
interface SearchIndex {
  players: { id: string; name: string; teamCode: string | null; photoUrl: string | null; active: boolean }[];
  teams: { id: string; code: string; name: string; logoUrl: string | null }[];
  referees: { id: string; name: string }[];
  games: { id: string; season: string; round: number | null; tipoffAt: string; status: string;
           home: { code: string; name: string }; away: { code: string; name: string };
           homeScore: number | null; awayScore: number | null }[]; // current season only
}
```

- It's one statement (json subqueries). Player names come in the feed's "SURNAME, FIRST" form.
- The roster sync and the schedule sync drop `search:index` when they change something, so transfers show up.

## Frontend

### `core/search.service.ts`
- `index`: loads `/api/search/index` lazily on first open, then keeps it for the session.
- `normalize(s)`:
  1. lowercase
  2. strip diacritics (NFD, remove combining marks)
  3. transliterate Greek to Latin with a fixed table: α→a, β→v, γ→g, δ→d, ε→e, ζ→z, η→i, θ→th, ι→i, κ→k, λ→l, μ→m, ν→n, ξ→x, ο→o, π→p, ρ→r, σ/ς→s, τ→t, υ→y, φ→f, χ→ch, ψ→ps, ω→o
  4. digraphs first: ου→ou, μπ→b at the start of a word, ντ→d at the start of a word, γκ→g at the start of a word, αι→ai, ει→ei, οι→oi
  5. a loose form that also folds v→b and y→i, so "Σλούκας" (sloukas) and "Βεζένκοφ" (vezenkof vs VEZENKOV) still match
- `search(q): SearchResult[]`:
  - Each query word must prefix-match some word of the candidate (name parts, team code, and team name for games).
  - Score order: exact word match, then prefix, then active over inactive players, then teams over players over games over referees.
  - At most 5 per kind, 12 in total.
  - Games: "pan fen" matches either team's code or name. Upcoming games are sorted soonest first, finished games newest first, and the score is shown when final.

### `shared/search-dialog.ts`
- Opens over the page: full screen on phones, a centred panel on desktop. The input is focused on open.
- Results are grouped under Players / Teams / Games / Referees. Each row shows the photo or logo, the name and a subtitle (team code; round and date; score).
- Keys: arrow up/down, Enter opens, Esc closes.
- On phones the dialog is the whole screen, so the keyboard never covers results.
- An empty query shows the 5 most recent picks (`localStorage` `clutch-recent-search`, per device).
- No match: "No results for '{q}'".
- Player names are shown as "First Last" with the existing `formatPlayerName`.

### Entry points
- A search icon in the desktop rail header and in the mobile top bar next to notifications.
- `/` opens it on desktop, unless focus is in an input.

### i18n
New `core/i18n/search.ts` (EN + EL): placeholder, the four group titles, no results, recent, open hint.

## Verification

1. There is no frontend test runner, so put the pure `normalize`/`match` functions in `shared/search-match.ts` with no Angular imports, and check them with a backend-style tsx script `backend/src/scripts/check-search-match.ts` that imports the frontend file by relative path. Assertions:
   - "Σλούκας" matches "SLOUKAS, KOSTAS"
   - "vezenkov" and "βεζένκοφ" both match "VEZENKOV, SASHA"
   - "pan fen" matches the PAN–ULK game, and "pao" doesn't break anything
   - accents and case are ignored
   - limits are 5 per kind and 12 in total
2. `curl /api/search/index` on dev returns all four lists, and a second call is served from the cache.
3. `ng build`, then the user checks on dev.

## Out of scope

Searching news, users or cards; server-side search; fuzzy typo tolerance beyond the loose form.
