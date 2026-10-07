# Dashboard Round Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 11-block `/dashboard` with a round header and a checklist of what is still open this round (game picks, top scorer, fantasy squad, Jump Ball), followed by the next game, Live Center, sponsor ticker and one compact league block.

**Architecture:** All round logic lives in one pure function (`buildRoundStatus`) with no Angular imports, so it can be checked with a plain Node script. An Angular service loads the existing endpoints into signals and runs that function every second. Three small presentational components (header, checklist, league block) read from it, and the dashboard template is reordered around them. No backend or schema changes.

**Tech Stack:** Angular 20 standalone components + signals, Tailwind, the hand-rolled `I18nService`. Node `assert` via the backend's `tsx` for the logic check.

**Spec:** `docs/superpowers/specs/2026-10-07-dashboard-round-checklist-design.md`

## Global Constraints

- Every new string gets EN and EL in the same edit, in `frontend/src/app/core/i18n/dashboard.ts`.
- Text on `bg-team-primary` uses `text-team-secondary`.
- Fonts/weights: `font-display` (Sofia Sans Condensed, 800) only for the header's big numbers; labels 600 (`font-semibold`/`font-bold`), body 400. No uppercase eyebrow labels in new components.
- Buttons use `[appButton]` (`primary` / `outline`, `appButtonSize="sm"`).
- No new backend endpoints; reuse `getSchedule`, `getMyTopScorerPredictions`, `getFantasyLineup`, `getSpinStatus`, `getPredictionHistory`, `EventsService.predictedGameIds()`.
- Season constant stays `"2026-27"` (same hardcoded pattern as `live-center.ts` / `round-strip.ts`).
- Phone nav stays 4 tabs + More; the sponsor ticker markup is kept as is.
- Respect `prefers-reduced-motion` for the countdown pulse and the row tick animation.
- The repo has no test suite and no lint. Verification is the logic check script, `ng build`, the backend type-check and dev deploys.

## Review Focus

1. **Fantasy round lags the schedule round.** `getDefaultRound` keeps the previous fantasy round until its credits land, so `lineup.round` can be N-1 while the schedule is on round N. Expected: the fantasy row is hidden, not shown as done for the wrong round. Covered by check `fantasy row hidden when lineup round differs`.
2. **A game whose tip-off time has passed but whose status is still `scheduled`** (late feed). Expected: it counts as started (missed if unpicked), never as open. Covered by check `past tipoff with scheduled status counts as started`.
3. **Countdown boundaries.** Exactly 24h, under 1 minute, and negative values (deadline just passed between ticks). Expected: `1d 0h`, `0:00:59`, `0:00:00`, with no negative numbers. Covered by the `formatCountdown` checks.
4. **One source fails** (for example spin status 500 or top-scorer list fails). Expected: only that row disappears; progress counts the remaining rows. Covered by check `null sources hide their rows`.
5. **A round with zero games** (schedule between seasons, or the feed is empty). Expected: phase `between`, no rows, `nextDeadline` null; the page must not throw. Covered by check `empty round`.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/app/features/dashboard/round-status.logic.ts` (new) | Pure types + `buildRoundStatus`, `formatCountdown`, `countdownTone`. No Angular imports; type-only imports from `core/models`. |
| `frontend/scripts/check-round-status.ts` (new) | Node `assert` checks for the logic file. Outside `src/`, so `ng build` never sees it. |
| `frontend/src/app/features/dashboard/round-status.service.ts` (new) | Loads the five sources into signals, ticks `now`, exposes `schedule`, `status`, `roundPoints`, `start()`, `stop()`. |
| `frontend/src/app/features/dashboard/round-header.ts` (new) | Team-colour header: per-phase variants, progress bar, countdown, guest CTA. |
| `frontend/src/app/features/dashboard/round-checklist.ts` (new) | Checklist rows, buttons, all-done folded line, first-run highlight. |
| `frontend/src/app/features/dashboard/league-block.ts` (new) | Top news story, top-4 standings, links. |
| `frontend/src/app/features/dashboard/live-center.ts` (modify) | Read the schedule from `RoundStatusService` instead of fetching it. |
| `frontend/src/app/features/dashboard/dashboard.component.{html,ts}` (modify) | New order; remove the round strip, prize banner, economy hint, stats card and unused loads; new skeleton. |
| `frontend/src/app/features/dashboard/round-strip.ts` (delete) | Replaced by the header. |
| `frontend/src/app/core/i18n/dashboard.ts` (modify) | New keys; delete keys only the removed blocks used. |
| `TODO.md` (modify) | Out-of-scope fantasy warnings. |

---

### Task 1: Round status logic

**Files:**
- Create: `frontend/src/app/features/dashboard/round-status.logic.ts`
- Test: `frontend/scripts/check-round-status.ts`

**Interfaces:**
- Consumes: `Schedule`, `Game`, `SpinStatus` types from `frontend/src/app/core/models.ts` (type-only imports).
- Produces (exact names, used by Tasks 2–5):

```ts
export type ChecklistRowId = "picks" | "topScorer" | "fantasy" | "spin";

