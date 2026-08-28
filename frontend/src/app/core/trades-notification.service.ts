import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "./api-config";
import { AuthService } from "./auth.service";
import { TradeOffer } from "./models";

/**
 * Pending-incoming trade count, shared between the nav bar's red dot
 * (app.component.html, same pattern as predictions' live-game badge) and
 * the numeric pill on the Cards hub's Trades tile (features/inventory) —
 * fetched once here rather than each call site hitting GET /trades/me
 * separately. "Pending" means an offer someone else sent you that you
 * haven't accepted/declined yet — an outgoing offer you sent doesn't need
 * your attention, so it isn't counted. No push channel for this yet (see
 * the planned-realtime-trade-updates project memory), so it only refreshes
 * on auth change and whenever refresh() is called explicitly (TradesComponent
 * calls it after loading/resolving offers).
 */
@Injectable({ providedIn: "root" })
export class TradesNotificationService {
  private auth = inject(AuthService);
  private http = inject(HttpClient);

  readonly pendingIncomingCount = signal(0);
  readonly hasPendingIncoming = computed(() => this.pendingIncomingCount() > 0);

  constructor() {
    effect(() => {
      if (this.auth.accessToken()) {
        this.refresh();
      } else {
        this.pendingIncomingCount.set(0);
      }
    });
  }

  refresh(): void {
    this.http.get<TradeOffer[]>(`${API_BASE_URL}/trades/me`).subscribe({
      next: (offers) => {
        const count = offers.filter((o) => o.status === "pending" && o.direction === "incoming").length;
        this.pendingIncomingCount.set(count);
      },
      error: () => {}, // non-critical — badge just stays at its last known count
    });
  }
}
