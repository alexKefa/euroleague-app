import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { AnalyticsPlayer, PlayerRestLine, ShotZone, TeamAnalytics, TeamRestRow, TeamRestSplits, TeamReferees } from "../../core/models";
import { formatPlayerName } from "../../shared/player-name";

// Team page analytics (2026-10-06): shot profile vs league, most-used
// lineups, on/off, clutch. Data from GET /teams/:id/analytics, built from
// play-by-play (backend/src/services/teamAnalytics.ts).

const ZONE_ORDER: ShotZone[] = ["rim", "paint", "mid", "corner3", "above3"];
// On/off needs real minutes both ways or the "off" side is noise.
const ON_OFF_MIN_SECONDS = 300;
// Under this many games every number here swings wildly; say so.
const SMALL_SAMPLE_GAMES = 5;

function rating(pts: number, poss: number): number | null {
  return poss > 0 ? (pts / poss) * 100 : null;
}

function netRating(ptsFor: number, possFor: number, ptsAgainst: number, possAgainst: number): number | null {
  const o = rating(ptsFor, possFor);
  const d = rating(ptsAgainst, possAgainst);
  return o == null || d == null ? null : o - d;
}

@Component({
  selector: "app-team-analytics",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./team-analytics.html",
})
export class TeamAnalyticsComponent {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly teamId = input.required<string>();

