# Account Deletion & Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can download their data as JSON and anonymize (delete) their own account from the profile page.

**Architecture:**
- **Backend:** two focused services, `services/accountDeletion.ts` (one transaction, returns who to notify) and `services/accountExport.ts` (fixed per-table queries), mounted on the existing `usersRouter`.
- **Lockout and hiding:** a new `users.deleted_at` column; `/auth/refresh` checks it, and every public user listing filters on it.
- **Frontend:** a "Your data" card on the profile page, the shared `app-dialog`, and a small toast in the shared stack.

**Tech Stack:** Express 4 + Drizzle (postgres-js) + Neon Postgres; Angular 20 standalone components with signals; hand-rolled i18n (EN + EL).

**Spec:** `docs/superpowers/specs/2026-10-12-account-deletion-design.md`

## Global Constraints

- **Delete means anonymize, never hard delete.** The `users` row stays; personal fields are overwritten.
- **Anonymized values (exact):**
  - `email = 'deleted-' || id || '@deleted.invalid'`
  - `username = 'deleted-' || left(id::text, 8)`
  - `password_hash = '!'`
  - `avatar_url`, `favorite_team_id`, `referral_code`, `password_reset_token_hash`, `password_reset_token_expires_at` = null
  - `showcase_collectible_ids` = empty
  - `deleted_at = now()`
- **Rows deleted:** `push_subscriptions`, `device_tokens`, `league_members`, `favorites`, `favorite_players` for that user.
- **Rows set to `status = 'cancelled'`:** pending `trade_offers` (either side) and pending `battles` (either side).
- **Kept:** picks, top-scorer picks, point adjustments, pack openings, cards, finished trades and battles, fantasy, achievements and claims.
- **Confirmation:** the body is `{ confirmUsername }`. 400 if it doesn't match the current username, 409 if already deleted. No password prompt.
- **Export:** `GET /api/users/me/export`, sent as `Content-Disposition: attachment; filename="clutch-data-<username>.json"`, 5 requests per hour per user.
- **Refresh:** `POST /api/auth/refresh` returns 401 when the user is missing or `deleted_at` is set. `requireAuth` stays JWT-only.
- **Hidden** when `deleted_at` is set: overall leaderboard, round standings (both queries), `/api/teams/fans`.
- **Every new string** has EN and EL in the same edit.
- **Schema changes** are applied by hand with SQL to dev **and** production (CLAUDE.md). There is no test suite; checks are `npx tsx` scripts using `node:assert/strict`, run against dev.

## Review Focus

1. **Typed username with different case or spaces.** Compare after `trim()`, case-sensitively against the stored username; `" Alex "` vs `"alex"` → 400. Test in Task 2.
2. **Deleting twice** (double tap, or a second tab) → the second call gets 409, with no second write. The transaction re-reads `deleted_at` under `FOR UPDATE`. Test in Task 2.
3. **The user's other device** keeps a valid refresh cookie → its next refresh is a 401 and that device lands on `/login`. Test in Task 2.
4. **The counterpart of a pending trade or battle** sees the item disappear live: `trade-update` / `battle-update` with reason `cancelled` is sent to them. Test in Task 2 (the returned ids are asserted).
5. **Signing in with Google after deletion** creates a fresh account and doesn't revive the old one: the old email no longer matches. Test in Task 2.

---

### Task 1: `deleted_at` column, hidden from public listings

**Files:**
- Modify: `backend/src/db/schema.ts` (users table: add `deletedAt: timestamp("deleted_at", { withTimezone: true })`)
- Modify: `backend/src/services/leaderboard.ts:203`, `backend/src/services/roundStandings.ts` (both `where`/select sites at ~56 and ~138), `backend/src/routes/teams.ts:84-100`, `backend/src/routes/admin.ts:21` (`/users/search`), `frontend/src/app/features/admin/admin-users.html` + `frontend/src/app/core/i18n/admin.ts`

**Interfaces:**
- Produces: column `users.deleted_at` (`users.deletedAt` in Drizzle), null = active.

