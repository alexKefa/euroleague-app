import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { RefereeDetail } from "../../core/models";
import { formatPlayerName } from "../../shared/player-name";
import { TeamCodePipe } from "../../shared/team-display-code";

// One referee (2026-10-06): their numbers vs the all-games average, then
// every team they've worked with that team's record and the foul split
// between it and its opponents. backend/src/services/refereeStats.ts.

@Component({
  selector: "app-referee-detail",
  standalone: true,
  imports: [CommonModule, RouterLink, TeamCodePipe],
  templateUrl: "./referee-detail.html",
})
export class RefereeDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  readonly data = signal<RefereeDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get("id");
    if (!id) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }
    this.api.getRefereeDetail(id).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  readonly name = computed(() => {
    const r = this.data()?.referee;
    return r ? formatPlayerName(r.name) : "";
  });

  readonly sinceText = computed(() => {
    const seasons = this.data()?.seasons ?? [];
    return seasons[seasons.length - 1] ?? "";
  });

  readonly tiles = computed(() => {
    const d = this.data();
    if (!d?.referee) return [];
    const r = d.referee;
    const l = d.league;
    return [
      { labelKey: "ref.colFouls", value: r.fouls.toFixed(1), avg: l.fouls.toFixed(1) },
      { labelKey: "ref.colFta", value: r.fta.toFixed(1), avg: l.fta.toFixed(1) },
      { labelKey: "ref.colHomeWin", value: `${Math.round(r.homeWinPct)}%`, avg: `${Math.round(l.homeWinPct)}%` },
      { labelKey: "ref.colFoulDiff", value: signed(r.foulDiff), avg: signed(l.foulDiff) },
    ];
  });

  gamesText(n: number): string {
    return n === 1 ? this.i18n.t("ref.gamesOne") : this.i18n.t("ref.gamesN").replace("{n}", String(n));
  }

  winPct(wins: number, games: number): number {
    return games > 0 ? (wins / games) * 100 : 0;
  }

  // Share of the game's fouls called on this team, for the split bar.
  foulShare(pf: number, oppPf: number): number {
    return pf + oppPf > 0 ? (pf / (pf + oppPf)) * 100 : 50;
  }

  ftaLine(fta: number, oppFta: number): string {
    return this.i18n.t("ref.ftaLine").replace("{a}", fta.toFixed(1)).replace("{b}", oppFta.toFixed(1));
  }
}

function signed(v: number): string {
  return v > 0.05 ? `+${v.toFixed(1)}` : v.toFixed(1);
}
