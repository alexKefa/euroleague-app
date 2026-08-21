import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Prediction, LeaderboardEntry, PredictionSummary, Game } from "../../core/models";
import { TeamBadgeComponent } from "../../shared/team-badge";
import { PageHintComponent } from "../../shared/page-hint";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";

// Matches schedule.ts — no season picker here either, and predictions
// should only ever be open for the round a user could actually be watching.
const SEASON = "2026-27";

// Icon glyphs for known badge ids — purely a display concern, the backend
// only sends id/label/description. Unrecognized ids fall back to a medal.
const BADGE_ICONS: Record<string, NavIconName> = {
  "first-call": "sprout",
  "on-a-roll": "flame",
  "perfect-round": "checkmark-shield",
  century: "trophy",
  sharpshooter: "picks",
};

@Component({
  selector: "app-predictions",
  standalone: true,
  imports: [CommonModule, RouterLink, TeamBadgeComponent, PageHintComponent, NavIconComponent],
  templateUrl: "./predictions.html",
})
export class PredictionsComponent implements OnInit {
  private api = inject(ApiService);
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

  ngOnInit(): void {
    this.api.getTeams().subscribe({
      next: (teams) => this.teamLogos.set(new Map(teams.map((t) => [t.id, t.logoUrl]))),
      error: () => {},
    });

    this.api.getLeaderboard().subscribe({
      next: (rows) => this.leaderboard.set(rows),
      error: () => {},
    });

    // The current round (backend picks the first round that isn't entirely
    // final yet, same as /schedule) rather than a flat "next 10 scheduled
    // games" — otherwise picks could leak in from a round that hasn't
    // opened yet, or the list could run out mid-round.
    this.api.getSchedule(SEASON).subscribe({
      next: (schedule) => this.upcomingGames.set(schedule.games.filter((g) => g.status === "scheduled")),
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
        next: (summary) => {
          this.mySummary.set(summary);
          // The banner below reads straight off mySummary(), so by the time
          // this fires it's already been rendered — safe to mark seen now.
          if (summary.newRoundRewards.length > 0) {
            this.api.ackRoundRewards().subscribe({ error: () => {} });
          }
        },
        error: () => {}, // non-critical
      });
    } else {
      this.loading.set(false);
    }
  }

  badgeIcon(badgeId: string): NavIconName {
    return BADGE_ICONS[badgeId] ?? "medal";
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
}