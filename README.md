# Clutch

A personalized EuroLeague stats & fan app. Pick a favorite team and the UI
"reskins" to that team's colors; browse standings, rosters, league leaders,
news, and a win/loss prediction game with points, badges, and tradeable
collectible cards, all built on real EuroLeague data.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 20 (standalone components), TypeScript, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL (Neon) |
| ORM | Drizzle ORM + Drizzle Kit |
| Auth | JWT (access token in memory + httpOnly refresh cookie), bcrypt |
| Data source | [`euroleague-api`](https://pypi.org/project/euroleague-api/) (Python) |

The backend calls into a small Python sync module rather than the JS
ecosystem, since that's the only tested wrapper around EuroLeague's
undocumented feed.

## Repo structure

```
backend/
  src/
    auth/        JWT + bcrypt helpers, requireAuth middleware
    db/          Drizzle schema + client
    routes/      Express routes (auth, users, teams, standings, players)
    index.ts
  sync-py/       Python scripts that pull real data and write to Postgres
    standings_sync.py
    player_stats_sync.py
frontend/
  src/app/
    core/        ApiService, AuthService, ThemeService, models, interceptor
    features/
      dashboard/   main personalized view — hero, radar chart, standings, leaders
      team/         roster page
      auth/         login/register forms
```

## Setup on a new machine

### Prerequisites
- Node.js 20+
- Python 3.9+
- A Neon Postgres database (or any Postgres — just needs a `DATABASE_URL`)

### Backend

```bash
cd backend
npm install
cp .env.example .env
# fill in DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET at minimum

npm run db:generate
npm run db:push          # creates all tables in Postgres

npm run dev               # http://localhost:4000
```

### Pull real data (Python sync)

```bash
cd backend/sync-py
python -m venv venv
venv\Scripts\activate      # Windows; use `source venv/bin/activate` on macOS/Linux
python -m pip install -r requirements.txt

python standings_sync.py 2025 38     # season, round number
python player_stats_sync.py 2025
```

Re-run these any time to refresh data — both scripts upsert, so they're safe
to run repeatedly.

### Frontend

```bash
cd frontend
npm install
npm start                  # http://localhost:4200
```

## API routes

```
GET  /api/health
GET  /api/teams
GET  /api/teams/:id/roster
GET  /api/standings
GET  /api/players/leaders?category=points&limit=10
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/users/me            (requires Authorization: Bearer <token>)
PATCH /api/users/me
```

`category` for leaders: `points` | `rebounds` | `assists` | `steals` | `blocks` | `valuation`

## Known gaps / things to pick up

- **Auth-restore race condition**: `AppComponent.restoreSession()` and
  `DashboardComponent.getStandings()` fire independently on app boot. If
  standings load first, the dashboard won't yet know the user's saved
  `favoriteTeamId` and defaults to the top-ranked team for that one render.
  Self-corrects on the next interaction. Needs a route resolver or bootstrap
  reordering to fix properly.
- **Traded players**: a player who changed teams mid-season shows
  season-long averages (across both teams) attributed entirely to their
  current team's roster page — not split per-team.
- **Games/schedule** isn't built at all yet — standings, rosters, and player
  leaders only.
- **League leaders panel** is hardcoded to `points` — the backend already
  supports the other categories, just needs a UI toggle.
- Not deployed yet — Railway is the target per the original plan, not set up.
- No PWA/installability yet.

## Design notes

Color/type tokens live in `frontend/tailwind.config.js` (`ink`, `panel`,
`hairline`, `muted`, `amber`) and `frontend/src/styles.css` (Oswald for
display text, JetBrains Mono for stats, Inter for body). The "team skin"
personalization sets `--accent-primary`/`--accent-secondary` CSS variables
via `ThemeService`, which Tailwind's `team-primary`/`team-secondary` colors
reference.
