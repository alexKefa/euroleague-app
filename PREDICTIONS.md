# Predictions Feature

Reference doc for the win/loss prediction game: making picks, the points/badges
system, the leaderboard, and the admin points-grant tool. Written 2026-08-18.

## Data model

`backend/src/db/schema.ts`

| Table | Purpose |
|---|---|
| `predictions` | One row per `(userId, gameId)` — the picked winner. Upserted until tipoff. |
| `point_adjustments` | Manual point grants/deductions. `points` can be negative. Not a balance — see below. |
| `users.isAdmin` | `boolean`, defaults `false`. No signup flow sets it; flip it by hand in the DB. |

**Points are not stored as a balance.** They're recomputed on every read from
two sources, added together:

1. Resolved (final-game) correct predictions × `POINTS_PER_CORRECT` (10)
2. The sum of that user's rows in `point_adjustments`

This mirrors how `isCorrect` was already computed lazily before this feature
existed (`computeWinnerTeamId` in `backend/src/routes/predictions.ts`), so no
migration or backfill job is needed if the scoring rule ever changes — just
edit the function and every read reflects it immediately.

## Badges

Defined in `backend/src/routes/predictions.ts` as `BADGES`. Each badge is a
`check(ctx)` function over `{ picks, hasAnyPick, totalPoints }`, where `picks`
is a user's resolved predictions sorted oldest-first.

| id | Label | Rule |
|---|---|---|
| `first-call` | First Call | Made at least one prediction |
| `on-a-roll` | On a Roll | 5 correct predictions in a row |
| `perfect-round` | Perfect Round | 100% correct within some single `games.round` |
| `century` | Century | 100+ total points (picks + manual adjustments) |
| `sharpshooter` | Sharpshooter | ≥75% accuracy across ≥10 resolved predictions |

To add a badge: append to the `BADGES` array. No schema or frontend change
needed — the frontend just needs an emoji entry in `BADGE_ICONS`
(`frontend/src/app/features/predictions/predictions.ts`) or it falls back to 🏅.

## API

All under `/api/predictions`.

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /` | user | `{ gameId, teamId }` | Make/update a pick. Rejected once the game has started. |
| `GET /me` | user | — | Your picks with `isCorrect` (`null` = unresolved). |
| `GET /me/summary` | user | — | `{ points, badges }` for you. |
| `GET /leaderboard` | public | — | Top 20 by points, then accuracy. Each row has `correct`, `total`, `accuracy`, `points`, `badges`. Includes users who only have manual points and no predictions. |
| `POST /points/adjust` | **admin** | `{ email, points, reason }` | Grants (or deducts, if `points` is negative) points to the user with that email. `points` must be a non-zero integer. |

`requireAdmin` (`backend/src/auth/middleware.ts`) checks `users.isAdmin` and
must run after `requireAuth`.

## Making someone an admin

There's no UI or bootstrap flow for this — the first admin has to be set
directly in the database:

```sql
UPDATE users SET is_admin = true WHERE email = 'you@example.com';
```

Their `isAdmin` flag then flows through `login`/`register`/`GET /users/me`
into the frontend's `AuthService.currentUser` signal automatically.

## Frontend

- **Making picks**: `frontend/src/app/features/team/roster.ts` / `roster.html`
  — buttons on each upcoming game, optimistic update with rollback on error.
- **Predictions page** (`/predictions`): `frontend/src/app/features/predictions/`
  - "My picks" card: your resolved/pending picks, plus points + badge icons
    from `GET /me/summary`.
  - "Leaderboard" card: top 20, points + badges per row.
  - **"Grant points (admin)" panel**: only rendered when
    `auth.currentUser()?.isAdmin`. A small reactive form (email, points,
    reason) that calls `ApiService.adjustPoints()` and refreshes the
    leaderboard on success.

## Not built yet

Captured from the original feature ask — see memory note
`project_predictions_gamification` for the fuller context:

- A points **store** — spending points on cosmetic collectibles (player
  figures, historic team emblems, etc.). Needs a catalog/inventory model and
  a decision on how points convert to prices.
- Any audit-trail UI for `point_adjustments` (the data — `createdByUserId`,
  `reason`, `createdAt` — is already recorded, just not surfaced anywhere).
