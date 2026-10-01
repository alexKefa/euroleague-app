import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { AchievementMilestone, Achievements, SpinStatus } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { PageHeaderComponent } from "../../shared/page-header";

// Same glyphs as the predictions badge legend (predictions.ts's BADGE_ICONS).
const BADGE_ICONS: Record<string, NavIconName> = {
  "first-call": "sprout",
  "on-a-roll": "flame",
  "perfect-round": "checkmark-shield",
  century: "trophy",
  sharpshooter: "picks",
};

const MILESTONE_ICONS: Record<AchievementMilestone["id"], NavIconName> = {
  rareCard: "cards",
  legendaryPack: "packs",
  coachPack: "packs",
  fantasyCoachCard: "trophy",
  fantasyCaptainCard: "cards",
};

// Where to go to make progress on each milestone.
const MILESTONE_LINKS: Record<AchievementMilestone["id"], string> = {
  rareCard: "/predictions",
  legendaryPack: "/predictions",
  coachPack: "/predictions",
  fantasyCoachCard: "/fantasy",
  fantasyCaptainCard: "/fantasy",
};

/**
 * Every goal the app rewards, in one place (2026-09-30, direct request:
 * "add all our goals and achievements ... somewhere altogether"). Next
 * rewards sorted by how close they are, this round's bonus, badges with
 * progress, and the other ways to earn packs. Read-only: granting still
 * happens where it always did.
 */
@Component({
  selector: "app-achievements",
  standalone: true,
  imports: [PageHeaderComponent, CommonModule, RouterLink, ButtonDirective, SkeletonComponent, NavIconComponent],
  templateUrl: "./achievements.html",
})
export class AchievementsComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  readonly loading = signal(true);
  readonly data = signal<Achievements | null>(null);
  readonly spin = signal<SpinStatus | null>(null);
  readonly linkCopied = signal(false);

  // Closest reward first.
  readonly nextRewards = computed(() =>
    [...(this.data()?.milestones ?? [])].sort((a, b) => (a.every - a.progress) / a.every - (b.every - b.progress) / b.every)
  );
  readonly earnedBadgeCount = computed(() => this.data()?.badges.filter((b) => b.earned).length ?? 0);
  readonly totalRewardsEarned = computed(() => (this.data()?.milestones ?? []).reduce((sum, m) => sum + m.earned, 0));

  // This round's bonus: still reachable only if correct + games still to
  // be decided can hit the threshold.
  readonly round = computed(() => this.data()?.currentRound ?? null);
  readonly roundRemaining = computed(() => {
    const r = this.round();
    return r ? Math.max(0, r.totalGames - r.finalGames) : 0;
  });
  readonly roundSegments = computed(() => Array.from({ length: this.round()?.totalGames ?? 0 }));
  readonly greatReachable = computed(() => {
    const r = this.round();
    return !!r && r.correct + this.roundRemaining() >= r.greatThreshold;
  });
  readonly perfectReachable = computed(() => {
    const r = this.round();
    return !!r && r.correct === r.finalGames && r.picked === r.totalGames;
  });

  readonly inviteUrl = computed(() => {
    const code = this.data()?.referral.code;
    return code ? `${location.origin}/register?ref=${code}` : null;
  });

  ngOnInit(): void {
    // Wait for the session restore so a reload doesn't read as logged out.
    this.auth.restoreSession().subscribe((loggedIn) => {
      if (!loggedIn && !this.auth.isAuthenticated()) {
        this.loading.set(false);
        return;
      }
      this.api.getAchievements().subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
      this.api.getSpinStatus().subscribe({ next: (s) => this.spin.set(s), error: () => {} });
    });
  }

  milestoneIcon(m: AchievementMilestone): NavIconName {
    return MILESTONE_ICONS[m.id];
  }
  milestoneLink(m: AchievementMilestone): string {
    return MILESTONE_LINKS[m.id];
  }
  badgeIcon(id: string): NavIconName {
    return BADGE_ICONS[id] ?? "medal";
  }
  pct(progress: number, target: number): number {
    return target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  }
  // "2 correct picks to go" / "1 round to go".
  toGo(m: AchievementMilestone): string {
    const left = m.every - m.progress;
    const unit = m.id === "fantasyCoachCard" || m.id === "fantasyCaptainCard" ? (left === 1 ? "achievements.roundLeft" : "achievements.roundsLeft") : left === 1 ? "achievements.pickLeft" : "achievements.picksLeft";
    return `${left} ${this.i18n.t(unit)}`;
  }

  // Short hh:mm until the next Jump Ball.
  spinCountdown(): string {
    const next = this.spin()?.nextEligibleAt;
    if (!next) return "";
    const ms = Math.max(0, new Date(next).getTime() - Date.now());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  shareInvite(): void {
    const url = this.inviteUrl();
    if (!url) return;
    const text = this.i18n.t("achievements.inviteText");
    if (navigator.share) {
      navigator.share({ title: "Clutch", text, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(`${text} ${url}`).then(() => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2500);
    });
  }
}
