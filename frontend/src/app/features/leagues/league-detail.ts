import { Component, HostListener, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { LeagueDetail, LeagueLeaderboardEntry } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";

// Same badge-id -> icon map as predictions.ts — keep both in sync if a
// badge is ever added there (backend/src/services/leaderboard.ts's BADGES).
const BADGE_ICONS: Record<string, NavIconName> = {
  "first-call": "sprout",
  "on-a-roll": "flame",
  "perfect-round": "checkmark-shield",
  century: "trophy",
  sharpshooter: "picks",
};

@Component({
  selector: "app-league-detail",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, NavIconComponent, ButtonDirective, SkeletonComponent, ConfirmDialogComponent],
  templateUrl: "./league-detail.html",
})
export class LeagueDetailComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly league = signal<LeagueDetail | null>(null);
  readonly leaderboard = signal<LeagueLeaderboardEntry[]>([]);

  readonly copied = signal(false);

  readonly confirmingLeave = signal(false);
  readonly leaving = signal(false);

  // Per-member detail (badges + showcase cards) opens in a modal on tap
  // instead of being packed into the leaderboard row itself — a row with a
  // name, badges *and* a handful of cards inline had no room to breathe,
  // especially on mobile.
  readonly selectedEntry = signal<LeagueLeaderboardEntry | null>(null);

  private get leagueId(): string {
    return this.route.snapshot.paramMap.get("id")!;
  }

  ngOnInit(): void {
    this.api.getLeague(this.leagueId).subscribe({
      next: (league) => {
        this.league.set(league);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });

    this.api.getLeagueLeaderboard(this.leagueId).subscribe({
      next: (rows) => this.leaderboard.set(rows),
      error: () => {},
    });
  }

  badgeIcon(id: string): NavIconName {
    return BADGE_ICONS[id] ?? "medal";
  }

  // Badge label/description come from the API in English only (backend
  // has no i18n concept) — translated client-side via the same
  // `predictions.badge.<id>.label`/`.description` keys predictions.ts's
  // own badgeLabel/badgeDescription use, rather than duplicating a second
  // translation set for the same 5 badge ids.
  badgeLabel(id: string): string {
    return this.i18n.t(`predictions.badge.${id}.label`);
  }

  badgeDescription(id: string): string {
    return this.i18n.t(`predictions.badge.${id}.description`);
  }

  openMember(entry: LeagueLeaderboardEntry): void {
    this.selectedEntry.set(entry);
  }

  closeMember(): void {
    this.selectedEntry.set(null);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.closeMember();
  }

  copyCode(): void {
    const code = this.league()?.code;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  leave(): void {
    if (this.leaving()) return;
    this.leaving.set(true);
    this.api.leaveLeague(this.leagueId).subscribe({
      next: () => this.router.navigateByUrl("/leagues"),
      error: () => {
        this.leaving.set(false);
        this.confirmingLeave.set(false);
      },
    });
  }
}