- [ ] **Step 1:** Add the column to `schema.ts`, with a comment pointing to the spec.
- [ ] **Step 2:** Apply `alter table users add column if not exists deleted_at timestamptz;` by hand to dev (`DATABASE_URL` from `backend/.env`) and production (`npx neonctl connection-string --project-id shy-frost-51618412 --org-id org-dark-hat-10818944`). Expected: `select count(*) from information_schema.columns where table_name='users' and column_name='deleted_at'` returns 1 on both.
- [ ] **Step 3:** Add `and u.deleted_at is null` to the leaderboard's user filter, to both round-standings queries, and to the fans count (as `users.deletedAt is null`).
- [ ] **Step 4:** Admin user search keeps deleted users but returns `deletedAt`; `admin-users.html` shows a muted `admin.userDeleted` chip (EN "Deleted", EL "Διαγραμμένος") next to the username when it is set.
- [ ] **Step 5:** `cd backend && npx tsc -p tsconfig.json --noEmit` (no output) and `cd frontend && npx ng build --configuration development` (complete, no errors).
- [ ] **Step 6:** Commit: `Users: deleted_at column, hidden from leaderboards and fan counts`.

### Task 2: Delete endpoint and refresh lockout

**Files:**
- Create: `backend/src/services/accountDeletion.ts`
- Modify: `backend/src/routes/users.ts` (add `DELETE /me`), `backend/src/routes/auth.ts:289-305` (refresh)
- Test: `backend/src/scripts/check-account-deletion.ts`

**Interfaces:**
- Consumes: `users.deletedAt` (Task 1).
- Produces:
  ```ts
  export type DeleteAccountResult =
    | { ok: true; cancelledTrades: { id: string; otherUserId: string }[]; cancelledBattles: { id: string; otherUserId: string }[] }
    | { ok: false; status: 400 | 404 | 409; code: "USERNAME_MISMATCH" | "NOT_FOUND" | "ALREADY_DELETED" };
  export async function deleteAccount(userId: string, confirmUsername: string): Promise<DeleteAccountResult>;
  ```
  The route `DELETE /api/users/me` (requireAuth) maps this to a status, sends `trade-update`/`battle-update` with reason `"cancelled"` to each `otherUserId` via `sendToUser` from `realtime/hub.ts`, clears the refresh cookie with the same options as `/auth/logout` (`{ path: "/api/auth" }`), and responds 204.

- [ ] **Step 1: Write the failing check** `check-account-deletion.ts`. It creates on dev:
  - user A (`check-del-a-<ts>@dev.invalid`) and user B
  - for A: one prediction on any final game, one `user_collectibles` row, one push subscription, one `league_members` row in a new league, a pending `trade_offers` A→B, and a pending `battles` row B challenging A

  Assertions:
  ```ts
  assert.deepEqual(await deleteAccount(A, "wrong"), { ok: false, status: 400, code: "USERNAME_MISMATCH" });
  assert.deepEqual(await deleteAccount(A, ` ${usernameA.toUpperCase()} `), { ok: false, status: 400, code: "USERNAME_MISMATCH" }); // case-sensitive
  const r = await deleteAccount(A, ` ${usernameA} `); // trimmed
  assert.equal(r.ok, true);
  assert.deepEqual(r.cancelledTrades.map((t) => t.otherUserId), [B]);
  assert.deepEqual(r.cancelledBattles.map((b) => b.otherUserId), [B]);
  // users row: email `deleted-${A}@deleted.invalid`, username `deleted-${A.slice(0, 8)}`,
  // password_hash '!', avatar/favorite/referral/reset null, deleted_at not null
  // push_subscriptions, league_members for A: 0 rows; trade and battle status 'cancelled'
  // prediction and user_collectibles rows for A: still 1 each
  assert.deepEqual(await deleteAccount(A, `deleted-${A.slice(0, 8)}`), { ok: false, status: 409, code: "ALREADY_DELETED" });
  // getLeaderboardEntries() and getRoundStandings(season, round) contain no entry for A
  // refresh: POST http://localhost:4000/api/auth/refresh with cookie
  // `<REFRESH_COOKIE_NAME>=${signRefreshToken(A)}` -> 401
  // a fresh Google-style login can't match: select from users where lower(email) = A's old email -> 0 rows
  ```
  Clean up B, the league and the trade/battle rows at the end. A stays as a tombstone, as designed.
