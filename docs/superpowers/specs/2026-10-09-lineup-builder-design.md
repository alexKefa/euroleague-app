# Lineup Builder — Design

Date: 2026-10-09
Status: approved in conversation, awaiting spec review

## Goal

Let fans pick any 2–5 players from a team and see how that group has done
**together** this season, how the team does **otherwise**, and which teammate
makes the group best, so they can explore and build lineups step by step.

It extends the team page's existing analytics section (`features/team/
team-analytics.*`, `GET /teams/:id/analytics`), which already shows the most-used
5-man lineups and per-player on/off. It does not replace either card.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Placement | New "Lineup builder" card in the team analytics section, under "Most-used lineups" |
| Season | Current season (`getCurrentSeason()`), optional `?season=` like `/analytics` |
| Selection | 2–5 players; pool = everyone with lineup minutes for this team this season (incl. departed) |
| Output | Group numbers (B) + best partners (B) + "otherwise" comparison (C) |
| Small sample | Under 20 min together → note, numbers dimmed but shown |
| Partner minimum | ≥ 10 min (600 s) with the group, top 5 by net rating |
| Schema | No changes |
| Out of scope | Opponent filters, date ranges, two-group comparison, league-wide leaderboard |

## Behaviour

### Picking players
- **Pool:** the players in the existing analytics response's `onOff` list
  (everyone with on-court seconds for this team this season), sorted by
  `secondsOn` descending. Each chip shows photo and short name
  (`formatPlayerName`).
- Tapping a chip toggles it. A sixth pick is refused with no change; the
  other chips render disabled while 5 are picked. A counter shows "n / 5".
- "Clear" resets the selection.
- Each row in the existing "Most-used lineups" card gets an "Open in builder"
  action that loads that five, then scrolls the builder card into view.

### Group result (2+ picked)
- **Headline:** net rating per 100 possessions in `font-display`, labelled
  "Together", with the comparison line "otherwise {net}". Otherwise = the
  team's stints this season where the group is **not** all on court.
- **Grid:** minutes, games, points for–against (± diff), ORtg, DRtg, pace.
  - ORtg = 100 · ptsFor / possFor
  - DRtg = 100 · ptsAgainst / possAgainst
  - Net = ORtg − DRtg
  - Pace = (possFor + possAgainst) / 2 per 40 minutes = `((possFor + possAgainst) / 2) / (seconds / 2400)`
  - Any ratio with a zero denominator renders "—".
- **Small sample:** together `< 1200` s (20 min) → note "Small sample (under
  20 min together)"; the headline and grid render at reduced opacity.
- **Never together:** together seconds = 0 → "Never on court together"
  replaces headline and grid; the partner list is hidden.

### Best partners (2–4 picked, together > 0)
- Up to 5 teammates not in the selection. For each one, the stats of the
  group **plus** that player (stints containing all of them), with
  ≥ 600 s together, ordered by net rating desc, then seconds desc.
- Row: photo, name, minutes, net rating, "+" add button; tapping the row
  adds the player.
- Empty list → "No teammate has 10+ minutes with this group".

## Backend

### Service: `backend/src/services/lineupBuilder.ts`

```ts
export interface LineupSums { seconds: number; games: number; ptsFor: number; ptsAgainst: number; possFor: number; possAgainst: number }
export interface LineupPartner extends LineupSums { player: { id: string | null; code: string; name: string | null; photoUrl: string | null } }
export interface LineupBuilderResult { season: string; together: LineupSums; otherwise: LineupSums; partners: LineupPartner[] }

