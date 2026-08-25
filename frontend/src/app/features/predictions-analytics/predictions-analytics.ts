import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { PredictionAnalytics } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";

type SortKey = "timesPicked" | "accuracy";

@Component({
  selector: "app-predictions-analytics",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective],
  templateUrl: "./predictions-analytics.html",
})
export class PredictionsAnalyticsComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<PredictionAnalytics | null>(null);

  // Server already returns byTeam sorted by timesPicked desc, so that's the
  // default view — accuracy is the other sort an analyst would actually want.
  readonly sortKey = signal<SortKey>("timesPicked");

  readonly sortedByTeam = computed(() => {
    const rows = this.data()?.byTeam ?? [];
    const key = this.sortKey();
    return [...rows].sort((a, b) => {
      if (key === "accuracy") {
        const av = a.accuracy ?? -1;
        const bv = b.accuracy ?? -1;
        return bv - av;
      }
      return b.timesPicked - a.timesPicked;
    });
  });

  ngOnInit(): void {
    this.api.getPredictionAnalytics().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("player.couldntLoad"));
        this.loading.set(false);
      },
    });
  }

  setSort(key: SortKey): void {
    this.sortKey.set(key);
  }

  fmtPct(value: number | null): string {
    return value !== null ? `${(value * 100).toFixed(0)}%` : "—";
  }
}
