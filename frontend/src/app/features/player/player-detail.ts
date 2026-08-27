import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { PlayerDetail, PlayerShotChart, PlayerGameLogEntry } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ShotChartComponent } from "./shot-chart";
import { newsDateLocale, shortDateFormat } from "../../shared/news-date-format";

@Component({
  selector: "app-player-detail",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, SkeletonComponent, ShotChartComponent],
  templateUrl: "./player-detail.html",
})
export class PlayerDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly detail = signal<PlayerDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly shotChart = signal<PlayerShotChart | null>(null);
  readonly gameLog = signal<PlayerGameLogEntry[]>([]);

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

    this.api.getPlayerGames(playerId).subscribe({
      next: (log) => this.gameLog.set(log.rows),
      error: () => {}, // non-critical section — page still works with no log
    });
  }

  isHomeGame(entry: PlayerGameLogEntry): boolean {
    return entry.game.homeTeam.id === this.detail()?.team.id;
  }

  opponentTeam(entry: PlayerGameLogEntry) {
    return this.isHomeGame(entry) ? entry.game.awayTeam : entry.game.homeTeam;
  }

  isWin(entry: PlayerGameLogEntry): boolean {
    const { homeScore, awayScore } = entry.game;
    if (homeScore === null || awayScore === null) return false;
    return this.isHomeGame(entry) ? homeScore > awayScore : awayScore > homeScore;
  }

  fmtPct(value: number | null | undefined): string {
    return value !== null && value !== undefined ? `${value.toFixed(1)}%` : "—";
  }

  fmtNum(value: number | null | undefined): string {
    return value !== null && value !== undefined ? value.toFixed(1) : "—";
  }

  // Greek month names/day-first order for the date pipe — see
  // shared/news-date-format.ts for why the locale has to be passed
  // explicitly.
  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  shortDateFormat(): string {
    return shortDateFormat(this.i18n.lang());
  }
}
