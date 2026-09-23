import { Component, effect, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { EventsService } from "../core/events.service";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";
import { ButtonDirective } from "./button.directive";

interface ToastState {
  battleId: string;
  challengerName: string;
}

/**
 * A real-time "you've been challenged to a duel" popup (2026-09-22, direct
 * ask: "immediately notify a user... without having to reach my leagues").
 * Mounted globally in app.component.html (same spot as install-banner.ts),
 * so it surfaces over whatever page the user is actually on — Leagues has
 * no nav icon of its own to hang a badge off (see CLAUDE.md), so a global
 * toast riding the existing app-wide SSE connection was the natural fit,
 * not a nav badge. Only ever fires while this tab has a live connection —
 * a challenge sent while the app is fully closed still only surfaces by
 * visiting the league later, same limitation every SSE-pushed feature in
 * this app already has.
 */
@Component({
  selector: "app-battle-challenge-toast",
  standalone: true,
  imports: [NavIconComponent, ButtonDirective],
  templateUrl: "./battle-challenge-toast.html",
  styleUrl: "./battle-challenge-toast.css",
})
export class BattleChallengeToastComponent {
  private events = inject(EventsService);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  readonly toast = signal<ToastState | null>(null);
  private lastSeenBattleId: string | null = null;

  constructor() {
    effect(() => {
      const update = this.events.lastBattleUpdate();
      if (!update || update.reason !== "challenged" || !this.auth.accessToken()) return;
      // sendToUser already targets only the challenged opponent, so
      // receiving this at all means it's for us — but the signal can still
      // re-fire with the same value on unrelated churn, so guard on it
      // actually being a new battle id before re-fetching/re-showing.
      if (update.battleId === this.lastSeenBattleId) return;
      this.lastSeenBattleId = update.battleId;
      this.api.getBattle(update.battleId).subscribe({
        next: (b) => {
          if (b.status !== "pending") return; // already acted on elsewhere by the time this resolved
          this.show({ battleId: b.id, challengerName: b.challengerName });
        },
        error: () => {}, // non-critical — the challenge is still visible from the league's Battles tab
      });
    });
  }

  private show(state: ToastState): void {
    this.toast.set(state);
  }

  view(): void {
    const t = this.toast();
    if (!t) return;
    this.dismiss();
    this.router.navigate(["/battles", t.battleId]);
  }

  dismiss(): void {
    this.toast.set(null);
  }
}
