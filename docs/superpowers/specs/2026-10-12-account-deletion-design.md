# Account Deletion & Data Export — Design

Date: 2026-10-12
Status: awaiting review

## Goal

A signed-in user can download everything the app holds about them and can
delete their account themselves, from their profile. GDPR (EU users) gives
both rights, and Google sign-in apps are expected to offer deletion. Today
there is only `GET`/`PATCH /api/users/me`.

## Decisions

| Topic | Decision |
|---|---|
| What delete does | **Anonymize**, not hard delete (chosen 2026-10-12). Personal data is erased, the `users` row stays as a tombstone so shared history (battles, trades, league tables, other people's records) keeps its foreign keys. |
| Confirmation | The user types their username to confirm. No password prompt: Google-only accounts have no password. |
| Undo | None. Deletion is immediate and final; the export is offered right next to it. |
| Export format | One JSON file, downloaded from the profile page. |
| Schema | One new column: `users.deleted_at timestamptz null`. |

## Deleting an account (`DELETE /api/users/me`)

Body: `{ confirmUsername }`. 400 if it doesn't match the current username;
409 if already deleted. Runs in one transaction:

1. **Erase personal fields on `users`:**
   - `email` → `deleted-<id>@deleted.invalid` (keeps the unique index; can't receive mail)
   - `username` → `deleted-<first 8 of id>`
   - `password_hash` → `!` (matches no bcrypt hash, so password login is impossible)
   - `avatar_url`, `favorite_team_id`, `referral_code`, `password_reset_token_hash`, `password_reset_token_expires_at` → null
   - `showcase_collectible_ids` → empty
   - `deleted_at` → now
2. **Delete purely personal rows:**
   - push subscriptions
   - league memberships, so the user drops out of private league tables
3. **Close what other people are waiting on:**
   - pending trades the user sent or received → `status = 'cancelled'` (an existing trade status)
   - pending battles the user started or was challenged to → `status = 'cancelled'` (an existing battle status)
   - the other person gets the usual live update for each, so the item disappears from their screen
4. **Clear the refresh cookie** in the response.

Kept, because it's history other people or the economy depend on and no
longer identifies anyone: picks, top-scorer picks, point adjustments, pack
openings, cards (`user_collectibles`), finished trades and battles, fantasy
squads, achievements and reward claims.

## Locking a deleted account out

- `POST /api/auth/refresh` looks the user up and returns 401 when `deleted_at` is set (one indexed select per refresh, every ~15 min per active device). This is what stops other devices; access tokens already issued expire within 15 minutes.
- `requireAuth` stays JWT-only (no per-request DB hit).
- Login by password can't match. Google login matches by email, and the email is replaced, so signing in with the same Google account creates a **new, empty** account. That is the expected result of erasure.

## Hiding deleted users

Excluded with `deleted_at is null` wherever users are listed to other people:

- overall leaderboard (`services/leaderboard.ts`)
- round standings (`services/roundStandings.ts`)
- fans per team (`routes/teams.ts` `/fans`; the favourite team is already nulled, so this is defensive)
- admin user search: still shows them, labelled as deleted, so an admin can tell what happened

Elsewhere (a finished battle or trade the other person looks back on), they
appear under the `deleted-xxxxxxxx` username.

## Data export (`GET /api/users/me/export`)

Returns `Content-Disposition: attachment; filename="clutch-data-<username>.json"`.
The file has:

- profile: email, username, created/last seen, favourite team, referral code
- picks, top-scorer picks, point adjustments (with reasons)
- cards owned, pack openings
- trades and battles the user took part in (the other person shown by username only)
- fantasy squads, league memberships, achievements, push subscriptions (endpoint host only)

Built from a fixed list of queries, one per table, in as few statements as
practical. Rate-limited to 5 per hour per user.

## Frontend

- Profile page, at the bottom: a "Your data" card with
  - **Download my data**: fetches the export through `ApiService` and saves it with the same blob-save pattern as the story card's Download
  - **Delete account**: opens the shared `app-dialog` with what will happen, a username field, and a red confirm button that stays disabled until the typed username matches
- After deletion: the session is cleared (memory token and refresh cookie), the user lands on `/welcome`, and a toast says the account was deleted.
- i18n: every new string in EN and EL (new keys in the profile dictionary).

## Verification

1. A check script on **dev**: create a user with a pick, a card, a pending trade and a league membership, then delete it, and assert:
   - personal fields are erased and `deleted_at` is set
   - push subscriptions and league memberships are gone
   - the pending trade is cancelled
   - the pick and the card still exist
   - refresh returns 401
   - the user is absent from the leaderboard and round standings
2. The export for that user parses as JSON and contains the pick and the card.
3. Backend `tsc`, `ng build`, the user tries the flow on dev, then production.
4. Schema change applied by hand to both dev and production (CLAUDE.md).

## Out of scope

A grace period or undo window, deletion by an admin on someone's behalf,
deleting data held by third parties (Resend email logs, Railway logs), and
a CSV export.
