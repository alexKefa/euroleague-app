import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Prediction, LeaderboardEntry, PredictionSummary, Game } from "../../core/models";
import { TeamBadgeComponent } from "../../shared/team-badge";

// Emoji glyphs for known badge ids — purely a display concern, the backend
// only sends id/label/description. Unrecognized ids fall back to a medal.
const BADGE_ICONS: Record<string, string> = {
  "first-call": "🌱",
  "on-a-roll": "🔥",
  "perfect-round": "💯",
  century: "🏆",
  sharpshooter: "🎯",
};

@Component({
  selector: "app-predictions",
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, TeamBadgeComponent],
  templateUrl: "./predictions.html",
})
export class PredictionsComponent implements OnInit {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly myPredictions = signal<Prediction[]>([]);
  readonly leaderboard = signal<LeaderboardEntry[]>([]);
  readonly mySummary = signal<PredictionSummary | null>(null);
  readonly upcomingGames = signal<Game[]>([]);
  readonly loading = signal(true);
  // gameId -> predicted team id, for games the user has already picked
  readonly myPicks = signal<Map<string, string>>(new Map());
  // teamId -> logoUrl — Prediction.predictedTeam doesn't carry a logo (it's
  // a lightweight ref), so it's looked up here for the "My picks" list;
  // upcoming games already have logoUrl on their own team objects.
  readonly teamLogos = signal<Map<string, string | null>>(new Map());

  readonly adjustSubmitting = signal(false);
  readonly adjustError = signal<string | null>(null);
  readonly adjustSuccess = signal<string | null>(null);

  readonly adjustForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    points: [10, [Validators.required]],
    reason: ["", [Validators.required]],
  });

  ngOnInit(): void {
    this.api.getTeams().subscribe({
      next: (teams) => this.teamLogos.set(new Map(teams.map((t) => [t.id, t.logoUrl]))),
      error: () => {},
    });

    this.api.getLeaderboard().subscribe({
      next: (rows) => this.leaderboard.set(rows),
      error: () => {},
    });

    this.api.getUpcomingGames().subscribe({
      next: (rows) => this.upcomingGames.set(rows),
      error: () => {}, // non-critical
    });

    if (this.auth.isAuthenticated()) {
      this.api.getMyPredictions().subscribe({
        next: (rows) => {
          this.myPredictions.set(rows);
          this.myPicks.set(new Map(rows.map((p) => [p.gameId, p.predictedTeam.id])));
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });

      this.api.getMyPredictionSummary().subscribe({
        next: (summary) => this.mySummary.set(summary),
        error: () => {}, // non-critical
      });
    } else {
      this.loading.set(false);
    }
  }

  badgeIcon(badgeId: string): string {
    return BADGE_ICONS[badgeId] ?? "🏅";
  }

  myPickFor(game: Game): string | null {
    return this.myPicks().get(game.id) ?? null;
  }

  teamLogo(teamId: string): string | null {
    return this.teamLogos().get(teamId) ?? null;
  }

  predict(game: Game, teamId: string): void {
    if (!this.auth.isAuthenticated()) return;
    // Optimistic update — the backend still validates and is the source of truth.
    const map = new Map(this.myPicks());
    map.set(game.id, teamId);
    this.myPicks.set(map);

    this.api.submitPrediction(game.id, teamId).subscribe({
      error: () => {
        // Roll back on failure (e.g. game started in the meantime).
        const rollback = new Map(this.myPicks());
        rollback.delete(game.id);
        this.myPicks.set(rollback);
      },
    });
  }

  submitAdjustment(): void {
    if (this.adjustForm.invalid || this.adjustForm.value.points === 0) return;
    this.adjustSubmitting.set(true);
    this.adjustError.set(null);
    this.adjustSuccess.set(null);

    const { email, points, reason } = this.adjustForm.getRawValue();
    this.api.adjustPoints(email, Number(points), reason).subscribe({
      next: () => {
        this.adjustSubmitting.set(false);
        this.adjustSuccess.set(
          `${this.i18n.t("predictions.grantedPrefix")} ${points} ${this.i18n.t("predictions.grantedTo")} ${email}.`
        );
        this.adjustForm.patchValue({ email: "", reason: "" });
        this.api.getLeaderboard().subscribe({ next: (rows) => this.leaderboard.set(rows) });
      },
      error: (err) => {
        this.adjustSubmitting.set(false);
        this.adjustError.set(err?.error?.error ?? this.i18n.t("predictions.grantFailed"));
      },
    });
  }
}