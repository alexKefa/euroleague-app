import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter } from "rxjs";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { FantasyCardReward, OwnedPack } from "./models";

// Re-check at most this often while navigating, so a reward earned mid-
// session (e.g. a game going final) still surfaces without a reload. Each
// check runs the reward-granting queries, so it's not done on every route.
const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * App-wide reward packs (2026-09-30): the unseen rewards behind the
 * pack-reward toast (shared/pack-reward-toast.ts), and the unopened-pack
 * count behind the Cards nav dot. Same token-driven effect as
 * TradesNotificationService / JumpBallToastComponent, so a reload waits
 * for restoreSession() instead of racing it.
 */
@Injectable({ providedIn: "root" })
export class PackRewardsService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly newRewards = signal<OwnedPack[]>([]);
  readonly newCardRewards = signal<FantasyCardReward[]>([]);
  readonly unopenedCount = signal(0);
  readonly hasUnopened = computed(() => this.unopenedCount() > 0);

  private lastCheck = 0;

  constructor() {
    effect(() => {
      if (this.auth.accessToken()) {
        this.check();
      } else {
        this.newRewards.set([]);
        this.newCardRewards.set([]);
        this.unopenedCount.set(0);
        this.lastCheck = 0;
      }
    });

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      if (this.auth.accessToken() && Date.now() - this.lastCheck > RECHECK_INTERVAL_MS) this.check();
    });
  }

  check(): void {
    this.lastCheck = Date.now();
    this.api.getUnseenPackRewards().subscribe({
      next: ({ rewards, cardRewards = [], unopenedCount }) => {
        this.unopenedCount.set(unopenedCount);
        if (rewards.length === 0 && cardRewards.length === 0) return;
        this.newRewards.update((existing) => [...existing, ...rewards.filter((r) => !existing.some((e) => e.id === r.id))]);
        this.newCardRewards.update((existing) => [...existing, ...cardRewards.filter((r) => !existing.some((e) => e.id === r.id))]);
        // Marked seen as soon as it's on screen, same as the page banners.
        this.api.ackPackRewards().subscribe({ error: () => {} });
      },
      error: () => {}, // non-critical — My Packs is still the source of truth
    });
  }

  dismiss(): void {
    this.newRewards.set([]);
  }

  dismissCards(): void {
    this.newCardRewards.set([]);
  }

  /** Pages that load My Packs themselves pass the fresh count along. */
  syncUnopenedCount(count: number): void {
    this.unopenedCount.set(count);
  }

  /** Called after a pack is opened, so the nav dot stays accurate. */
  packOpened(id: string): void {
    this.unopenedCount.update((n) => Math.max(0, n - 1));
    this.newRewards.update((rows) => rows.filter((r) => r.id !== id));
  }
}