export interface FantasyInput {
  round: number | null;      // FantasyLineup.round
  hasSquad: boolean;         // lineup.players.length > 0
  lockAt: string | null;     // FantasyLineup.lockAt
  fullTimeoutAvailable: boolean;
  carriedOver: boolean;      // lineup.baselinePlayerIds !== null && lineup.transfersUsed === 0
}

export interface RoundStatusInput {
  schedule: Schedule;
  predictedGameIds: Set<string>;
  topScorerGameIds: Set<string> | null; // null = not loaded / failed -> row hidden
  fantasy: FantasyInput | null;         // null = not loaded / failed -> row hidden
  spin: SpinStatus | null;              // null = not loaded / failed -> row hidden
  everPicked: boolean;                  // any prediction ever, from getPredictionHistory
}

export interface ChecklistRow {
  id: ChecklistRowId;
  done: boolean;
  link: "/predictions" | "/fantasy" | "/wheel";
  deadline: Date | null;                       // only picks (earliest open tipoff) and fantasy (lockAt) set this, and only while open
  count?: { done: number; total: number };     // picks: picked games / all games; topScorer: picks this round / 0
  nextAt?: Date | null;                        // spin: nextEligibleAt
  carriedFromRound?: number | null;            // fantasy: schedule.round - 1 when carriedOver, else null
  fullTimeoutAvailable?: boolean;              // fantasy
  bonus?: boolean;                             // topScorer: true
}

export type RoundPhase = "open" | "allDone" | "between";

export interface RoundStatus {
  round: number;
  phase: RoundPhase;
  rows: ChecklistRow[];
  doneCount: number;
  nextDeadline: { at: Date; kind: "picks" | "fantasy" | "firstGame" } | null;
  firstRun: boolean;
}

export function buildRoundStatus(input: RoundStatusInput, now: number): RoundStatus;
export function formatCountdown(ms: number, units: { d: string; h: string }): string;
export function countdownTone(ms: number): "normal" | "soon" | "urgent";
```

Rules `buildRoundStatus` must follow (from the spec):
- `started(g) = g.status !== "scheduled" || Date.parse(g.tipoffAt) <= now`.
- **picks**: always present when the round has games. Open games are those not started and not in `predictedGameIds`. `done = openGames.length === 0`; `count = { done: games picked (any status), total: games.length }`; `deadline` = earliest open tipoff, or null when done.
- **topScorer**: present only when `topScorerGameIds !== null` and at least one game is not started. `done` = any round game id is in `topScorerGameIds`; `count = { done: that number, total: 0 }`; `bonus: true`; `deadline: null`.
- **fantasy**: present only when `fantasy !== null && fantasy.round !== null && fantasy.round === schedule.round`. `done = hasSquad`; `deadline` = `lockAt` as a Date while open, else null; `carriedFromRound = carriedOver ? schedule.round - 1 : null`.
- **spin**: present only when `spin !== null`. `done = !canSpin`; `nextAt` = `nextEligibleAt` as a Date, or null.
- **Order**: open rows sorted by `deadline` ascending (null last, ties keep the base order picks → topScorer → fantasy → spin), then done rows in base order.
- **phase**: `between` when the round has no games or every game is started; otherwise `allDone` when there is at least one row and every row is done; otherwise `open`. In `between`, `rows` is `[]`.
- **nextDeadline**: the earliest `deadline` among open rows (`kind` = that row's id); otherwise the earliest not-started tipoff as `kind: "firstGame"`; otherwise null.
- `firstRun = !everPicked`.

`formatCountdown`: ms ≤ 0 → `"0:00:00"`; ms ≥ 86 400 000 → `` `${days}${units.d} ${hours}${units.h}` `` (floor); otherwise `H:MM:SS` with unpadded hours. `countdownTone`: < 600 000 → `"urgent"`, < 3 600 000 → `"soon"`, else `"normal"`.

- [ ] **Step 1: Write the check script `frontend/scripts/check-round-status.ts`**

Import from `../src/app/features/dashboard/round-status.logic.ts` and `node:assert/strict`. Build games with a small helper `g(id, tipoffIso, status = "scheduled")` that fills the other `Game` fields with `as unknown as Game`. Fix `now = Date.parse("2026-10-09T15:00:00Z")`. Checks (each a named block that prints `ok <name>`):

```ts
// empty round
const empty = buildRoundStatus({ schedule: { season: "2026-27", round: 3, games: [] }, predictedGameIds: new Set(), topScorerGameIds: new Set(), fantasy: null, spin: null, everPicked: true }, now);
assert.equal(empty.phase, "between"); assert.deepEqual(empty.rows, []); assert.equal(empty.nextDeadline, null);

