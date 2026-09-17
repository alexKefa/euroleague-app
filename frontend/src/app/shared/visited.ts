// Marks whether this browser has ever reached the real app (dashboard or
// the /welcome pitch) before — used by firstVisitGuard.ts to decide whether
// a cold, logged-out root visit should be bounced to /welcome instead of
// straight into the dashboard. Deliberately its own key/concern, separate
// from install-banner.ts's own visit *counter* (which nags at a 2nd visit
// regardless of route) — this one is a one-time "have they ever been
// oriented at all" flag, not a running count.
const VISITED_KEY = "clutch-visited";

export function hasVisitedBefore(): boolean {
  try {
    return localStorage.getItem(VISITED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markVisited(): void {
  try {
    localStorage.setItem(VISITED_KEY, "1");
  } catch {
    // Private browsing / blocked storage — same defensive posture as
    // install-banner.ts's own localStorage reads/writes.
  }
}
