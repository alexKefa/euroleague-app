// A Clutch Court invite (/court/CODE) opened by a logged-out visitor: the code
// is parked here, the court page sends them to /welcome, and login/register
// return them to the court once they're signed in. Same shape as
// pending-league-join.ts.
const KEY = "pendingCourtJoin";

export function stashPendingCourtJoin(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Storage disabled: the invite just won't survive the detour.
  }
}

/** Where to land after login/register: a pending court invite, else null. */
export function pendingCourtJoinUrl(): string | null {
  try {
    const code = localStorage.getItem(KEY);
    if (!code) return null;
    localStorage.removeItem(KEY);
    return `/court/${encodeURIComponent(code)}`;
  } catch {
    return null;
  }
}
