import { Injectable, computed, effect, inject, signal, untracked } from "@angular/core";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { EventsService } from "./events.service";

/**
 * "Needs your attention" count for Four Quarters duels, same shape as
 * TradesNotificationService (trades-notification.service.ts). The live toast
 * (battle-challenge-toast.ts) only fires while a tab has an open SSE
 * connection, so this fetches GET /duels/mine on every auth boot (and on
 * every "duel" SSE event) and shows a persistent badge instead.
 *
 * The count is duels with myMove true: an active duel where I haven't
 * committed this quarter, plus incoming pending challenges I can answer
 * (the backend already folds both into myMove). Public names are kept from
 * the old battles version so existing badges keep compiling.
 */
@Injectable({ providedIn: "root" })
export class BattlesNotificationService {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private events = inject(EventsService);

  private readonly count = signal(0);
  readonly actionCount = computed(() => this.count());
  readonly pendingIncomingCount = this.actionCount;
  readonly hasPendingIncoming = computed(() => this.actionCount() > 0);

  constructor() {
    effect(() => {
      if (this.auth.accessToken()) {
        untracked(() => this.refresh());
      } else {
        this.count.set(0);
      }
    });

    effect(() => {
      const update = this.events.lastDuelUpdate();
      if (update && this.auth.accessToken()) {
        untracked(() => this.refresh());
      }
    });
  }

  // Duel summaries carry no league id, so the per-league dot on League
  // Detail's Battles tab is retired; kept so the call site still compiles.
  countForLeague(_leagueId: string): number {
    return 0;
  }

  refresh(): void {
    this.api.getMyDuels().subscribe({
      next: (rows) => this.count.set(rows.filter((d) => d.myMove).length),
      error: () => {}, // non-critical — badge just stays at its last known count
    });
  }
}
