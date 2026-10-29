# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personalized, bilingual (EN/EL) EuroLeague stats & fan app. The user picks a
favorite team and the UI reskins to its colors. Features: standings, rosters,
player pages, leaders, news, schedule with box scores, win/loss + top-scorer
predictions with a points leaderboard, Fantasy Five (budget-cap fantasy squads),
private Leagues, Card Battles, and a collectibles economy (daily Jump Ball wheel,
points-priced packs, album, trades) under a "Cards" hub.

**Live**: https://getclutchapp.com (Railway). Deferred follow-ups live in `TODO.md`.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 20 (standalone components, signals), TypeScript, Tailwind CSS |
| Backend | Node.js, Express, TypeScript (ESM, run via `tsx`) |
| Database | PostgreSQL: production on Supabase (Free), dev on Neon (Free) |
| ORM | Drizzle ORM + Drizzle Kit (not Prisma) |
| Auth | JWT (access token in memory only, httpOnly refresh cookie), bcrypt |
| Data source | [`euroleague-api`](https://pypi.org/project/euroleague-api/) (Python) + direct `fetch` of `api-live.euroleague.net` |

There is no test suite and no lint script. Don't look for one.

Full-stack features usually touch `schema.ts` → a backend route/service → an
Angular component → **both** i18n dictionaries. Add the Greek string in the same
pass as the English one.

## Commands

Backend (`backend/`):
```bash
npm run dev              # tsx watch — http://localhost:4000
npm run build            # tsc
npm run db:push          # push schema.ts to Postgres (interactive, see below)
npm run db:studio
npm run sync:standings | sync:news | sync:injuries | sync:odds
npm run sync:game-extras  # shots + play-by-play + lineup stints for final games (prod runs this hourly)
npm run economy:simulate # Monte Carlo album-completion simulator — re-run after any odds/interval change
npm run economy:report
npm run collectibles:expand       # regenerate card catalog
npm run collectibles:sync-images  # copy players.photo_url onto existing cards
npm run fantasy:reprice
npm run roster:sync-photos
```

Frontend (`frontend/`):
```bash
npm start                # ng serve with proxy — http://localhost:4200
npm run build
```
The frontend always calls relative `/api/...`; `proxy.conf.json` forwards to `:4000`.

Python sync (`backend/src/sync-py/`, own venv): `standings_sync.py`,
`player_stats_sync.py`, `games_sync.py`, `boxscore_sync.py`, `roster_sync.py`.
All syncs upsert, so re-running is safe. The committed venv is Windows-only;
several `scripts/*.ts` exist as TS/fetch equivalents for that reason.

## Schema changes

No migrations are checked in. The workflow is `db:push`, which always prompts
(`strict: true`). In a non-interactive session, write the equivalent SQL by hand
against `DATABASE_URL`. **Apply every schema change to both the production DB and
the dev DB (Neon project `EuroleagueDev`).** Dev silently drifts otherwise, and "relation does not exist"
on dev usually means drift, not a code bug.

## Backend architecture

- Routes: `backend/src/routes/*.ts`, one per resource, mounted in `src/index.ts`
  under `/api/<resource>`. Services in `src/services/`.
- Auth: `requireAuth` (Bearer JWT), then `requireAdmin` (checks `users.isAdmin` in
  the DB on every call). There's no first-admin bootstrap; flip `is_admin` by hand.
- `src/db/schema.ts` is the single source of truth for the data model.
- **Points are computed on read and never stored as a balance**: per-pick points +
  top-scorer points + `point_adjustments`. Scoring-rule changes apply immediately.
  Card ownership is simply rows in `user_collectibles`.
- Prediction points are odds-weighted (`services/points.ts`). The formula is
  duplicated as SQL (`pointsSqlExpr`) and JS, so keep both in sync. Odds and
  top-scorer `pointsAtPick` are fixed snapshots, never recomputed.
- Reward grants (round rewards, milestones, referrals, pack opens) use claim-first
  idempotency: a conditional UPDATE or `onConflictDoNothing` before granting.
- **Latency comes from DB round trips, not query count.** `Promise.all` gives no real
  concurrency against Neon here. Reduce the number of statements (combined
  subqueries, multi-row inserts) instead.
- Live scores use SSE (`realtime/hub.ts`, `GET /api/events`). `liveScoreSimulator.ts`
  fakes games until the real feed has data.
- `getCurrentSeason()` (`services/season.ts`) defines the current season for any
  "this season's leaders" claim. Player detail and `/advanced-stats` intentionally
  use the latest season with data.
- `teams.code` is the feed's internal club code and a real API parameter. Never
  rename it. Display abbreviations come from `frontend/.../shared/team-display-code.ts`.
- `collectibles.teamId` and `image_url` are one-time snapshots taken at insert and
  go stale after transfers or photo backfills.
- Fantasy budgets are per-user (`getUserBudget`, `services/fantasyScoring.ts`):
  100 plus every applied game-driven price move (`applied_delta` in the price
  change logs) of players/coach owned in earlier rounds. The daily reprice
  (`services/fantasyDailyReprice.ts`) keeps the price floor but no longer caps at max.
- In production the backend also serves the built Angular app (SPA fallback).

## Frontend architecture

- Lazy-loaded standalone routes in `app.routes.ts`. Desktop uses an icon rail
  (`NAV_LINKS`). Mobile uses 4 bottom tabs plus "More" (`MOBILE_OVERFLOW_PATHS`).
  Don't add a 5th mobile tab.
- `core/`: `ApiService`, `AuthService` (memory-only token, `restoreSession()`),
  `ThemeService` (team colors via CSS variables), `I18nService` (hand-rolled,
  per-feature dictionaries merged in `translations.ts`, `i18n.t('ns.key')`).
- Forms use Reactive Forms, not `ngModel`.
- Buttons use `[appButton]` (`primary`/`outline`/`secondary`, `appButtonSize="sm"`).
- Back-links use `navHistory.previousUrl() ?? '<fallback>'`.
- **Shipping a user-facing feature**: suggest a "What's new" announcement. Admins
  write them (EN + EL) on `/admin/tools`; they're stored in the `announcements`
  table, not in code. Every live, unseen one shows once as a toast.
- Top-of-screen toasts live in one shared stack in `app.component.html`. A new
  toast renders inside it with `pointer-events-auto mb-3`, never its own `fixed`
  position. Admin tools use the shared `app-dialog` (`shared/dialog.ts`).
- Font: Sofia Sans for text, Sofia Sans Condensed for `font-display` (headings,
  scores, wordmark). Google Fonts import in `styles.css`. Any font must have Greek
  glyph coverage. Weights: 400 body, 600 labels/buttons (`font-bold` is mapped to
  600 in `tailwind.config.js`), 800 only via `.font-display`.
- Push notifications: `public/push-sw.js` is a push-only service worker with **no fetch
  handler and no caching** (the old caching worker caused production 504s). Keep it that way.
  Senders live in `services/push.ts` / `services/pushJobs.ts`.
- Signals footgun: never read a signal inside an `effect()` that also writes it.
  Use `untracked()`.

## Rules

- **Visual verification**: don't open Chrome or create throwaway accounts to check
  UI changes. Confirm the build compiles, describe what changed, and ask the user
  for a screenshot. The exception is an explicit request for browser testing.
- **Design requests**: apply a requested font/color/style change directly,
  app-wide. Don't build comparison artifacts unless asked.
- **Production data**: before any bulk UPDATE/DELETE on production, show the SQL
  and a SELECT of the affected rows and get explicit confirmation. Back up
  first, or dry-run on `dev`. `scripts/backup-db.ts` only covers 30 of the ~75
  tables, so for a real backup dump every `information_schema` table instead.
- Local `backend/.env` `DATABASE_URL` points at the **dev** DB (Neon
  `EuroleagueDev`, host `ep-sparkling-pond-…`), not production. Check the host
  before any write, and kill stale `tsx watch` processes on port 4000.
- To run a one-off script against **production**, use
  `railway run --service euroleague-app --environment production -- <cmd>`.
  It injects prod's env without printing the connection string. Have the
  script refuse to run unless the host contains `pooler.supabase.com`.
- Economy changes (odds, pack slots, milestone intervals): re-run
  `npm run economy:simulate` before shipping.

## Deployment

Railway project/service `euroleague-app`, Dockerfile builder (config in
`.railway/railway.ts`). Two environments: `production` (`main` branch,
getclutchapp.com) and `dev` (`dev` branch, euroleague-app-dev.up.railway.app).

Databases, each with its own provider and free quota:
- **Production: Supabase** project `vjdrmbrishvfqfeniyhz` (Free, eu-north-1/Stockholm),
  moved from Neon on 2026-10-29. Railway's `DATABASE_URL` uses the **Session
  pooler** (`aws-0-eu-north-1.pooler.supabase.com:5432`). The direct host is IPv6-only
  and Railway can't reach it. The session pooler allows **15 clients in total**,
  and a deploy briefly runs the old and new instance together, so the app's pool
  is `max: 7` (`db/client.ts`). Don't raise it above 7; at 10 the overlap hit
  `EMAXCONNSESSION`. The Supabase roles `anon`/`authenticated` have had all
  grants on `public` revoked, so Supabase's Data API can't read app tables
  (there's no RLS). Keep it that way when creating tables by hand.
- **Dev: Neon** project `EuroleagueDev` / `misty-night-49318785` (eu-central-1).
  The old prod Neon project `EuroleagueProd` / `shy-frost-51618412` is a frozen
  backup as of the 2026-10-29 move. Use `neonctl ... --org-id org-dark-hat-10818944`.

Deploy: `npx tsc -p tsconfig.json --noEmit` (backend), `ng build` (frontend),
commit, push, then `railway up --service euroleague-app --environment <dev|production>`.
Deploys are manual and not triggered on push. Verify the change is live with
`railway logs <id> --deployment` or by checking the served bundle; don't trust
`railway status`. Check once and don't poll.

Icon files are versioned (`favicon-v15.png`, `icons/icon-v15-*.png`). Bump the
suffix on any icon change, because query-string cache-busting doesn't work for favicons.

## Environment variables (backend `.env`)

Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
Optional: `PORT`, `JWT_*_EXPIRES_IN`, `NODE_ENV`, `ODDS_API_KEY` (unset = flat
scoring), `ODDS_API_SPORT_KEY`, `RESEND_API_KEY` (unset = reset links logged to
the console), `RESEND_FROM_EMAIL`, `APP_BASE_URL` (frontend origin for emailed links),
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (web push; unset = notifications
off, generate with `npx web-push generate-vapid-keys`),
`DISABLE_BACKGROUND_JOBS=1` (set on Railway dev: stops the sync intervals so the
dev Neon compute can auto-suspend).

## Hosting costs and limits (checked 2026-10-29)

The budget is **$0 beyond Railway Hobby** ($5/mo incl. $5 usage, already ~fully
used). Don't propose paid DB plans or Railway Postgres as the default fix.

- **Supabase Free (prod)**: 500 MB DB (prod was 41 MB), no compute-hour cap, and
  **5 GB egress/month**. Egress is the binding limit: Neon showed ~5.5 GB/month
  from the app re-reading the same data. When over quota, Supabase gives a grace
  period and then restricts the project. Keep DB→app bytes down with in-memory
  caching. Before adding a polling job or an uncached hot endpoint, estimate its
  monthly bytes.
- **Neon Free (dev)**: 100 CU-hours per project per billing period, 1 GB storage,
  auto-suspend after 5 min idle. At the cap the compute is suspended until the
  next period: the site loads, but every DB call hangs. Prod hit this on
  2026-10-29, which caused the move. Keep `DISABLE_BACKGROUND_JOBS=1` on Railway
  dev so dev's compute can sleep.
- **Neon Launch**: $0.106/CU-hour plus $0.35/GB-month, no minimum, and invoices
  under $0.50 aren't collected. Turning it on for a few minutes to dump a
  suspended DB is effectively free.
- **What drives load**: user traffic, live-games sync (every 20s inside a game's
  window, from 2h before tipoff to 5h after; otherwise hourly), and the hourly
  jobs in `index.ts`.
