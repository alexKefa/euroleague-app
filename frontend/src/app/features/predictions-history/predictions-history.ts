import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { PredictionHistoryPick, PredictionHistoryRound } from "../../core/models";
import { TeamBadgeComponent } from "../../shared/team-badge";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { SkeletonComponent } from "../../shared/skeleton";
import { newsDateLocale, shortDateFormat } from "../../shared/news-date-format";

// The full round-by-round log behind /predictions' own compact "My picks"
// card — every match with a pick (win/loss and/or top-scorer), grouped by
// round, with the points each pick actually earned. Added instead of
// keeping a "My Picks" tab on the dashboard (real overlap with Live
// Center's own Predictions tab there; this page is the genuine superset —
// it's the one place that also shows *resolved* picks with what they
// scored, round by round, rather than just the next few upcoming ones).
@Component({
  selector: "app-predictions-history",
  standalone: true,
  imports: [CommonModule, RouterLink, TeamBadgeComponent, PlayerPhotoComponent, SkeletonComponent],
  templateUrl: "./predictions-history.html",
})
export class PredictionsHistoryComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rounds = signal<PredictionHistoryRound[]>([]);

  ngOnInit(): void {
    this.api.getPredictionHistory().subscribe({
      next: (rounds) => {
        this.rounds.set(rounds);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("player.couldntLoad"));
        this.loading.set(false);
      },
    });
  }

  // The picked team's logo isn't on Prediction.predictedTeam itself (unlike
  // this endpoint's homeTeam/awayTeam) — resolved by matching against
  // whichever side of the match it actually is.
  predictedTeamLogo(pick: PredictionHistoryPick): string | null {
    if (!pick.predictedTeam) return null;
    return pick.predictedTeam.id === pick.homeTeam.id ? pick.homeTeam.logoUrl : pick.awayTeam.logoUrl;
  }

  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  shortDateFormat(): string {
    return shortDateFormat(this.i18n.lang());
  }
}
