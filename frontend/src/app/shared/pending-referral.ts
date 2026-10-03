// A referral code (?ref=CODE on /register, shared from profile.html)
// stashed in localStorage the first time the link is opened. The query
// param alone only lasted for that one page load: a friend who tapped
// "Log in" and came back, or installed the app from install-banner.ts
// (which targets exactly these links, then reopens at start_url with no
// query string), registered with no referrer and the referrer never got
// their packs. register.component.ts reads this as a fallback and clears
// it after a successful signup.
const KEY = "pendingReferralCode";

export function stashPendingReferral(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Private browsing / storage disabled — falls back to the query param only.
  }
}

export function peekPendingReferral(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stashed to clear.
  }
}
