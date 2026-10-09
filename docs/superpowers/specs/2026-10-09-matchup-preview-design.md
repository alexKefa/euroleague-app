# Matchup Preview — Design

Date: 2026-10-09
Status: approved in conversation, awaiting spec review

## Goal

Give users a pre-game matchup preview that helps them make their win/loss and
top-scorer picks: recent form, head-to-head, availability, and where each team
has the edge. It lives in two places:

- **Full preview** on the game page (`/games/:id`), shown only before tipoff.
- **Compact strip** in Predictions (pick list and Quick pick deck), linking to
  the full preview.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Placement | Game page before tipoff (full) + compact strip in Predictions |
| Full sections | Form + head-to-head, Availability, Key matchups |
| Excluded | Odds, referee crew |
| Compact content | Last-5 form dots, H2H record, injury count badge, "Full preview ›" link |
| Approach | Two new read endpoints, computed on read, cached via `responseCache.ts` |
| Schema | No changes |

Existing pre-game cards (win probability, Players to watch, Team comparison)
stay as they are.

## Content

### 1. Form + head-to-head

- **Form:** each team's last 5 final games of the current season
  (`getCurrentSeason()`), newest first: result (W/L), opponent (logo/code),
  score, home/away. Plus the current streak (e.g. `W3`, `L1`) counted over all
  of the team's final games this season, not just the 5 shown.
- **Head-to-head:** up to the last 5 final meetings between the two teams
  across the seasons returned by `getRecentSeasons(2)` (`services/refereeStats.ts`,
  the same two-season window `restSplits.ts` uses): date, score, winner. A summary record from the
  home team's perspective is rendered as "PAN leads 3-1" / "Series tied 2-2".
- **No meetings:** "First meeting in two seasons".
- **Fewer than 5 games:** show what exists; zero games this season shows
  "No games yet this season".

### 2. Availability

- Per team: every player on the current roster (`players.teamId`) with a
  `player_injuries` row, showing photo, name, and status (out / doubtful /
  questionable / probable), sorted by severity (out first). The API returns
  both `note` and `noteEl`; the frontend picks the viewer's language with
  `injuryNoteFor` (`shared/injury-status.ts`).
- **Short rest:** rest days = calendar days (Europe/Athens) between the
  team's previous final game this season and this game's tipoff. Short rest
  is `<= SHORT_REST_MAX_DAYS` (exported from `restSplits.ts`, currently 2).
  - Only one team on short rest: banner "<rested team> has the rest edge
    (<tired team> played <n> days ago)".
  - Both on short rest: "Both teams on short rest".
  - A team with no previous game this season has no rest value and never
    counts as short rest.
- **Neither injuries nor short rest:** "Both teams at full strength".

### 3. Key matchups

- **Edge bars** (6). Each bar shows both values and fills the better side in
  that team's color:
  - Offensive rating: `team_season_stats.off_rating`, higher is better.
  - Defensive rating: `team_season_stats.def_rating`, lower is better.
  - 3PT%: summed `field_goals_made_3 / field_goals_attempted_3` over the
    team's final games this season, higher is better.
  - Rebounds / game, Assists / game: higher is better.
  - Turnovers / game: lower is better.
  - Per-game box-score values come from `player_game_stats` summed per game
    per team, then averaged over the team's final games. A player's team for
    a game uses the same rule as `refereeStats.ts`/`restSplits.ts`:
    `player_season_stats` team, falling back to the current team.
  - Equal values are drawn as neutral, with no fill.
- **Early-season fallback:** a team with fewer than 3 final games this
  season uses the previous season's values for *all* edge bars, and the card
  shows a "last season" tag. Both teams use the same season so the bars stay
  comparable: if either team needs the fallback, both use the previous
  season.
- **Key battle:** each team's top player by average PIR (`valuation`) over
  the stats season used above (min. 2 games), restricted to the position
  where both teams' top players are strongest. Rule: for each position
  (Guard/Forward/Center), take each team's best-PIR player at that position,
  then pick the position with the highest combined PIR. Shown as a duel:
  photo, name, and PTS / REB / AST / PIR per game, with the better value of
  each stat highlighted. Players who are `out` are excluded. If no position
  has an eligible player on both sides, the duel is omitted.

