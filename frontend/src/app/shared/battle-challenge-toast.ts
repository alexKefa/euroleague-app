import { Component, effect, inject, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import { EventsService } from "../core/events.service";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";

interface ToastState {
  duelId: string;
  name: string;
  kind: "challenged" | "yourMove";
}

/**
 * A real-time duel popup, mounted globally in app.component.html so it
 * surfaces over whatever page the user is on. Fires from the per-user "duel"
 * SSE event for (a) a new direct challenge to answer and (b) a quarter that
 * is waiting on my commit. Only while this tab has a live connection; the
 * nav badge (BattlesNotificationService) covers the rest.
 */
@Component({
  selector: "app-battle-challenge-toast",
  standalone: true,
  imports: [NavIconComponent],
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
  private lastSeenKey: string | null = null;

  constructor() {
    effect(() => {
      const update = this.events.lastDuelUpdate();
      if (!update || !this.auth.accessToken()) return;
      if (update.status !== "pending" && update.status !== "active") return;
      // The signal can re-fire with the same value on unrelated churn, so
      // guard on a new (duel, status, quarter) before re-fetching/showing.
      const key = `${update.id}:${update.status}:${update.quarter}`;
      if (key === this.lastSeenKey) return;
      this.lastSeenKey = key;
      // Already looking at that duel: the game screen refreshes itself.
      if (this.router.url.includes(update.id)) return;
      untracked(() =>
        this.api.getDuel(update.id).subscribe({
          next: (d) => {
            const name = d.opponent?.username ?? "";
            if (d.status === "pending" && d.side === "opponent") {
              this.toast.set({ duelId: d.id, name, kind: "challenged" });
            } else if (d.status === "active" && !d.iCommitted) {
              this.toast.set({ duelId: d.id, name, kind: "yourMove" });
            }
          },
          error: () => {}, // non-critical — the duel is still in the hub
        })
      );
    });
  }

  view(): void {
    const t = this.toast();
    if (!t) return;
    this.dismiss();
    this.router.navigate(["/battles", "duel", t.duelId]);
  }

  dismiss(): void {
    this.toast.set(null);
  }
}
