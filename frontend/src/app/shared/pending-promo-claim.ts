// A promo code intent stashed in localStorage when a QR/claim link
// (features/claim/claim.ts) is opened by a logged-out visitor — /claim
// redirects them to /welcome first rather than a login wall, so the promo
// code can't just ride along as a query param through whatever path they
// take from there (browsing the pitch, then registering or logging in).
// login.component.ts and register.component.ts both check this after a
// successful auth so the code still gets redeemed once the visitor is
// actually signed in.
const KEY = "pendingPromoClaim";

export function stashPendingPromoClaim(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Private browsing / storage disabled — the claim link simply won't
    // survive the /welcome detour in that case; a scan while already
    // logged in (the common case at a live event) never touches this path.
  }
}

export function peekPendingPromoClaim(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function consumePendingPromoClaim(): string | null {
  try {
    const code = localStorage.getItem(KEY);
    if (code) localStorage.removeItem(KEY);
    return code;
  } catch {
    return null;
  }
}
