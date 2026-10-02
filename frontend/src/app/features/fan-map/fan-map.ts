import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { TeamFan, TeamFanCount } from "../../core/models";
import { PageHeaderComponent } from "../../shared/page-header";
import { DialogComponent } from "../../shared/dialog";
import { SkeletonComponent } from "../../shared/skeleton";
import { NavIconComponent } from "../../shared/nav-icon";
import { TeamCodePipe } from "../../shared/team-display-code";
import { BORDERS_PATH, LAND_PATH, MAP_VIEWBOX, TEAM_CITY_POINTS } from "./europe-geo";

// Isometric block geometry, in map viewBox units.
const HALF_W = 13; // half the block's width
const HALF_D = 7; // half its depth (the iso "squash")
const MIN_H = 5; // a team with no fans is a flat tile
const MAX_H = 70; // the biggest fan base
const CITY_SPACING = 30; // clubs sharing a city sit side by side
// Dubai is far east of the fitted map extent: drawn as an inset in the
// empty top-right corner (over Russia, where no club sits).
const INSET = { x: 930, y: 104 };

interface Block {
  team: TeamFanCount;
  x: number;
  y: number;
  h: number;
  inset: boolean;
}

/**
 * Fan map (2026-10-02): every EuroLeague club as a little isometric "Lego"
 * block on a map of Europe, as tall as its fan base (users who picked it as
 * their favourite team). A location map would put nearly everyone in
 * Greece; by team, the map spreads across the league's cities instead.
 * Tap a block or a row to see that team's fans.
 */
@Component({
  selector: "app-fan-map",
  standalone: true,
  imports: [RouterLink, PageHeaderComponent, DialogComponent, SkeletonComponent, NavIconComponent, TeamCodePipe],
  templateUrl: "./fan-map.html",
})
export class FanMapComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  protected readonly viewBox = MAP_VIEWBOX;
  protected readonly landPath = LAND_PATH;
  protected readonly bordersPath = BORDERS_PATH;
  protected readonly inset = INSET;

  readonly loading = signal(true);
  readonly teams = signal<TeamFanCount[]>([]);
  readonly totalFans = computed(() => this.teams().reduce((sum, t) => sum + t.fans, 0));
  readonly myTeamId = computed(() => this.auth.currentUser()?.favoriteTeamId ?? null);

  // Ranked fan bases (the list under the map; also the mobile-friendly way in).
  readonly ranked = computed(() => [...this.teams()].sort((a, b) => b.fans - a.fans || a.name.localeCompare(b.name)));
  readonly maxFans = computed(() => Math.max(1, ...this.teams().map((t) => t.fans)));

  readonly myRank = computed(() => {
    const id = this.myTeamId();
    const i = this.ranked().findIndex((t) => t.id === id);
    return i === -1 ? null : { team: this.ranked()[i], rank: i + 1 };
  });

  // Blocks in back-to-front order (by y), so nearer blocks overlap farther ones.
  readonly blocks = computed<Block[]>(() => {
    const max = this.maxFans();
    const height = (fans: number) => (fans === 0 ? MIN_H : MIN_H + (MAX_H - MIN_H) * Math.sqrt(fans / max));
    // Cluster by distance, not city name: Piraeus and Athens are one spot
    // at this scale, as are Istanbul's three clubs.
    const clusters: { x: number; y: number; teams: TeamFanCount[] }[] = [];
    const out: Block[] = [];
    for (const t of this.teams()) {
      const p = TEAM_CITY_POINTS[t.code];
      if (!p) {
        if (t.code === "DUB") out.push({ team: t, x: INSET.x, y: INSET.y, h: height(t.fans), inset: true });
        continue;
      }
      const near = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 15);
      if (near) near.teams.push(t);
      else clusters.push({ x: p.x, y: p.y, teams: [t] });
    }
    for (const { teams: list } of clusters) {
      list.sort((a, b) => a.code.localeCompare(b.code));
      // Anchor at the first club's point; clubs sharing a city fan out.
      const base = TEAM_CITY_POINTS[list[0].code];
      list.forEach((t, i) => {
        const offset = (i - (list.length - 1) / 2) * CITY_SPACING;
        out.push({ team: t, x: base.x + offset, y: base.y + offset * 0.3, h: height(t.fans), inset: false });
      });
    }
    return out.sort((a, b) => a.y - b.y);
  });

  // Sheet for one team's fans.
  readonly openTeam = signal<TeamFanCount | null>(null);
  readonly fans = signal<TeamFan[]>([]);
  readonly fansLoading = signal(false);

  ngOnInit(): void {
    this.api.getTeamFanCounts().subscribe({
      next: (rows) => {
        this.teams.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  open(team: TeamFanCount): void {
    this.openTeam.set(team);
    this.fans.set([]);
    if (team.fans === 0) return;
    this.fansLoading.set(true);
    this.api.getTeamFans(team.id).subscribe({
      next: (rows) => {
        if (this.openTeam()?.id === team.id) this.fans.set(rows);
        this.fansLoading.set(false);
      },
      error: () => this.fansLoading.set(false),
    });
  }

  close(): void {
    this.openTeam.set(null);
  }

  // ── Block geometry ───────────────────────────────────────────────────
  left(b: Block): string {
    return this.pts([[b.x - HALF_W, b.y], [b.x, b.y + HALF_D], [b.x, b.y + HALF_D - b.h], [b.x - HALF_W, b.y - b.h]]);
  }
  right(b: Block): string {
    return this.pts([[b.x, b.y + HALF_D], [b.x + HALF_W, b.y], [b.x + HALF_W, b.y - b.h], [b.x, b.y + HALF_D - b.h]]);
  }
  top(b: Block): string {
    return this.pts([[b.x, b.y - HALF_D - b.h], [b.x + HALF_W, b.y - b.h], [b.x, b.y + HALF_D - b.h], [b.x - HALF_W, b.y - b.h]]);
  }
  private pts(p: number[][]): string {
    return p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  }

  color(team: TeamFanCount): string {
    return team.primaryColor ?? "#8a8a86";
  }
  shade(team: TeamFanCount, mix: "black" | "white", pct: number): string {
    return `color-mix(in srgb, ${this.color(team)} ${100 - pct}%, ${mix})`;
  }

  barWidth(team: TeamFanCount): number {
    return team.fans === 0 ? 0 : Math.max(4, (team.fans / this.maxFans()) * 100);
  }

  initial(name: string): string {
    return name.charAt(0).toUpperCase();
  }
}
