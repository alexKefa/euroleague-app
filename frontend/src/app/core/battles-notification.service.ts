import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { EventsService } from "./events.service";
import { BattleSummary } from "./models";

/**
 * Pending-incoming battle-challenge count, same shape as
 * TradesNotificationService (trades-notification.service.ts) and built for
 * the same reason: the live challenge toast (battle-challenge-toast.ts) only
 * fires while a tab has an open SSE connection, so a challenge sent while
 * the recipient's app was closed/backgrounded never surfaces at all — a
 * real gap reported live (2026-09-23). This fetches the full cross-league
 * picture via GET /battles/mine on every auth boot (not just on a live SSE
 * push), so re-opening the app after missing the toast still surfaces the
 * challenge — as a persistent badge rather than a re-fired popup, since a
 * challenge that's been sitting there for a while isn't "breaking news" the
 * way a just-arrived one is.
 */
@Injectable({ providedIn: "root" })
export class BattlesNotificationService {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private events = inject(EventsService);

  private pendingIncoming = signal<BattleSummary[]>([]);
  readonly pendingIncomingCount = computed(() => this.pendingIncoming().length);
  readonly hasPendingIncoming = computed(() => this.pendingIncomingCount() > 0);

  constructor() {
    effect(() => {
      if (this.auth.accessToken()) {
        this.refresh();
      } else {
        this.pendingIncoming.set([]);
      }
    });

    effect(() => {
      if (this.events.lastBattleUpdate() && this.auth.accessToken()) {
        this.refresh();
      }
    });
  }

  // Exposed so League Detail's Battles tab can show a per-league dot without
  // a second request — the boot-time fetch above already covers every
  // league the user is in.
  countForLeague(leagueId: string): number {
    return this.pendingIncoming().filter((b) => b.leagueId === leagueId).length;
  }

  refresh(): void {
    this.api.getMyBattles().subscribe({
      next: (rows) => this.pendingIncoming.set(rows.filter((b) => b.status === "pending" && b.direction === "incoming")),
      error: () => {}, // non-critical — badge just stays at its last known count
    });
  }
}