// picks open: 10 games at 18:15Z, 3 picked -> count 3/10, deadline 18:15Z, nextDeadline kind "picks"
// past tipoff with scheduled status counts as started:
//   game at 14:00Z status "scheduled", unpicked, plus one picked future game -> picks.done === true
// all started -> phase "between", rows []
// fantasy row hidden when lineup round differs: fantasy.round 2, schedule.round 3 -> no row with id "fantasy"
// fantasy carried over: round 3, hasSquad, carriedOver -> done true, carriedFromRound 2, deadline null
// fantasy open: hasSquad false, lockAt 17:00Z, picks open at 18:15Z -> rows[0].id === "fantasy", nextDeadline.kind "fantasy"
// null sources hide their rows: topScorerGameIds null, fantasy null, spin null -> rows.map(r => r.id) deepEqual ["picks"]
// spin: canSpin false, nextEligibleAt "2026-10-10T07:00:00Z" -> done true, nextAt equals that Date
// order: done rows after open rows; allDone phase when picks done + spin done + topScorer done
// allDone nextDeadline: kind "firstGame", at = earliest not-started tipoff
// firstRun: everPicked false -> firstRun true

// formatCountdown
assert.equal(formatCountdown(86_400_000, { d: "d", h: "h" }), "1d 0h");
assert.equal(formatCountdown(2 * 86_400_000 + 4 * 3_600_000 + 59_000, { d: "d", h: "h" }), "2d 4h");
assert.equal(formatCountdown(4 * 3_600_000 + 12 * 60_000 + 9_000, { d: "d", h: "h" }), "4:12:09");
assert.equal(formatCountdown(59_000, { d: "d", h: "h" }), "0:00:59");
assert.equal(formatCountdown(-5_000, { d: "d", h: "h" }), "0:00:00");

// countdownTone
assert.equal(countdownTone(599_999), "urgent"); assert.equal(countdownTone(600_000), "soon");
assert.equal(countdownTone(3_599_999), "soon"); assert.equal(countdownTone(3_600_000), "normal");
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `frontend/`): `../backend/node_modules/.bin/tsx scripts/check-round-status.ts`
Expected: fails with a module-not-found error for `round-status.logic.ts`.

- [ ] **Step 3: Implement `round-status.logic.ts`** with the exports and rules above.

- [ ] **Step 4: Run the check to verify it passes**

