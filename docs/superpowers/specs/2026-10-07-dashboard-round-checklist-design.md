# Dashboard: round checklist redesign

Date: 2026-10-07 · Status: approved in conversation, awaiting spec review

## Goal

The home screen (`/dashboard`) gets a logged-in fan to act on what is open
in the current round before it locks: game picks, a top-scorer pick, the
Fantasy Five squad and the daily Jump Ball. Today the page stacks 11
blocks, looks templated and leads with team info, so open actions are easy
to miss.

Chosen direction: option A, "Round checklist", from the comparison page
(three phone mockups, 2026-10-07).

Success means:
- A returning user sees within one screen what is still open, how long they
  have, and a one-tap way to do each item.
- The page is shorter: league content shrinks to one compact block.
- Nothing about the current data model or backend changes.

## Constraints

- Bilingual: every string goes into both i18n dictionaries in the same pass.
- Team-colour reskin via the existing CSS variables; readable on light team
  colours (use `team-secondary` for text on `team-primary`).
- Sofia Sans / Sofia Sans Condensed and the weight system (400 body, 600
  labels, 800 only via `.font-display`).
- Phone navigation stays at 4 tabs plus More.
- The sponsor ticker stays.
- Guests must still get a useful page.
- Latency comes from DB round trips: reuse existing endpoints and avoid
  duplicate fetches.

## Page structure (phone, top to bottom)

1. Round header (new, team colour).
2. Checklist (new).
3. Next game for the user's team: today's next-game card, slimmed. The
   team hero merges into it; rank becomes a small line.
4. Live Center: unchanged component, shown only when a game is live or
   tips off today. Otherwise hidden.
5. Sponsor ticker: unchanged.
6. League block (new compact card): top news story, top-4 standings strip
   with the user's team in bold, links to News / Standings / Stats.
7. My Leagues + Fantasy: one slim row at the bottom.

Removed from home: the album prize banner, the economy hint (its message
moves into the guest/first-run copy), the tabbed stats card (Performances /
Leaders / Predictors / Schedule; already on the Stats page), and the round
strip (replaced by the header).

Desktop (lg+) keeps today's two-column split: header, checklist, next game
and the leagues/fantasy row on the left; Live Center, ticker and league
block on the right.

## States

| State | When | Header | Checklist |
|---|---|---|---|
| Guest | not logged in | round number + countdown to first tip-off, "Sign up to play" button | replaced by a 3-step "how it works" |
| First run | logged in, never made a pick | normal | normal; only the picks row is highlighted |
| Open | at least one row open | "N of M done", countdown to next deadline | open rows first |
| All done | every row done, round not locked | "Round N ready ✓", points so far, rank | folds into one line, expandable |
| Between rounds | every game in the round has tipped off or is final | round result (points, rank change); the existing round recap renders here | hidden |

## Checklist rows

Open rows first, sorted by soonest deadline. Done rows dim and move below
open rows.

| Row | Open when | Done when | Button target |
|---|---|---|---|
| Game picks: "Pick 7 more games", detail "3 of 10" | an un-started game in the round has no pick | no un-started game is left without a pick | `/predictions` |
| Top scorer (labelled bonus): "Pick a top scorer", detail "0 this round" | un-started games exist and the user has no top-scorer pick in this round | at least one top-scorer pick in this round | `/predictions` |
| Fantasy squad | no saved squad for the current round | a squad exists for the current round | `/fantasy` |
| Jump Ball | `canSpin` is true | `canSpin` is false; detail "Next spin in 16h" from `nextEligibleAt` | `/wheel` |

Rules:
- A game that tipped off without a pick counts as missed, not open. Missed
  games never block "done".
- Fantasy squads carry forward automatically (GET `/fantasy/lineup` seeds
  the open round from the previous one), so a carried-over squad is done.
  Its detail line reads "Carried over from round N · Review". When
  `fullTimeoutAvailable` is true, a small amber line adds "Full Timeout
  available".
- The Fantasy row is hidden when there is no fantasy round open
  (`round === null`).
- The top-scorer row is hidden when no un-started games remain.
- The Jump Ball row has no deadline.

## Header

- Progress: "N of M done" plus a bar, where M is the number of visible rows
  (the bonus row counts).
