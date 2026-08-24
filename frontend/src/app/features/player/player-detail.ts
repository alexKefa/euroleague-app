import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { I18nService } from "../../core/i18n.service";
import { PlayerDetail, PlayerShotChart } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ShotChartComponent } from "./shot-chart";

@Component({
  selector: "app-player-detail",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, SkeletonComponent, ShotChartComponent],
  templateUrl: "./player-detail.html",
})
export class PlayerDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  protected i18n = inject(I18nService);

  readonly detail = signal<PlayerDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly shotChart = signal<PlayerShotChart | null>(null);

  ngOnInit(): void {
    const playerId = this.route.snapshot.paramMap.get("id");
    if (!playerId) {
      this.error.set(this.i18n.t("player.noPlayerSpecified"));
      this.loading.set(false);
      return;
    }

    this.api.getPlayer(playerId).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.theme.applyTeam(detail.team);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("player.couldntLoad"));
        this.loading.set(false);
      },
    });

    this.api.getPlayerShots(playerId).subscribe({
      next: (chart) => this.shotChart.set(chart),
      error: () => {},
    });
  }

  fmtPct(value: number | null | undefined): string {
    return value !== null && value !== undefined ? `${value.toFixed(1)}%` : "—";
  }

  fmtNum(value: number | null | undefined): string {
    return value !== null && value !== undefined ? value.toFixed(1) : "—";
  }
}