Run: `../backend/node_modules/.bin/tsx scripts/check-round-status.ts`
Expected: every block prints `ok …`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/dashboard/round-status.logic.ts frontend/scripts/check-round-status.ts
git commit -m "Dashboard: pure round-status logic with a node check script"
```

---

### Task 2: RoundStatusService, and the Live Center reading its schedule

**Files:**
- Create: `frontend/src/app/features/dashboard/round-status.service.ts`
- Modify: `frontend/src/app/features/dashboard/live-center.ts` (the `getSchedule(SEASON)` call near line 188 and its `schedule` signal)

**Interfaces:**
- Consumes: `buildRoundStatus`, `RoundStatus`, `FantasyInput` (Task 1); `ApiService`, `EventsService`, `AuthService`.
- Produces:

```ts
@Injectable({ providedIn: "root" })
export class RoundStatusService {
  readonly now: Signal<number>;                    // ticks every 1000 ms while started
  readonly schedule: Signal<Schedule | null>;
  readonly scheduleError: Signal<boolean>;
  readonly loading: Signal<boolean>;               // true until the schedule has loaded or failed
  readonly status: Signal<RoundStatus | null>;     // null until the schedule loads
  readonly roundPoints: Signal<number | null>;     // points earned this round, from getPredictionHistory
  start(): void;   // loads all sources, starts the 1 s tick, refreshes on visibilitychange -> visible
  stop(): void;    // clears the interval and the listener
  refresh(): void; // reloads every source
}
```

Notes:
- Personal sources (top scorer, fantasy lineup, spin, prediction history) load only when `auth.isAuthenticated()`. For guests, `status` is built with those set to `null` and `everPicked: true`.
- Each source is its own subscription with its own `error` handler that sets that input to `null`. A failure never touches the others.
- `roundPoints` and `everPicked`: move the existing `roundPoints` computation from `round-strip.ts` (its `getPredictionHistory` use) here unchanged; `everPicked` = the history has any round with a pick.
- `start()` is idempotent: a second call while running does nothing.
- Live Center: remove its own schedule fetch and read `RoundStatusService.schedule()`; its other loads (my predictions, top-scorer picks, polls) stay.

- [ ] **Step 1: Implement the service** per the interface and notes.
- [ ] **Step 2: Point `live-center.ts` at `RoundStatusService.schedule`** and delete its `getSchedule` call.
- [ ] **Step 3: Verify the build**

Run (from `frontend/`): `npx ng build --configuration development`
Expected: `Output location: …dist/euroleague-app-frontend` with no `ERROR` lines.

- [ ] **Step 4: Re-run the logic check** (`../backend/node_modules/.bin/tsx scripts/check-round-status.ts`). Expected: all `ok`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/features/dashboard/round-status.service.ts frontend/src/app/features/dashboard/live-center.ts
git commit -m "Dashboard: RoundStatusService; Live Center reuses its schedule"
```

---

### Task 3: Round header

**Files:**
- Create: `frontend/src/app/features/dashboard/round-header.ts`
- Modify: `frontend/src/app/core/i18n/dashboard.ts`