- [ ] **Step 2:** Run `cd backend && npx tsx src/scripts/check-account-deletion.ts` (the local server must be running on :4000 against dev). Expected: fails on the import of `deleteAccount`.
- [ ] **Step 3: Implement `deleteAccount`.** One `db.transaction`:
  - `select ... from users where id = $1 for update`; missing → 404; `deleted_at` set → 409; `confirmUsername.trim() !== username` → 400
  - then one `update users` with the exact values from Global Constraints
  - `delete` from the 5 personal tables listed there
  - `update trade_offers ... where status='pending' and (from_user_id=$1 or to_user_id=$1) returning id, from_user_id, to_user_id`
  - the same `update` on `battles` (`challenger_user_id`, `opponent_user_id`)
  - map each returned row's other side to `otherUserId`
- [ ] **Step 4: Refresh lockout.** In `/auth/refresh`, after `verifyRefreshToken`, select `deletedAt` for `payload.sub`. If there's no row or `deletedAt` is set, clear the cookie and return `401 { error: "Account deleted", code: "ACCOUNT_DELETED" }`.
- [ ] **Step 5:** Add `DELETE /me` to `usersRouter` (requireAuth) as described under Interfaces.
- [ ] **Step 6:** Re-run the check. Expected: `all account-deletion checks passed`.
- [ ] **Step 7:** `npx tsc -p tsconfig.json --noEmit`, then commit: `Account deletion: anonymize the user, cancel what others wait on, lock refresh`.

### Task 3: Data export endpoint

**Files:**
- Create: `backend/src/services/accountExport.ts`
- Modify: `backend/src/routes/users.ts` (add `GET /me/export`)
- Test: extend `backend/src/scripts/check-account-deletion.ts` with an export block that runs **before** the deletion

**Interfaces:**
- Produces:
  ```ts
  export interface AccountExport {
    exportedAt: string;
    profile: { email: string; username: string; createdAt: string; lastSeenAt: string | null; favoriteTeam: string | null; referralCode: string | null };
    predictions: unknown[]; topScorerPicks: unknown[]; pointAdjustments: unknown[];
    cards: unknown[]; packOpenings: unknown[];
    trades: unknown[]; battles: unknown[]; // other people shown by username only, never email or id
    fantasy: unknown[]; leagues: unknown[]; achievements: unknown[];
    pushSubscriptions: { host: string; createdAt: string }[]; // endpoint host only
  }
  export async function buildAccountExport(userId: string): Promise<AccountExport>;
  ```
  Route: `GET /api/users/me/export` (requireAuth plus an `express-rate-limit` limiter with `windowMs: 60*60*1000, limit: 5, keyGenerator: (req) => req.userId!`), `Content-Disposition: attachment; filename="clutch-data-<username>.json"`, `Content-Type: application/json`.

