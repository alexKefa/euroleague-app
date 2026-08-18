import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { Prediction, LeaderboardEntry, PredictionSummary } from "../../core/models";

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
  imports: [CommonModule, RouterLink, ReactiveFormsModule],
  templateUrl: "./predictions.html",
})
export class PredictionsComponent implements OnInit {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  protected auth = inject(AuthService);

  readonly myPredictions = signal<Prediction[]>([]);
  readonly leaderboard = signal<LeaderboardEntry[]>([]);
  readonly mySummary = signal<PredictionSummary | null>(null);
  readonly loading = signal(true);

  readonly adjustSubmitting = signal(false);
  readonly adjustError = signal<string | null>(null);
  readonly adjustSuccess = signal<string | null>(null);

  readonly adjustForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    points: [10, [Validators.required]],
    reason: ["", [Validators.required]],
  });

  ngOnInit(): void {
    this.api.getLeaderboard().subscribe({
      next: (rows) => this.leaderboard.set(rows),
      error: () => {},
    });

    if (this.auth.isAuthenticated()) {
      this.api.getMyPredictions().subscribe({
        next: (rows) => {
          this.myPredictions.set(rows);
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

  submitAdjustment(): void {
    if (this.adjustForm.invalid || this.adjustForm.value.points === 0) return;
    this.adjustSubmitting.set(true);
    this.adjustError.set(null);
    this.adjustSuccess.set(null);

    const { email, points, reason } = this.adjustForm.getRawValue();
    this.api.adjustPoints(email, Number(points), reason).subscribe({
      next: () => {
        this.adjustSubmitting.set(false);
        this.adjustSuccess.set(`Granted ${points} pts to ${email}.`);
        this.adjustForm.patchValue({ email: "", reason: "" });
        this.api.getLeaderboard().subscribe({ next: (rows) => this.leaderboard.set(rows) });
      },
      error: (err) => {
        this.adjustSubmitting.set(false);
        this.adjustError.set(err?.error?.error ?? "Failed to grant points.");
      },
    });
  }
}