**Interfaces:**
- Consumes: `RoundStatusService` (`status`, `now`, `roundPoints`, `loading`), `formatCountdown`, `countdownTone` (Task 1), `AuthService`.
- Produces: `<app-round-header [rank]="number | null" />` (selector `app-round-header`; `rank` comes from the dashboard's existing `myRank()`). Projects `<ng-content />` below the header in the `between` phase so the dashboard can place `<app-round-recap />` there.

Per state (spec "States" table):
- **Guest**: "Round {n}", countdown to the first game (`nextDeadline.kind === "firstGame"`), `[appButton]` "Sign up to play" → `/register`.
- **open**: small "Round {n}", big "{done} of {total} done", countdown on the right with a label from `nextDeadline.kind` ("picks lock in" / "fantasy locks in" / "first game in"), progress bar width `doneCount / rows.length`.
- **allDone**: big "Round {n} ready ✓", line "{points} pts so far · #{rank}" (omit parts that are null), countdown labelled "first game in".
- **between**: big "Round {n} complete", line "{points} pts · #{rank}", then `<ng-content />`.
- Countdown classes by `countdownTone`: normal → none, soon → `text-amber-300`, urgent → `text-red-300 animate-pulse motion-reduce:animate-none`. Units for `formatCountdown` come from i18n (`dashboard.roundHeader.unitD` / `unitH`: EN `d`/`h`, EL `μ`/`ώ`).
- Card: `rounded-3xl p-4 bg-team-primary text-team-secondary shadow-card`; big numbers `font-display text-3xl leading-none tabular-nums`; progress track `h-1.5 rounded-full bg-team-secondary/25` with fill `bg-team-secondary`.
- While `loading()`: a skeleton of the same height (`app-skeleton`, `rounded-3xl h-[124px]`).
- When `scheduleError()`: replace the header with a plain card "Couldn't load this round. Pull to refresh or try again." plus a "Try again" `[appButton]="outline"` that calls `refresh()` (keys `dashboard.roundHeader.error` / `.retry`; EL "Δεν φόρτωσε η αγωνιστική. Δοκίμασε ξανά." / "Ξανά"). The checklist renders nothing in this case (its `status()` is null).

i18n keys (add EN + EL): `dashboard.roundHeader.round` ("Round {n}" / "Αγωνιστική {n}"), `.progress` ("{done} of {total} done" / "{done} από {total} έτοιμα"), `.ready` ("Round {n} ready" / "Η αγωνιστική {n} είναι έτοιμη"), `.complete` ("Round {n} complete" / "Η αγωνιστική {n} ολοκληρώθηκε"), `.pointsSoFar` ("{n} pts so far" / "{n} πόντοι ως τώρα"), `.points` ("{n} pts" / "{n} πόντοι"), `.picksLockIn` ("picks lock in" / "οι προβλέψεις κλειδώνουν σε"), `.fantasyLocksIn` ("fantasy locks in" / "το fantasy κλειδώνει σε"), `.firstGameIn` ("first game in" / "πρώτος αγώνας σε"), `.signUp` ("Sign up to play" / "Γράψου για να παίξεις"), `.unitD`, `.unitH`.

- [ ] **Step 1: Add the i18n keys.**
- [ ] **Step 2: Implement `round-header.ts`.**
- [ ] **Step 3: Verify the build** (`npx ng build --configuration development`, no `ERROR`).
- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/features/dashboard/round-header.ts frontend/src/app/core/i18n/dashboard.ts
git commit -m "Dashboard: round header with countdown and per-phase states"
```

---

### Task 4: Round checklist

**Files:**
- Create: `frontend/src/app/features/dashboard/round-checklist.ts`
- Modify: `frontend/src/app/core/i18n/dashboard.ts`

**Interfaces:**
- Consumes: `RoundStatusService.status` and `.now`, `ChecklistRow` (Task 1), `formatCountdown`.
- Produces: `<app-round-checklist />` (selector `app-round-checklist`). Renders nothing when `status()?.phase === "between"` or while loading. For guests it renders the "how it works" card below instead of rows.

Guest card (spec "States": guest; it also takes over the removed economy hint's message): three numbered steps (a real sequence, so numbers are fine) in one card, with a `[appButton]` "Create free account" → `/register`. EN / EL:
1. "Pick winners and top scorers before tip-off" / "Διάλεξε νικητές και πρώτους σκόρερ πριν το τζάμπολ"
2. "Earn points: riskier picks pay more" / "Κέρδισε πόντους: οι πιο ρισκαδόρικες επιλογές δίνουν περισσότερους"
3. "Spend them on card packs and climb the leaderboard" / "Ξόδεψέ τους σε πακέτα καρτών και ανέβα στην κατάταξη"
Keys: `dashboard.checklist.guestStep1..3`, `dashboard.checklist.guestCta` ("Create free account" / "Δημιούργησε δωρεάν λογαριασμό").

Rendering:
- One card (`rounded-3xl bg-card border border-line shadow-card`), rows split by `border-t border-line`; row grid `grid-cols-[26px_1fr_auto] gap-3 items-center py-3`.
- Check circle: open = `w-[26px] h-[26px] rounded-full border-2 border-line`; done = `bg-emerald-500 border-emerald-500 text-white` with an SVG tick and the class `tick-pop` (add to `styles.css`: a 220 ms scale 0.6→1 keyframe, disabled under `prefers-reduced-motion`).
- Button: the first open row gets `appButton="primary"`, other open rows `appButton="outline"`, all `appButtonSize="sm"`, `routerLink` = `row.link`. Done rows show no button, and their title is `text-muted`.
- **First run** (`status().firstRun`): only the picks row is shown at full opacity; the other open rows get `opacity-60`.
- **allDone**: the card collapses to one tappable line "All set for round {n}" with a chevron. Tapping it toggles a local `expanded` signal that shows the rows.
- Fantasy row extras: when `carriedFromRound` is set, the detail line is "Carried over from round {n} · Review"; when `fullTimeoutAvailable`, add an extra `text-amber-500 text-xs` line "Full Timeout available".

Copy per row (title / detail), EN + EL keys under `dashboard.checklist.*`:
- picks open: "Pick {n} more games" (`{n}` = total − done; use `pickOne` "Pick 1 more game" when 1) / detail "{done} of {total} picked". EL: "Διάλεξε άλλους {n} αγώνες", "Διάλεξε άλλον 1 αγώνα", "{done} από {total}".
- picks done: "All games picked" / "Όλοι οι αγώνες επιλέχθηκαν".
- topScorer open: "Pick a top scorer" + bonus pill "Bonus" / "Διάλεξε πρώτο σκόρερ", "Μπόνους"; detail "{n} this round" / "{n} αυτή την αγωνιστική".
- topScorer done: "Top scorer picked" / "Επέλεξες πρώτο σκόρερ".
- fantasy open: "Set your fantasy squad" / "Φτιάξε την ομάδα Fantasy"; detail "Locks with the first game" / "Κλειδώνει με τον πρώτο αγώνα".
- fantasy done: "Fantasy squad saved" / "Η ομάδα Fantasy αποθηκεύτηκε"; carried "Carried over from round {n} · Review" / "Μεταφέρθηκε από την αγωνιστική {n} · Έλεγξε"; `fullTimeout` "Full Timeout available" / "Το τάιμ άουτ είναι διαθέσιμο".
- spin open: "Spin the Jump Ball" / "Γύρνα το Τζάμπολ"; detail "Free packs every day" / "Δωρεάν πακέτα κάθε μέρα".
- spin done: "Jump Ball spun" / "Το Τζάμπολ γύρισε"; detail "Next spin in {t}" / "Επόμενο σε {t}" (`{t}` = `formatCountdown(nextAt − now)`).
- Buttons: picks "Pick" / "Επιλογή", topScorer "Choose" / "Διάλεξε", fantasy "Open" / "Άνοιγμα", spin "Spin" / "Γύρνα".
- allDone line: "All set for round {n}" / "Όλα έτοιμα για την αγωνιστική {n}".

- [ ] **Step 1: Add the i18n keys and the `tick-pop` keyframe in `styles.css`.**
- [ ] **Step 2: Implement `round-checklist.ts`.**
- [ ] **Step 3: Verify the build** (no `ERROR`).
- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/features/dashboard/round-checklist.ts frontend/src/app/core/i18n/dashboard.ts frontend/src/styles.css
git commit -m "Dashboard: round checklist rows with one-tap actions"
```

---

### Task 5: League block

**Files:**
- Create: `frontend/src/app/features/dashboard/league-block.ts`
- Modify: `frontend/src/app/core/i18n/dashboard.ts`

**Interfaces:**
- Consumes: inputs only, with no own fetching: `news = input<NewsArticle[]>()`, `standings = input<StandingsRow[]>()`, `myTeamId = input<string | null>()`.
- Produces: `<app-league-block [news]="news()" [standings]="standings()" [myTeamId]="selectedTeamId()" />` (selector `app-league-block`).

Rendering: one card with three parts.
1. The first article as a row: 54×40 rounded thumbnail (the article image, or a team-colour gradient fallback) and the title in 2 lines (`line-clamp-2 font-semibold text-sm`), linking to the article the same way `app-news-stories` does.
2. Standings rows 1–4: position (muted, tabular), logo, name (`font-bold` when `team.id === myTeamId`), W–L (tabular). If the user's team is outside the top 4, add a fifth row for it after a thin divider.
3. A link row: "News" `/news`, "Standings" `/standings`, "Stats" `/stats` as small `text-team-primary font-semibold` links.

i18n: `dashboard.league.news` ("News" / "Ειδήσεις"), `.standings` ("Standings" / "Βαθμολογία"), `.stats` ("Stats" / "Στατιστικά"), `.title` ("League" / "Λίγκα").

- [ ] **Step 1: Add the i18n keys.**
- [ ] **Step 2: Implement `league-block.ts`.**
- [ ] **Step 3: Verify the build** (no `ERROR`).
- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/features/dashboard/league-block.ts frontend/src/app/core/i18n/dashboard.ts
git commit -m "Dashboard: compact league block"
```

---

### Task 6: Reassemble the dashboard

**Files:**
- Modify: `frontend/src/app/features/dashboard/dashboard.component.html`, `dashboard.component.ts`
- Delete: `frontend/src/app/features/dashboard/round-strip.ts`
- Modify: `frontend/src/app/core/i18n/dashboard.ts` (remove keys only the deleted blocks used), `TODO.md`

**Interfaces:**
- Consumes: `app-round-header`, `app-round-checklist`, `app-league-block`, `RoundStatusService` (Tasks 2–5).

Steps cover:
- **Order (phone):** first-picks card (unchanged) → `<app-round-header [rank]="myRank()">` with `<app-round-recap />` projected → `<app-round-checklist />` → slimmed next-game card (team hero folded in: team logo and name, a "{position}th · W–L" line, then the opponent and tip-off) → `<app-live-center />` only when any schedule game is live or tips off today (Athens date) → sponsor ticker (unchanged markup) → `<app-league-block>` → a slim leagues/fantasy row (today's two tiles as a two-column row of compact links).
- **Desktop (lg+):** keep the existing two-column grid. Left column: header, checklist, next game, leagues/fantasy row. Right column: Live Center, ticker, league block.
- **Removed:** `<app-round-strip>`, `<app-prize-banner … hintId="dashboard-album-prize">`, the `dashboard-economy` and `dashboard-guest-cta` page hints, and the whole standings + tabbed stats card section. Remove the now-unused `getRoundMvp` and `getLeaders` loads and their signals/computeds from `dashboard.component.ts`. Keep `getLeaderboard` (`myRank()`), `getStandings`, `getNews`, `getMyLeagues`, `getFantasyLineup`, `getTeamGames`.
- **Lifecycle:** `RoundStatusService.start()` in `ngOnInit`, `.stop()` in `ngOnDestroy`.
- **Skeleton:** replace the loading block with header (`h-[124px]`), checklist (`h-[188px]`), next game (`h-[110px]`) and league block (`h-[220px]`) skeletons in the same order and columns.
- **i18n cleanup:** delete `roundStrip.*` keys and any `dashboard.*` keys that are now unreferenced (grep each before deleting).
- **TODO.md:** add "Dashboard checklist: fantasy row warnings for injured players / players with no game this round (needs injury data on GET /fantasy/lineup)."

- [ ] **Step 1: Rewrite the dashboard template order and remove the old blocks.**
- [ ] **Step 2: Remove the unused loads/signals from `dashboard.component.ts` and wire `start()`/`stop()`.**
- [ ] **Step 3: Delete `round-strip.ts` and its import; clean the unused i18n keys.**

Check that nothing still references it: `grep -rn "round-strip\|roundStrip\." frontend/src` → expected: no output.

- [ ] **Step 4: Verify both sides build**

Run: `cd backend && npx tsc -p tsconfig.json --noEmit` → no output. Run: `cd frontend && npx ng build --configuration development` → no `ERROR`. Re-run the logic check → all `ok`.

- [ ] **Step 5: Add the TODO.md line, then commit**

```bash
git add -A frontend/src/app/features/dashboard frontend/src/app/core/i18n/dashboard.ts TODO.md
git commit -m "Dashboard: reassemble around the round header and checklist"
```

(`-A` scoped to these paths only, so the deletion of `round-strip.ts` is staged.)

---

### Task 7: Dev deploy and state check

**Files:** none changed unless a fix is needed.

- [ ] **Step 1: Deploy to dev** with the `ship` skill (`dev` environment). Record the deployment id and confirm the served bundle contains `app-round-checklist`.
- [ ] **Step 2: Check the five states on dev** (dev DB, real accounts): guest (logged out), first run (a fresh account with no picks), open (an account with some picks left), all done (pick every open game, spin, save fantasy, pick one top scorer), between rounds (only when the dev schedule has a fully started round; otherwise note it as unverified). For each, confirm that the header text, progress, countdown label and visible rows match the spec's States table and Checklist rows table.
- [ ] **Step 3: Ask the user for phone screenshots in EN and EL.** Production ships only after their approval (`ship`, `production` environment), followed by a suggested "What's new" announcement.