  readonly data = signal<TeamAnalytics | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);

  constructor() {
    effect(() => {
      const id = this.teamId();
      untracked(() => this.load(id));
    });
  }

  private load(teamId: string): void {
    // Rest splits are their own request: a separate, optional card.
    this.rest.set(null);
    this.api.getTeamRestSplits(teamId).subscribe({ next: (r) => this.rest.set(r), error: () => {} });
    this.referees.set(null);
    this.api.getTeamReferees(teamId).subscribe({ next: (r) => this.referees.set(r), error: () => {} });
    this.loading.set(true);
    this.error.set(false);
    this.api.getTeamAnalytics(teamId).subscribe({
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

  readonly basedOnText = computed(() => {
    const n = this.data()?.gamesWithData ?? 0;
    return n === 1 ? this.i18n.t("ta.basedOnOne") : this.i18n.t("ta.basedOn").replace("{n}", String(n));
  });

  readonly smallSample = computed(() => (this.data()?.gamesWithData ?? 0) < SMALL_SAMPLE_GAMES);

  readonly zones = computed(() => {
    const d = this.data();
    if (!d) return [];
    const teamFga = d.shotZones.reduce((t, z) => t + z.fga, 0);
    const leagueFga = d.shotZones.reduce((t, z) => t + z.leagueFga, 0);
    if (teamFga === 0) return [];
    return ZONE_ORDER.map((zone) => {
      const z = d.shotZones.find((s) => s.zone === zone) ?? { zone, fga: 0, fgm: 0, leagueFga: 0, leagueFgm: 0 };
      const fgPct = z.fga > 0 ? (z.fgm / z.fga) * 100 : null;
      const leagueFgPct = z.leagueFga > 0 ? (z.leagueFgm / z.leagueFga) * 100 : null;
      return {
        zone,
        fga: z.fga,
        fgm: z.fgm,
        share: (z.fga / teamFga) * 100,
        leagueShare: leagueFga > 0 ? (z.leagueFga / leagueFga) * 100 : 0,
        fgPct,
        leagueFgPct,
        above: fgPct != null && leagueFgPct != null && fgPct >= leagueFgPct,
      };
    });
  });

  readonly lineups = computed(() =>
    (this.data()?.lineups ?? []).map((l) => ({
      ...l,
      key: l.players.map((p) => p.code).join("-"),
      plusMinus: l.ptsFor - l.ptsAgainst,
      net: netRating(l.ptsFor, l.possFor, l.ptsAgainst, l.possAgainst),
    }))
  );

  readonly onOff = computed(() =>
    (this.data()?.onOff ?? [])
      .filter((o) => o.secondsOn >= ON_OFF_MIN_SECONDS && o.secondsOff >= ON_OFF_MIN_SECONDS)
      .map((o) => {
        const on = netRating(o.ptsForOn, o.possForOn, o.ptsAgainstOn, o.possAgainstOn);
        const off = netRating(o.ptsForOff, o.possForOff, o.ptsAgainstOff, o.possAgainstOff);
        return { ...o, on, off, diff: on != null && off != null ? on - off : null };
      })
  );

  readonly clutch = computed(() => this.data()?.clutch ?? null);

  // This team with each referee (2026-10-06), see backend/src/services/refereeStats.ts.
  // Pairings with a single game are left out; they say nothing.
  readonly referees = signal<TeamReferees | null>(null);
  readonly refsExpanded = signal(false);
  readonly refRows = computed(() => (this.referees()?.referees ?? []).filter((r) => r.games >= 2));
  readonly visibleRefRows = computed(() => (this.refsExpanded() ? this.refRows() : this.refRows().slice(0, 6)));
  readonly refSince = computed(() => {
    const seasons = this.referees()?.seasons ?? [];
    return seasons[seasons.length - 1] ?? "";
  });

  refName(name: string): string {
    return formatPlayerName(name);
  }

  winShare(wins: number, games: number): number {
    return games > 0 ? (wins / games) * 100 : 0;
  }

  foulShare(pf: number, oppPf: number): number {
    return pf + oppPf > 0 ? (pf / (pf + oppPf)) * 100 : 50;
  }

  // Short-rest splits (2026-10-06), see backend/src/services/restSplits.ts.
  readonly rest = signal<TeamRestSplits | null>(null);
  readonly restSince = computed(() => {
    const seasons = this.rest()?.seasons ?? [];
    return seasons[seasons.length - 1] ?? "";
  });
  private restRow(key: TeamRestRow["key"]): TeamRestRow | null {
    return this.rest()?.rows.find((r) => r.key === key) ?? null;
  }
  readonly restBuckets = computed(() => (["short", "normal"] as const).map((k) => ({ key: k, row: this.restRow(k) })).filter((r) => r.row));
  readonly restMatchups = computed(() =>
    (["edge", "disadvantage", "bothShort"] as const).map((k) => ({ key: k, row: this.restRow(k) })).filter((r) => r.row)
  );
  readonly restPlayers = computed(() =>
    (this.rest()?.players ?? [])
      .filter((p) => p.short && p.normal)
      .map((p) => ({ ...p, ptsDiff: p.short!.pts - p.normal!.pts, pirDiff: p.short!.pir - p.normal!.pir }))
  );

  restMargin(r: TeamRestRow): number {
    return r.ptsFor - r.ptsAgainst;
  }

  restLineName(p: { name: string }): string {
    return formatPlayerName(p.name);
  }

  restFgPct(l: PlayerRestLine): string {
    return l.fga > 0 ? `${Math.round((l.fgm / l.fga) * 100)}%` : "–";
  }

  surname(p: AnalyticsPlayer): string {
    if (!p.name) return p.code;
    const full = formatPlayerName(p.name);
    const comma = p.name.indexOf(",");
    return comma === -1 ? full : full.split(" ").slice(-p.name.slice(0, comma).trim().split(/\s+/).length).join(" ");
  }

  fullName(p: AnalyticsPlayer): string {
    return p.name ? formatPlayerName(p.name) : p.code;
  }

  minutes(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  signed(value: number | null, digits = 1): string {
    if (value == null) return "–";
    const rounded = Number(value.toFixed(digits));
    return rounded > 0 ? `+${rounded.toFixed(digits)}` : rounded.toFixed(digits);
  }

  pct(value: number | null): string {
    return value == null ? "–" : `${Math.round(value)}%`;
  }

  signClass(value: number | null): string {
    if (value == null || Math.abs(value) < 0.05) return "text-muted";
    return value > 0 ? "text-emerald-500" : "text-red-500";
  }
}
