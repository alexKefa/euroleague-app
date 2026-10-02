import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { NgClass } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { League } from "../../core/models";
import { PageHeaderComponent } from "../../shared/page-header";
import { NavIconComponent } from "../../shared/nav-icon";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { SkeletonComponent } from "../../shared/skeleton";
import { rankBadgeClasses } from "../../shared/rank-badge";

type Tab = "overall" | "round" | "league";

// One row shape for all three boards (overall, a round, a league).
interface BoardRow {
  userId: string;
  name: string;
  correct: number;
  total: number;
  points: number;
}

/**
 * Leaderboard page (2026-10-02). Until now the only board was a capped
 * five-row widget on Predictions. Overall, per-round and per-league boards,
 * a podium for the top three, and the viewer's own position pinned at the
 * bottom with a jump-to-row.
 */
@Component({
  selector: "app-leaderboard",
  standalone: true,
  imports: [NgClass, RouterLink, PageHeaderComponent, NavIconComponent, DropdownComponent, SkeletonComponent],
  templateUrl: "./leaderboard.html",
})
export class LeaderboardComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected readonly rankBadgeClasses = rankBadgeClasses;

  readonly tab = signal<Tab>("overall");
  readonly loading = signal(true);
  readonly rows = signal<BoardRow[]>([]);

  readonly rounds = signal<number[]>([]);
  readonly round = signal<number | null>(null);
  readonly roundOptions = computed<DropdownOption[]>(() =>
    [...this.rounds()].reverse().map((r) => ({ value: String(r), label: `${this.i18n.t("leaderboard.round")} ${r}` }))
  );

  readonly leagues = signal<League[]>([]);
  readonly leagueId = signal<string | null>(null);
  readonly leagueOptions = computed<DropdownOption[]>(() => this.leagues().map((l) => ({ value: l.id, label: l.name })));

  readonly podium = computed(() => (this.rows().length >= 3 ? this.rows().slice(0, 3) : []));
  readonly listRows = computed(() => (this.podium().length ? this.rows().slice(3) : this.rows()));

  readonly myIndex = computed(() => {
    const uid = this.auth.currentUser()?.id;
    return uid ? this.rows().findIndex((r) => r.userId === uid) : -1;
  });
  readonly me = computed(() => (this.myIndex() === -1 ? null : { row: this.rows()[this.myIndex()], rank: this.myIndex() + 1 }));

  ngOnInit(): void {
    this.api.getLeaderboardRounds().subscribe({
      next: (r) => {
        this.rounds.set(r.rounds);
        this.round.set(r.rounds.length ? r.rounds[r.rounds.length - 1] : null);
        if (this.tab() === "round") this.load();
      },
      error: () => {},
    });
    if (this.auth.isAuthenticated()) {
      this.api.getMyLeagues().subscribe({
        next: (rows) => {
          this.leagues.set(rows);
          if (rows.length) this.leagueId.set(rows[0].id);
          if (this.tab() === "league") this.load();
        },
        error: () => {},
      });
    }
    this.load();
  }

  setTab(tab: Tab): void {
    if (this.tab() === tab) return;
    this.tab.set(tab);
    this.load();
  }

  setRound(value: string | null): void {
    if (!value) return;
    this.round.set(Number(value));
    this.load();
  }

  setLeague(value: string | null): void {
    if (!value) return;
    this.leagueId.set(value);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const done = (rows: BoardRow[]) => {
      this.rows.set(rows);
      this.loading.set(false);
    };
    const fail = () => done([]);
    const tab = this.tab();
    if (tab === "overall") {
      this.api.getLeaderboard(true).subscribe({
        next: (rows) => done(rows.map((r) => ({ userId: r.userId, name: r.displayName, correct: r.correct, total: r.total, points: r.points }))),
        error: fail,
      });
    } else if (tab === "round") {
      const round = this.round();
      if (round === null) return done([]);
      this.api.getRoundLeaderboard(round).subscribe({
        next: (rows) => done(rows.map((r) => ({ userId: r.userId, name: r.displayName, correct: r.correct, total: r.total, points: r.points }))),
        error: fail,
      });
    } else {
      const id = this.leagueId();
      if (!id) return done([]);
      this.api.getLeagueLeaderboard(id).subscribe({
        next: (rows) => done(rows.map((r) => ({ userId: r.userId, name: r.displayName, correct: r.correct, total: r.total, points: r.points }))),
        error: fail,
      });
    }
  }

  scrollToMe(): void {
    const uid = this.auth.currentUser()?.id;
    if (!uid) return;
    document.getElementById(`lb-${uid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  tabClass(tab: Tab): string {
    return this.tab() === tab ? "bg-team-primary text-team-secondary shadow-sm" : "text-muted hover:text-ink";
  }

  // Podium order on screen: 2nd, 1st, 3rd.
  podiumSlots(): { row: BoardRow; place: number }[] {
    const p = this.podium();
    return p.length === 3 ? [{ row: p[1], place: 2 }, { row: p[0], place: 1 }, { row: p[2], place: 3 }] : [];
  }

  initial(name: string): string {
    return name.charAt(0).toUpperCase();
  }
}
