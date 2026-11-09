// In-memory "who's on which court" for GET /api/courts/:code. Rooms live in
// this same process, so no DB round trip is needed for a player count.
class CourtPresence {
  private readonly counts = new Map<string, number>();

  open(code: string): void {
    this.counts.set(code, 0);
  }

  setCount(code: string, n: number): void {
    if (this.counts.has(code)) this.counts.set(code, n);
  }

  close(code: string): void {
    this.counts.delete(code);
  }

  /** Connected players on a live room, or null when no room is running. */
  count(code: string): number | null {
    return this.counts.get(code) ?? null;
  }
}

export const courtPresence = new CourtPresence();
