// Which news stories this browser has already viewed (2026-10-08). Per
// device by design: a convenience for hiding the dashboard rail once
// everything is read, not state worth a backend round trip. Capped so the
// list can't grow without bound — old IDs fall off the front.
const KEY = "clutch.seenStories";
const MAX_IDS = 200;

export function loadSeenStoryIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveSeenStoryIds(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids].slice(-MAX_IDS)));
  } catch {
    // Storage blocked (private mode etc.) — the rail just keeps showing.
  }
}