### Compact strip (Predictions)

Per game, one row per team:

```
PAN  ● ● ○ ● ●   H2H 3-1   🩹2
OLY  ● ○ ● ● ○             🩹0
            Full preview ›
```

- 5 form dots, newest last (filled = W, hollow = L, team-colored); fewer
  dots if fewer games.
- H2H record shown once, on the leading team's row ("H2H 2-2" on the home
  row when tied); hidden when there are no meetings.
- Injury badge counts players with status out or doubtful only.
- "Full preview ›" → `/games/:id`.

## Backend

### Service: `backend/src/services/matchupPreview.ts`

```ts
export interface FormGame { gameId: string; tipoffAt: string; opponent: TeamRef; isHome: boolean; teamScore: number; opponentScore: number; won: boolean }
export interface H2HGame { gameId: string; tipoffAt: string; homeTeamId: string; homeScore: number; awayScore: number; winnerTeamId: string }
export interface InjuredPlayer { playerId: string; name: string; photoUrl: string | null; status: InjuryStatus; note: string | null; noteEl: string | null }
export interface EdgeRow { key: "offRating" | "defRating" | "threePct" | "rebPg" | "astPg" | "tovPg"; home: number | null; away: number | null; better: "home" | "away" | "even" | null }
export interface DuelPlayer { playerId: string; name: string; photoUrl: string | null; position: string; games: number; pts: number; reb: number; ast: number; pir: number }

export interface MatchupPreview {
  available: true;
  statsSeason: string;          // season the edge bars + key battle use
  usingPriorSeason: boolean;
  form: { home: TeamForm; away: TeamForm };   // TeamForm = { games: FormGame[]; streak: string | null }
  h2h: { games: H2HGame[]; homeWins: number; awayWins: number };
  availability: {
    home: { injured: InjuredPlayer[]; restDays: number | null; shortRest: boolean };
    away: { injured: InjuredPlayer[]; restDays: number | null; shortRest: boolean };
  };
  edges: EdgeRow[];
  keyBattle: { position: string; home: DuelPlayer; away: DuelPlayer } | null;
}

export interface PreviewStrip {
  home: { form: ("W" | "L")[]; injuries: number };
  away: { form: ("W" | "L")[]; injuries: number };
  h2h: { homeWins: number; awayWins: number } | null;
}

export function getMatchupPreview(gameId: string): Promise<MatchupPreview | { available: false } | null>; // null = unknown game
export function getRoundPreviewStrips(season: string, round: number): Promise<Record<string, PreviewStrip>>;
```

Form, H2H, and injury-count logic is a shared internal core that both
functions call, so the strip is always a strict subset of the full preview.

### Query budget

Per CLAUDE.md, latency comes from DB round trips. `Promise.all` gives no real
concurrency against Neon, so the goal is fewer statements.

- **`getMatchupPreview`: ~4 statements.**
  1. Load the game (teams, status, tipoff).
  2. One query for both teams' final games across the recent-seasons window.
     It feeds form, streak, H2H, and rest days, all derived in JS.
  3. One query for injured players on both rosters.
  4. One query for the edge-bar and key-battle data: `team_season_stats` for
     both teams and both candidate seasons, plus per-team per-game box-score
     sums and per-player season averages from `player_game_stats`, combined
     with subqueries/CTEs.
- **`getRoundPreviewStrips`: 2 statements for the whole round.**
  1. The round's upcoming games joined with all recent final games for every
     team in the round.
  2. Out/doubtful injury counts grouped by team.

### Routes (`backend/src/routes/games.ts`)

- `GET /api/games/previews?season=&round=` returns
  `Record<gameId, PreviewStrip>` for the round's games that haven't tipped
  off (status `scheduled`, tipoff in the future). Returns 400 on a missing or
  invalid round. **This route is registered before `/:id`.**
- `GET /api/games/:id/preview` returns `MatchupPreview` while the game is
  upcoming, `{ available: false }` once it is live/final, and 404 for an
  unknown id.
- Both are public (no auth), like the rest of the games router.

### Caching (`services/responseCache.ts`)

- Add `CACHE_KEYS.preview = "preview:"`. Keys are `preview:game:<id>` and
  `preview:round:<season>:<round>`, with a 10-minute TTL.
