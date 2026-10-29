import { Component, HostListener, OnInit, computed, effect, inject, signal, untracked } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { EventsService } from "../../core/events.service";
import { I18nService } from "../../core/i18n.service";
import { BattlesNotificationService } from "../../core/battles-notification.service";
import { BattleOpponent, BattleSummary, DuelSummary, LadderRow, League, MyRating, OpenDuel } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { NavIconComponent } from "../../shared/nav-icon";
import { BattlesInfoComponent } from "./battles-info";
import { PageHeaderComponent } from "../../shared/page-header";
import { SeasonBadgesComponent } from "../../shared/season-badges";

type HubTab = "games" | "open" | "ladder";

/**
 * Battles home. Four Quarters duels (v6): a rating strip, then Games / Open /
 * Ladder tabs. Old v3-v5 battles stay as read-only history at the bottom of
 * Games > Finished. Direct challenges go to a league-mate picked from the
 * sheet below; the lineup builder lives at battles/duel/new.
 */
@Component({
  selector: "app-battles-hub",
  standalone: true,
  imports: [PageHeaderComponent, CommonModule, RouterLink, ButtonDirective, SkeletonComponent, NavIconComponent, BattlesInfoComponent, SeasonBadgesComponent],
  templateUrl: "./battles-hub.html",
})
export class BattlesHubComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);
  private battlesNotif = inject(BattlesNotificationService);
  private router = inject(Router);

  readonly tab = signal<HubTab>("games");
  readonly loading = signal(true);
  readonly duels = signal<DuelSummary[]>([]);
  readonly legacy = signal<BattleSummary[]>([]);
  readonly rating = signal<MyRating | null>(null);
  readonly opponents = signal<BattleOpponent[]>([]);
  readonly leagues = signal<League[]>([]);

  readonly openDuels = signal<OpenDuel[]>([]);
  readonly openLoading = signal(false);

  readonly ladder = signal<LadderRow[]>([]);
  readonly ladderLoading = signal(false);
  // null = Global, otherwise a league id.
  readonly ladderScope = signal<string | null>(null);

  readonly yourMove = computed(() => this.duels().filter((d) => d.myMove));
  readonly waiting = computed(() => this.duels().filter((d) => !d.myMove && (d.status === "open" || d.status === "pending" || d.status === "active")));
  readonly finished = computed(() => this.duels().filter((d) => d.status === "finished"));
  readonly legacyFinished = computed(() => this.legacy().filter((b) => b.status === "finished").slice(0, 10));
  readonly myRank = computed(() => {
    const id = this.myUserId;
    const i = this.ladder().findIndex((r) => r.userId === id);
    return i >= 0 ? i + 1 : null;
  });
  readonly myLadderRow = computed(() => this.ladder().find((r) => r.userId === this.myUserId) ?? null);

  readonly pickerOpen = signal(false);
  readonly search = signal("");
  readonly filteredOpponents = computed(() => {
    const q = this.search().trim().toLowerCase();
    return q ? this.opponents().filter((o) => o.displayName.toLowerCase().includes(q)) : this.opponents();
  });

  readonly invitePickerOpen = signal(false);
  readonly inviteCopied = signal(false);
  readonly cancellingId = signal<string | null>(null);
  private started = false;

  constructor() {
    // Any duel change pushed over SSE refetches the lists. The fetch runs
    // untracked so the signals it writes can't re-trigger this effect.
    effect(() => {
      const update = this.events.lastDuelUpdate();
      if (!update || !this.started) return;
      untracked(() => this.refreshAll());
    });
  }

  private get myUserId(): string | null {
    return this.auth.currentUser()?.id ?? null;
  }

  ngOnInit(): void {
    // Waits for the session restore so a direct visit/reload doesn't read
    // as logged out before the refresh cookie resolves.
    this.auth.restoreSession().subscribe((loggedIn) => {
      if (loggedIn || this.auth.isAuthenticated()) {
        this.started = true;
        this.load();
      } else {
        this.loading.set(false);
      }
    });
  }

  private load(): void {
    this.refreshAll();
    this.api.getBattleOpponents().subscribe({ next: (rows) => this.opponents.set(rows), error: () => {} });
    this.api.getMyLeagues().subscribe({ next: (rows) => this.leagues.set(rows), error: () => {} });
    this.api.getMyBattles().subscribe({ next: (rows) => this.legacy.set(rows), error: () => {} });
  }

  private refreshAll(): void {
    this.api.getMyDuels().subscribe({
      next: (rows) => {
        this.duels.set(rows);
        this.battlesNotif.setFromRows(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.getMyDuelRating().subscribe({ next: (r) => this.rating.set(r), error: () => {} });
    if (this.tab() === "open") this.loadOpen();
    if (this.tab() === "ladder") this.loadLadder();
  }

  setTab(t: HubTab): void {
    this.tab.set(t);
    if (t === "open") this.loadOpen();
    if (t === "ladder") this.loadLadder();
  }

  private loadOpen(): void {
    this.openLoading.set(true);
    this.api.getOpenDuels().subscribe({
      next: (rows) => {
        this.openDuels.set(rows);
        this.openLoading.set(false);
      },
      error: () => this.openLoading.set(false),
    });
  }

  setLadderScope(leagueId: string | null): void {
    this.ladderScope.set(leagueId);
    this.loadLadder();
  }

  private loadLadder(): void {
    this.ladderLoading.set(true);
    this.api.getDuelLadder(this.ladderScope() ?? undefined).subscribe({
      next: (rows) => {
        this.ladder.set(rows);
        this.ladderLoading.set(false);
      },
      error: () => {
        this.ladder.set([]);
        this.ladderLoading.set(false);
      },
    });
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
    this.router.navigate(["/battles", "duel", "new"], {
      queryParams: { leagueId: opponent.leagueId, opponentUserId: opponent.userId, opponentName: opponent.displayName },
    });
  }

  cancel(d: DuelSummary): void {
    if (this.cancellingId()) return;
    this.cancellingId.set(d.id);
    this.api.cancelDuel(d.id).subscribe({
      next: () => {
        this.duels.update((rows) => rows.filter((r) => r.id !== d.id));
        this.cancellingId.set(null);
        this.battlesNotif.refresh();
      },
      error: () => this.cancellingId.set(null),
    });
  }

  /** Whether I posted/sent this (still unanswered) challenge, so Cancel applies. */
  canCancel(d: DuelSummary): boolean {
    return (d.status === "open" || d.status === "pending") && !d.myMove;
  }

  rowLabel(d: DuelSummary): string {
    if (d.status === "active") {
      const key = d.myMove ? "duels.quarterYourMove" : "duels.quarterWaiting";
      return this.i18n.t(key).replace("{n}", String(d.quarter));
    }
    if (d.status === "pending") {
      return d.myMove ? this.i18n.t("duels.challengedYou") : this.i18n.t("duels.waitingForOpponent");
    }
    if (d.status === "open") return this.i18n.t("duels.openChallenge") + " · " + this.i18n.t("duels.waitingForOpponent");
    return "";
  }

  resultLabel(d: DuelSummary): string {
    return this.i18n.t(d.result === "win" ? "duels.win" : d.result === "loss" ? "duels.loss" : "duels.draw");
  }

  resultShort(r: "win" | "loss" | "draw" | null): string {
    return this.i18n.t(r === "win" ? "duels.winShort" : r === "loss" ? "duels.lossShort" : "duels.drawShort");
  }

  timeLeft(iso: string | null): string {
    if (!iso) return "";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return this.i18n.t("duels.expired");
    const mins = Math.floor(ms / 60000);
    const t = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.max(mins, 1)}m`;
    return this.i18n.t("duels.timeLeft").replace("{t}", t);
  }

  paidWinsLeft(n: number): string {
    return this.i18n.t("duels.paidWinsLeft").replace("{n}", String(n));
  }

  openRating(n: number): string {
    return this.i18n.t("duels.openRating").replace("{n}", String(n));
  }

  didIWinLegacy(b: BattleSummary): boolean {
    return b.winnerUserId === this.myUserId;
  }

  // One league: share it straight away. Several: let the user pick which.
  // None: duels between friends need a league, so send them to create or join one.
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
