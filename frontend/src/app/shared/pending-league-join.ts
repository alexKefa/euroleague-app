// A league invite (/leagues?join=CODE, shared from the Battles page,
// 2026-09-30) opened by a logged-out visitor: the code is stashed here and
// /leagues sends them to /welcome, then login/register pick it back up and
// return them to the join link once they're signed in. Same shape as
// pending-promo-claim.ts.
const KEY = "pendingLeagueJoin";

export function stashPendingLeagueJoin(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Storage disabled — the invite just won't survive the detour.
  }
}

export function consumePendingLeagueJoin(): string | null {
  try {
    const code = localStorage.getItem(KEY);
    if (code) localStorage.removeItem(KEY);
    return code;
  } catch {
    return null;
  }
}

/** Where to land after login/register: a pending league invite, else null. */
export function pendingLeagueJoinUrl(): string | null {
  const code = consumePendingLeagueJoin();
  return code ? `/leagues?join=${encodeURIComponent(code)}` : null;
}
