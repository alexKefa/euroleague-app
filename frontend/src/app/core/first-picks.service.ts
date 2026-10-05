import { Injectable, effect, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "./api-config";
import { AuthService } from "./auth.service";
import { PackRewardsService } from "./pack-rewards.service";

export interface FirstPicksStatus {
  picks: number;
  target: number;
  claimed: boolean;
}

/**
 * First-pick onboarding (2026-10-05, backend services/firstPicks.ts): save
 * your first 3 winner picks, get a free pack. Drives the progress card on
 * Home and Predictions. The pack itself is granted and announced by the
 * app-wide reward toast (PackRewardsService.check()).
 */
@Injectable({ providedIn: "root" })
export class FirstPicksService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private packRewards = inject(PackRewardsService);

  readonly status = signal<FirstPicksStatus | null>(null);

  constructor() {
    effect(() => {
      if (this.auth.accessToken()) this.refresh();
      else this.status.set(null);
    });
  }

  /** Call after picks are saved. */
  refresh(): void {
    this.http.get<FirstPicksStatus>(`${API_BASE_URL}/predictions/first-picks`).subscribe({
      next: (s) => {
        if (!s.claimed && s.picks >= s.target) {
          // Grants the pack and shows the reward toast.
          this.packRewards.check();
          this.status.set({ ...s, claimed: true });
          return;
        }
        this.status.set(s);
      },
      error: () => {},
    });
  }
}