- Invalidation:
  - `routes/injuries.ts`: add `CACHE_KEYS.preview` to its existing
    `invalidateOnWrite(...)`.
  - `index.ts`: add `invalidate(CACHE_KEYS.preview)` to the background job
    chains that finalize games / sync box scores and that sync injuries,
    next to the existing `invalidate(...)` calls.
- `{ available: false }` and 404 are not cached, so a game flipping to live
  is reflected immediately.

### Errors

Service errors are logged (`console.error("GET /api/games/:id/preview
failed:", err)`) and return 500 `{ error }`, matching the router's existing
style.

## Frontend

### Models + API (`core/models.ts`, `core/api.service.ts`)

- Add types mirroring `MatchupPreview` and `PreviewStrip`.
- `getMatchupPreview(gameId)` and `getRoundPreviewStrips(season, round)`.

### Game page: `features/game/matchup-preview.ts` (new standalone component)

- Same pattern as `win-prob-card.ts`: input `gameId`, fetches its own data,
  and renders nothing on error or `available: false`.
- Placed in `game-detail.html` right after the win-probability card, only
  when the game is scheduled.
- One card with the app's `card-head` style (icon + title), three blocks:
  1. **Form & head-to-head:** two rows of W/L chips (team color for W,
     muted for L; opponent logo and score in the chip title / on tap),
     streak badge at row end, then the H2H summary line and the meetings
     list (date, score, winner bold).
  2. **Availability:** two columns (stacked under `sm:`), each a team header
     plus injured-player rows (photo, name, status pill using the existing
     injury status colors and `injuries.status*` keys, localized note).
     The short-rest banner sits above the columns.
  3. **Key matchups:** 6 edge bars (label in the middle, values on both ends,
     the better side filled in its team color via `--team-*`-style inline
     colors from `homeTeam/awayTeam.primaryColor`), the "last season" tag
     when `usingPriorSeason`, then the key-battle duel.
- Loading shows a skeleton block with the card's height; error hides the
  card.
- Mobile-first: everything fits 360px width with no horizontal scroll.

### Predictions: `shared/matchup-strip.ts` (new, presentational)

- Inputs: `strip: PreviewStrip`, `home`, `away` (team refs for
  code/color), `gameId`. Pure display, no fetching.
- `predictions.ts` fetches `getRoundPreviewStrips(season, round)` once per
  loaded round, alongside the existing pregame win-prob request, and
  stores it in a `previewStrips` signal.
- **Pick list (`predictions.html`):** the strip renders in each upcoming
  game card below the win-probability line and above the community split.
- **Quick pick deck (`swipe-deck.ts`):** new `previews` input (like `probs`);
  the strip renders on the card face. The "Full preview ›" link must not
  trigger a swipe (stop pointer propagation on the link).
- A missing strip for a game (fetch failed / not returned) renders nothing.

### i18n: `core/i18n/matchup.ts` (new), merged in `translations.ts`

EN + EL together for: section titles (Matchup preview, Form & head-to-head,
Availability, Key matchups, Key battle), streak format, H2H summaries
("{team} leads {a}-{b}", "Series tied {a}-{b}", "First meeting in two
seasons", "No games yet this season"), rest texts ("{team} has the rest
edge", "played {n} days ago", "Both teams on short rest"), "Both teams at
full strength", the 6 stat labels, "last season", "Full preview", "H2H".
Fonts are unchanged (Sofia Sans covers Greek).

## Verification

There is no test suite. Checks:

1. `cd backend && npx tsc -p tsconfig.json --noEmit` and `cd frontend && npx
   ng build`.
2. Against a local/dev backend, `curl` both endpoints for an upcoming game
   and check:
   - the response shape;
   - a team pair with no recent meetings (H2H empty, summary text path);
   - an early-season team (prior-season fallback flag).
3. Edit an injury via the admin Injury Report, then confirm the preview
   reflects it immediately (cache invalidation).
4. Confirm `/:id/preview` for a final game returns `{ available: false }`.
5. Per CLAUDE.md: no browser automation. Describe the changes and ask the
   user for screenshots of the game page and Predictions (phone + desktop).

## Out of scope

Odds, referee crew, new tables, new sync jobs, a standalone "compare any two
teams" tool, push notifications for previews.
