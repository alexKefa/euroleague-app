import { Component, HostListener, OnInit, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { BattlesNotificationService } from "../../core/battles-notification.service";
import { BattleOpponent, BattleSummary, League } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { NavIconComponent } from "../../shared/nav-icon";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { BattlesInfoComponent } from "./battles-info";

/**
 * Battles home (2026-09-30, direct request: "good UI and easy to access
 * battle buttons and invite"). Battles used to live only inside a league's
 * Battles tab; this puts every battle across every league in one place,
 * with a one-tap challenge list of everyone you share a league with and an
 * invite link for bringing friends in (a league join link — battles are
 * league-scoped, so inviting someone means inviting them to a league).
 */
@Component({
  selector: "app-battles-hub",
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonDirective, SkeletonComponent, NavIconComponent, PlayerPhotoComponent, BattlesInfoComponent],
  templateUrl: "./battles-hub.html",
})
export class BattlesHubComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private battlesNotif = inject(BattlesNotificationService);
  private router = inject(Router);

  readonly loading = signal(true);
  readonly battles = signal<BattleSummary[]>([]);
  readonly opponents = signal<BattleOpponent[]>([]);
  readonly leagues = signal<League[]>([]);

  readonly yourMove = computed(() => this.battles().filter((b) => b.status === "pending" && b.direction === "incoming"));
  readonly waiting = computed(() => this.battles().filter((b) => b.status === "pending" && b.direction === "outgoing"));
  readonly recent = computed(() => this.battles().filter((b) => b.status === "finished").slice(0, 10));
  readonly wins = computed(() => this.battles().filter((b) => b.status === "finished" && b.winnerUserId === this.myUserId).length);
  readonly losses = computed(() => this.battles().filter((b) => b.status === "finished" && b.winnerUserId !== this.myUserId).length);

  readonly pickerOpen = signal(false);
  readonly search = signal("");
  readonly filteredOpponents = computed(() => {
    const q = this.search().trim().toLowerCase();
    return q ? this.opponents().filter((o) => o.displayName.toLowerCase().includes(q)) : this.opponents();
  });

  readonly invitePickerOpen = signal(false);
  readonly inviteCopied = signal(false);
  readonly cancellingId = signal<string | null>(null);

  private get myUserId(): string | null {
    return this.auth.currentUser()?.id ?? null;
  }

  ngOnInit(): void {
    // Waits for the session restore so a direct visit/reload doesn't read
    // as logged out before the refresh cookie resolves.
    this.auth.restoreSession().subscribe((loggedIn) => {
      if (loggedIn || this.auth.isAuthenticated()) this.load();
      else this.loading.set(false);
    });
  }

  private load(): void {
    this.api.getMyBattles().subscribe({
      next: (rows) => {
        this.battles.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.getBattleOpponents().subscribe({ next: (rows) => this.opponents.set(rows), error: () => {} });
    this.api.getMyLeagues().subscribe({ next: (rows) => this.leagues.set(rows), error: () => {} });
  }

  @HostListener("document:keydown.escape")
  closeSheets(): void {
    this.pickerOpen.set(false);
    this.invitePickerOpen.set(false);
  }

  openPicker(): void {
    this.search.set("");
    this.pickerOpen.set(true);
  }

  challenge(opponent: { userId: string; displayName: string; leagueId: string }): void {
    this.pickerOpen.set(false);
    this.router.navigate(["/battles", "new"], {
      queryParams: { leagueId: opponent.leagueId, opponentUserId: opponent.userId, opponentName: opponent.displayName },
    });
  }

  rematch(b: BattleSummary): void {
    this.challenge({ userId: b.counterpartyUserId, displayName: b.counterpartyName, leagueId: b.leagueId });
  }

  cancel(b: BattleSummary): void {
    if (this.cancellingId()) return;
    this.cancellingId.set(b.id);
    this.api.cancelBattle(b.id).subscribe({
      next: () => {
        this.battles.update((rows) => rows.filter((r) => r.id !== b.id));
        this.cancellingId.set(null);
      },
      error: () => this.cancellingId.set(null),
    });
  }

  didIWin(b: BattleSummary): boolean {
    return b.winnerUserId === this.myUserId;
  }

  // One league: share it straight away. Several: let the user pick which.
  // None: battles need a league, so send them to create or join one.
  invite(): void {
    const leagues = this.leagues();
    if (leagues.length === 0) {
      this.router.navigate(["/leagues"]);
    } else if (leagues.length === 1) {
      this.shareLeague(leagues[0]);
    } else {
      this.invitePickerOpen.set(true);
    }
  }

  shareLeague(league: League): void {
    this.invitePickerOpen.set(false);
    const url = `${location.origin}/leagues?join=${encodeURIComponent(league.code)}`;
    const text = this.i18n.t("battles.inviteText").replace("{league}", league.name);
    if (navigator.share) {
      navigator.share({ title: "Clutch", text, url }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(`${text} ${url}`).then(() => {
      this.inviteCopied.set(true);
      setTimeout(() => this.inviteCopied.set(false), 2500);
    });
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
}