- [ ] **Step 1: Write the failing check block.** It calls `buildAccountExport(A)`, then asserts:
  - `JSON.parse(JSON.stringify(x))` works
  - `x.profile.email` equals A's email
  - `x.predictions.length === 1` and `x.cards.length === 1`
  - `x.trades[0]` contains B's username and **not** B's email or id (`JSON.stringify(x.trades)` doesn't include B's email or B's id)
  - every `x.pushSubscriptions[i].host` has no `/`
- [ ] **Step 2:** Run the check. Expected: fails on the missing import.
- [ ] **Step 3:** Implement with one statement per section. Tables that link through the user go through their parent: league names via `league_members`→`leagues`; trades with their `trade_offer_items` card names.
- [ ] **Step 4:** Add the route. With the server running, `curl -i` with a dev token shows the `Content-Disposition` header, and the 6th call within an hour returns 429.
- [ ] **Step 5:** Re-run the check (passes), run `tsc`, then commit: `Account data export as a JSON download`.

### Task 4: Profile "Your data" card, delete dialog, toast

**Files:**
- Modify: `frontend/src/app/core/api.service.ts`, `frontend/src/app/core/auth.service.ts`, `frontend/src/app/features/profile/profile.ts`, `frontend/src/app/features/profile/profile.html`, `frontend/src/app/core/i18n/chrome.ts`, `frontend/src/app/app.component.html` (toast stack)
- Create: `frontend/src/app/shared/account-deleted-toast.ts`

**Interfaces:**
- Consumes: Task 2's `DELETE /api/users/me` and Task 3's `GET /api/users/me/export`.
- Produces:
  - `ApiService.exportMyData(): Observable<Blob>` (`responseType: "blob"`)
  - `ApiService.deleteMyAccount(confirmUsername: string): Observable<void>`
  - `AuthService.endSessionAfterDeletion(): void`: sets `accessToken` and `currentUser` to null, `theme.applyTeam(null)`, and `accountDeleted.set(true)`; skips `dropPushSubscription` (the server already deleted it)
  - `AuthService.accountDeleted = signal(false)`
  - `<app-account-deleted-toast>`: placed in the shared stack, visible while `auth.accountDeleted()`, auto-hides after 6 s, rendered with `pointer-events-auto mb-3` like its neighbours

- [ ] **Step 1: i18n.** Add these keys to `chrome.ts`, with exactly this EN copy and EL in the same edit:

  | Key | EN |
  |---|---|
  | `profile.yourData` | Your data |
  | `profile.downloadData` | Download my data |
  | `profile.downloadDataHint` | Everything Clutch keeps about you, as a JSON file. |
  | `profile.deleteAccount` | Delete account |
  | `profile.deleteAccountHint` | Erases your email, username and sign-in. Your picks and cards stay in the game's history under an anonymous name. This can't be undone. |
  | `profile.deleteConfirmLabel` | Type your username to confirm: {username} |
  | `profile.deleteConfirmButton` | Delete my account |
  | `profile.deleteFailed` | Couldn't delete your account. Try again. |
  | `profile.exportFailed` | Couldn't prepare your data. Try again later. |
  | `toast.accountDeleted` | Your account was deleted. |

- [ ] **Step 2:** Add the two `ApiService` methods and the two `AuthService` members.
- [ ] **Step 3: Profile card.** Below the existing profile cards, add "Your data":
  - **Download:** fetch the blob, then save it with the same anchor/`URL.createObjectURL` pattern as `features/game/game-story.ts` `saveFile`, with the filename from `Content-Disposition` or fallback `clutch-data.json`. A failure shows `profile.exportFailed`.
  - **Delete:** an outline danger button that opens `app-dialog` (title `profile.deleteAccount`, close label `admin.close`) containing the hint, a Reactive Forms text control, and a red primary button. The button is disabled until `control.value.trim() === auth.currentUser()?.username`.
  - **On success:** `endSessionAfterDeletion()`, then `router.navigateByUrl('/welcome')`.
  - **On error:** show `profile.deleteFailed` inside the dialog.
- [ ] **Step 4:** Create the toast component and add it to the stack in `app.component.html`.
- [ ] **Step 5:** `cd frontend && npx ng build --configuration development`. Expected: `Application bundle generation complete` with no errors.
- [ ] **Step 6:** Commit: `Profile: download your data and delete your account`.

### Task 5: Ship and verify

- [ ] **Step 1:** Run `check-account-deletion.ts` once more against dev. Expected: it passes.
- [ ] **Step 2:** Push `dev` and deploy to dev (`railway up --service euroleague-app --environment dev --detach`). Confirm the served bundle contains `profile.deleteConfirmButton`.
- [ ] **Step 3:** Ask the user to try download and delete on dev with a throwaway account, and send a screenshot of the card and the dialog.
- [ ] **Step 4:** After the user approves: push `dev:main`, deploy to production, confirm the bundle, and suggest a "What's new" note (EN + EL) for `/admin/tools`.