- Countdown target: the earliest deadline among open rows. For game picks
  that is the tip-off of the earliest un-started game without a pick; for
  the fantasy squad it is the lineup's `lockAt`. When no row with a
  deadline is open, the target is the round's next tip-off, labelled
  "First game in".
- Countdown format: more than 24h shows "2d 4h"; under 24h it ticks each
  second as "4:12:09". Under 1h the countdown turns amber; under 10 minutes
  it turns red with a soft pulse. No pulse under `prefers-reduced-motion`.
- Live updates: picks made elsewhere tick the row off immediately through
  `EventsService.predictedGameIds()` (already live via SSE). The status
  refreshes when the tab becomes visible again.

## Visual design

- Header: solid `team-primary` card, the one bold element on the page.
  Small round label, large condensed "2 of 4 done" (`font-display`, 800),
  large condensed tabular countdown on the right, progress bar along the
  bottom edge. Text in `team-secondary`.
- Checklist: one plain card, rows separated by thin `line` rules. Each row:
  26px check circle (empty, then a green tick), title (600), muted detail
  line (400), one `[appButton]` (`primary` for the most urgent open row,
  `outline` for the rest). Completing a row pops the tick in and moves the
  row down. Motion is skipped under reduced motion.
- Everything below the checklist stays quiet: plain cards, no gradients,
  no uppercase eyebrow labels.

## Components and files

All new frontend code lives in `frontend/src/app/features/dashboard/`.

- `round-status.service.ts` (new): a signal-based service that loads and
  combines
  - the schedule (`getSchedule`): current round, games, tip-off times
  - picks (`EventsService.predictedGameIds()`)
  - top-scorer picks (`getMyTopScorerPredictions`)
  - the fantasy lineup (`getFantasyLineup`): round, players, `lockAt`,
    `fullTimeoutAvailable`, `defaultRound`
  - the spin status (`GET /api/spin`: `canSpin`, `nextEligibleAt`)

  into one `RoundStatus`:
  `{ round, phase: 'open' | 'allDone' | 'between', rows: ChecklistRow[], doneCount, nextDeadline: { at, kind } | null }`.
  It exposes the loaded schedule so `live-center.ts` stops fetching it
  separately. Each source loads independently; a failed source leaves its
  row out instead of failing the whole status.
- `round-header.ts` (new): presentational; header, progress, countdown and
  the per-state variants. Hosts `round-recap` in the between-rounds state.
- `round-checklist.ts` (new): presentational; rows, buttons and the
  all-done folded line.
- `league-block.ts` (new): top news story, top-4 standings, links. Takes
  the data the dashboard already loads (`news()`, standings) as inputs.
- `dashboard.component.html` / `.ts`: reordered per the structure above.
  Removes the round strip, prize banner, economy hint and tabbed stats card
  and their now-unused loads (`getRoundMvp`, `getLeaders`). The predictors
  leaderboard load (`getLeaderboard`) stays: `myRank()` feeds the
  all-done and between-rounds headers. The team hero folds into the
  next-game card. The loading
  skeleton is updated to the new layout.
- `round-strip.ts`: deleted.
- `live-center.ts`: reads the schedule from `RoundStatusService`.
- `core/i18n/dashboard.ts`: new `dashboard.checklist.*`,
  `dashboard.roundHeader.*` and `dashboard.league.*` keys in EN and EL.
  Keys that only the removed blocks used are deleted.
- `TODO.md`: add the out-of-scope fantasy warnings below.

No backend or schema changes.

## Error handling

- Any single source failing hides only its row; the header counts the rows
  that loaded.
- If the schedule fails, the header and checklist are replaced by today's
  generic error card for that section; the rest of the page still renders.
- Loading: a skeleton shaped like the header and three checklist rows, so
  nothing below shifts when data arrives.

## Verification

The repo has no test suite.
- `ng build` and the backend type-check pass.
- On dev, check the five states with real accounts: guest, first run,
  open, all done, between rounds.
- Ask the user for phone screenshots in EN and EL before shipping to
  production.

## Out of scope

- Picking winners directly on the dashboard (option B's in-place picks).
  Possible follow-up.
- Fantasy warnings for injured players or players without a game this
  round. These need injury data on the lineup response; add to `TODO.md`.
- Push or email reminders tied to the countdown.
