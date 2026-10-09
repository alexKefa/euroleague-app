import { Injectable, signal } from "@angular/core";

/**
 * Not-yet-submitted win/loss picks (2026-10-09). Lives in a root service
 * instead of the Predictions component so an in-app navigation (e.g. the
 * matchup strip's "Full preview" link) doesn't throw unsaved picks away —
 * the component is destroyed on navigation, this isn't. A reload/close is
 * still covered by the page's beforeunload warning. Keyed to the user who
 * made the picks so a different login in the same tab starts clean.
 */
@Injectable({ providedIn: "root" })
export class PendingPicksStore {
  readonly picks = signal<Map<string, string | null>>(new Map());
  private ownerId: string | null = null;

  /** Drops picks that belong to a different (or no) user. */
  claimFor(userId: string | null): void {
    if (this.ownerId === userId) return;
    this.ownerId = userId;
    this.picks.set(new Map());
  }
}
