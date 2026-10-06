import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { RefereeRow, RefereeStats } from "../../core/models";
import { PageHeaderComponent } from "../../shared/page-header";
import { ChipDirective } from "../../shared/chip.directive";
import { formatPlayerName } from "../../shared/player-name";

// Referee tracker (2026-10-06): per-referee game numbers over the last two
// seasons, next to the all-games average. backend/src/services/refereeStats.ts.
// Neutral on purpose: plain numbers vs average, no "favours home" labels.
// ?ref=<id> (from a game page's crew) highlights that referee's row.

type SortKey = "games" | "fouls" | "fta" | "homeWinPct" | "foulDiff" | "ftaDiff";
const MIN_GAMES = 10;

@Component({
  selector: "app-referees",
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent, ChipDirective],
  templateUrl: "./referees.html",
})
export class RefereesComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  readonly data = signal<RefereeStats | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly sortKey = signal<SortKey>("games");
  readonly sortDesc = signal(true);
  readonly onlyRegulars = signal(true);
  readonly highlightId = signal<string | null>(null);

  readonly columns: { key: SortKey; labelKey: string }[] = [
    { key: "games", labelKey: "ref.colGp" },
    { key: "fouls", labelKey: "ref.colFouls" },
    { key: "fta", labelKey: "ref.colFta" },
    { key: "homeWinPct", labelKey: "ref.colHomeWin" },
    { key: "foulDiff", labelKey: "ref.colFoulDiff" },
    { key: "ftaDiff", labelKey: "ref.colFtaDiff" },
  ];

  ngOnInit(): void {
    const ref = this.route.snapshot.queryParamMap.get("ref");
    if (ref) {
      this.highlightId.set(ref);
      this.onlyRegulars.set(false);
    }
    this.api.getRefereeStats().subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
        if (ref) setTimeout(() => document.getElementById(`ref-${ref}`)?.scrollIntoView({ block: "center" }));
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  readonly sinceText = computed(() => {
    const seasons = this.data()?.seasons ?? [];
    return seasons[seasons.length - 1] ?? "";
  });

  readonly rows = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDesc() ? -1 : 1;
    return (this.data()?.referees ?? [])
      .filter((r) => !this.onlyRegulars() || r.games >= MIN_GAMES || r.id === this.highlightId())
      .sort((a, b) => (a[key] - b[key]) * dir || a.name.localeCompare(b.name));
  });

  sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDesc.set(!this.sortDesc());
    else {
      this.sortKey.set(key);
      this.sortDesc.set(true);
    }
  }

  name(r: RefereeRow): string {
    return formatPlayerName(r.name);
  }

  value(key: SortKey, v: number): string {
    if (key === "games") return String(v);
    if (key === "homeWinPct") return `${Math.round(v)}%`;
    if (key === "foulDiff" || key === "ftaDiff") return v > 0.05 ? `+${v.toFixed(1)}` : v.toFixed(1);
    return v.toFixed(1);
  }

  // How far a referee's number is from the all-games average, for a subtle
  // tint only on clearly unusual values (more than ~10% of the average
  // away, or 2+ on the home-away differences).
  unusual(key: SortKey, v: number): boolean {
    const league = this.data()?.league;
    if (!league || key === "games") return false;
    const avg = league[key];
    if (key === "foulDiff" || key === "ftaDiff") return Math.abs(v - avg) >= 2;
    if (key === "homeWinPct") return Math.abs(v - avg) >= 15;
    return avg > 0 && Math.abs(v - avg) / avg >= 0.1;
  }
}