export function normalizePlayerCodes(raw: string): string[] | null; // split on ",", trim, dedupe, sort; null unless 2–5 codes matching /^[A-Z0-9]{1,20}$/i
export function getLineupBuilder(teamId: string, season: string, codes: string[]): Promise<LineupBuilderResult>;
```

**One statement:**
- Same `stints` CTE as `teamAnalytics.ts`: per-stint `poss_for`/`poss_against` =
  `fga − oreb + tov + 0.44·fta`, filtered `team_id = $team and season = $season`.
- `grp` = stints where `player_codes @> $codes::text[]`.
- `together` = sums over `grp` (`count(distinct game_id)` for games).
- `otherwise` = team totals − `together`. `games` here = distinct games among
  the stints **not** in `grp`.
- `partners` = `grp` cross join `unnest(player_codes) c`, where `c <> all($codes)`,
  grouped by `c`, `having sum(seconds) >= 600`, ordered by
  `100 * (sum(pts_for) / nullif(sum(poss_for), 0) - sum(pts_against) / nullif(sum(poss_against), 0)) desc nulls last, sum(seconds) desc`,
  limit 5. Player identity comes from a left join `players` on `code`.
- Constants: `PARTNER_MIN_SECONDS = 600`, `PARTNER_LIMIT = 5`.

### Route (`backend/src/routes/teams.ts`)

`GET /api/teams/:id/lineup?players=<codes>[&season=]`:
- `normalizePlayerCodes(players)`; null → 400 `{ error: "Pick 2 to 5 players" }`.
- season = `?season=` or `getCurrentSeason()`; none → 404 (same as `/analytics`).
- Cached via `cached(\`${CACHE_KEYS.lineup}${teamId}:${season}:${codes.join(",")}\`, 10 * 60_000, …)`.
- Errors: `console.error("GET /api/teams/:id/lineup failed:", err)` → 500
  `{ error: "Failed to load lineup" }`.

### Cache (`services/responseCache.ts`)

Add `CACHE_KEYS.lineup = "lineup:"`. `backend/src/index.ts`: after
`syncMissingGameExtras()` writes stints, call `invalidate(CACHE_KEYS.lineup)`
(in the same `.finally` style as the other jobs).

### Existing analytics tweak (`services/teamAnalytics.ts`)

Add `photoUrl` (`p.photo_url`) to the `AnalyticsPlayer` JSON the analytics
query builds, and to the `AnalyticsPlayer` type on both backend and frontend
(nullable). This is a one-field addition so pool chips and partner rows can
show photos; existing cards ignore it.

## Frontend

- **Models/API:** `LineupSums`, `LineupPartner`, `LineupBuilderResult`
  mirrored in `core/models.ts`; `AnalyticsPlayer.photoUrl?: string | null`.
  `ApiService.getTeamLineup(teamId: string, codes: string[]): Observable<LineupBuilderResult>`
  → `GET /teams/:id/lineup` with `params: { players: codes.join(",") }`.
- **Shared maths:** move `netRating` out of `team-analytics.ts` into
  `features/team/lineup-math.ts` (exported `netRating`, `offRating`,
  `defRating`, `pace`), and use it from both `team-analytics.ts` and the builder.
- **Component:** `features/team/lineup-builder.ts` (standalone), selector
  `app-lineup-builder`.
  - Inputs: `teamId: string`, `pool: AnalyticsPlayer[]` (sorted by the parent),
    `teamColor: string | null`.
  - Public method `load(codes: string[])` used by "Open in builder".
  - Selection is a signal. Fetching uses `toObservable(selection)` +
    `switchMap`, so only the latest selection's response is shown; with
    fewer than 2 picks, nothing is fetched.
  - While loading, the previous result stays, dimmed.
  - On error: "Couldn't load this lineup" + `appButton="outline"
    appButtonSize="sm"` retry.
- **Placement:** `team-analytics.html`, directly after the "Most-used
  lineups" card; that card's rows gain the "Open in builder" action
  (`viewChild` reference to the builder).
- **Layout:** must fit 360px; chips wrap; grid is 3 columns on phones.

## i18n

New keys in `core/i18n/team-analytics.ts` (`ta.*`), EN + EL in the same edit:
- `ta.builderTitle`, `ta.builderHint`, `ta.pickCount` ("{n} / 5"),
  `ta.clear`
- `ta.together`, `ta.otherwise`, `ta.ortg`, `ta.drtg`, `ta.pace`, `ta.pts`
- `ta.smallSample`, `ta.neverTogether`, `ta.bestPartners`, `ta.noPartners`
- `ta.openInBuilder`, `ta.lineupError`, `ta.retry`
- `ta.pickMore` ("Pick at least 2 players")

Reuse `ta.min`, `ta.gp`, `ta.net`, `ta.diff`.

## Verification

There is no test suite. Checks:

1. **`backend/src/scripts/check-lineup-builder.ts`** (node:assert, same
   style as `check-matchup-preview.ts`):
   - `normalizePlayerCodes`: trims, sorts and dedupes, and preserves case
     (codes are compared exactly as stored, e.g. `"011212"`).
     `" 2 , 1 "` → `["1","2"]`; `"1,1,2"` → `["1","2"]`; rejects 0/1/6
     codes, empty segments and characters outside `[A-Za-z0-9]`.
   - `lineup-math` equivalents: net/ORtg/DRtg null on zero possessions;
     pace on a known stint.
2. **Local backend on the dev DB, with `curl`:**
   - A frequent pair: `together.seconds > 0`, and together + otherwise
     equal the team's totals (seconds, ptsFor).
   - A five from the existing "Most-used lineups" card: `together.seconds`
     equals that card's seconds for that lineup.
   - Two players who never shared the floor: `together.seconds === 0`,
     `partners: []`.
   - 1 code or 6 codes → 400.
   - Reordered codes → same response (same cache key).
3. Backend `npx tsc -p tsconfig.json --noEmit`; frontend `npx ng build`.
4. Ship to dev; the user checks on phone and desktop before production.
