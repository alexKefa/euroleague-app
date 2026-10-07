import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { ApiService } from "../../core/api.service";
import { EventsService } from "../../core/events.service";
import { I18nService } from "../../core/i18n.service";
import { GameTeamSummary, GameWinProb, WinProbPoint, WinProbSwing } from "../../core/models";
import { formatPlayerName } from "../../shared/player-name";

const VB_W = 320;
const VB_H = 140;

/** Seconds played at a point; overtime periods are 5 minutes. */
function elapsed(p: { period: number; clock: number }): number {
  return p.period <= 4 ? (p.period - 1) * 600 + (600 - p.clock) : 2400 + (p.period - 5) * 300 + (300 - p.clock);
}

/**
 * Win-probability card on the game page (2026-10-07,
 * docs/superpowers/specs/2026-10-07-win-probability-design.md): the home
 * team's chance after every play, shaded in each team's colour above and
 * below 50%, quarter lines, the biggest swings, and tap/drag scrubbing.
 * Live games grow the chart with each score update.
 */
@Component({
  selector: "app-win-prob-card",
  standalone: true,
  template: `
    @if (data(); as d) {
      @if (d.pre) {
        <div class="bg-card rounded-2xl border border-line shadow-card p-4 mb-5">
          <p class="text-[12px] text-muted font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5">
            {{ i18n.t('winProb.title') }}
            @if (status() === 'live') {
              <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            }
          </p>

          @if (points().length < 2) {
            <!-- Before tip-off (or no play-by-play yet): just the pre-game chance. -->
            <div class="flex items-end justify-between gap-3 mt-2">
              <div>
                <p class="text-sm text-muted">{{ i18n.t('winProb.preGame') }}</p>
                <p class="font-display text-3xl leading-none tabular-nums mt-1">{{ favourite().code }} {{ favourite().pct }}%</p>
              </div>
              <p class="text-xs text-muted text-right">{{ d.pre.source === 'odds' ? i18n.t('winProb.fromOdds') : i18n.t('winProb.fromElo') }}</p>
            </div>
            <div class="mt-3 h-2 rounded-full overflow-hidden flex" role="img" [attr.aria-label]="favourite().code + ' ' + favourite().pct + '%'">
              <div class="h-full" [style.width.%]="d.pre.homeProb * 100" [style.background]="homeColor()"></div>
              <div class="h-full flex-1" [style.background]="awayColor()"></div>
            </div>
            @if (status() === 'final' && !d.fromPlayByPlay) {
              <p class="text-xs text-muted mt-3">{{ i18n.t('winProb.pending') }}</p>
            }
          } @else {
            <!-- Readout: the scrubbed point, or the latest one. -->
            @if (readout(); as r) {
              <div class="flex items-baseline justify-between gap-3 mb-2">
                <p class="text-sm font-semibold tabular-nums">{{ r.leader }} {{ r.pct }}%</p>
                <p class="text-xs text-muted tabular-nums">{{ r.time }} · {{ r.score }}</p>
              </div>
            }
            <svg
              [attr.viewBox]="'0 0 ' + vbW + ' ' + vbH"
              class="w-full h-auto touch-none select-none"
              role="img"
              [attr.aria-label]="summary()"
              (pointermove)="scrub($event)"
              (pointerdown)="scrub($event)"
              (pointerleave)="scrubIndex.set(null)"
            >
              <defs>
                <clipPath [attr.id]="clipId + '-top'"><rect x="0" y="0" [attr.width]="vbW" [attr.height]="vbH / 2" /></clipPath>
                <clipPath [attr.id]="clipId + '-bottom'"><rect x="0" [attr.y]="vbH / 2" [attr.width]="vbW" [attr.height]="vbH / 2" /></clipPath>
              </defs>
              <path [attr.d]="areaPath()" [attr.fill]="homeColor()" fill-opacity="0.28" [attr.clip-path]="'url(#' + clipId + '-top)'" />
              <path [attr.d]="areaPath()" [attr.fill]="awayColor()" fill-opacity="0.28" [attr.clip-path]="'url(#' + clipId + '-bottom)'" />
              @for (x of quarterLines(); track x) {
                <line [attr.x1]="x" [attr.x2]="x" y1="0" [attr.y2]="vbH" stroke="var(--color-line)" stroke-width="1" />
              }
              <line x1="0" [attr.x2]="vbW" [attr.y1]="vbH / 2" [attr.y2]="vbH / 2" stroke="var(--color-muted)" stroke-width="0.75" stroke-dasharray="3 3" />
              <path [attr.d]="linePath()" fill="none" stroke="var(--color-ink)" stroke-width="1.8" stroke-linejoin="round" />
              @for (m of swingMarks(); track $index) {
                <circle [attr.cx]="m.x" [attr.cy]="m.y" r="3.5" fill="var(--color-card)" stroke="var(--color-ink)" stroke-width="1.6" />
              }
              @if (scrubPoint(); as sp) {
                <line [attr.x1]="sp.x" [attr.x2]="sp.x" y1="0" [attr.y2]="vbH" stroke="var(--color-ink)" stroke-width="1" stroke-opacity="0.5" />
                <circle [attr.cx]="sp.x" [attr.cy]="sp.y" r="3.5" fill="var(--color-ink)" />
              }
              <text x="4" y="11" font-size="9" font-weight="600" [attr.fill]="'var(--color-muted)'">{{ home().code }}</text>
              <text x="4" [attr.y]="vbH - 4" font-size="9" font-weight="600" [attr.fill]="'var(--color-muted)'">{{ away().code }}</text>
            </svg>
            <p class="text-xs text-muted mt-2">
              {{ i18n.t('winProb.preGame') }}: {{ favourite().code }} {{ favourite().pct }}% · {{ d.pre.source === 'odds' ? i18n.t('winProb.fromOdds') : i18n.t('winProb.fromElo') }}
            </p>

            @if (swingRows().length) {
              <p class="text-sm font-semibold mt-4 mb-1">{{ i18n.t('winProb.biggestSwings') }}</p>
              <ul class="grid gap-1.5">
                @for (s of swingRows(); track $index) {
                  <li class="text-sm flex items-baseline gap-2">
                    <span class="text-xs text-muted tabular-nums shrink-0 w-14">{{ s.time }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ s.label }}</span>
                    <span class="tabular-nums font-semibold shrink-0">{{ s.change }}</span>
                  </li>
                }
              </ul>
            }
            @if (status() === 'final' && !d.fromPlayByPlay) {
              <p class="text-xs text-muted mt-3">{{ i18n.t('winProb.pending') }}</p>
            }
          }
        </div>
      }
    }
  `,
})
export class WinProbCardComponent {
  private api = inject(ApiService);
  private events = inject(EventsService);
  protected i18n = inject(I18nService);

  readonly gameId = input.required<string>();
  readonly status = input.required<string>();
  readonly home = input.required<GameTeamSummary>();
  readonly away = input.required<GameTeamSummary>();

  protected readonly vbW = VB_W;
  protected readonly vbH = VB_H;
  protected readonly clipId = `wp-${Math.random().toString(36).slice(2, 8)}`;

  protected readonly data = signal<GameWinProb | null>(null);
  private readonly livePoints = signal<WinProbPoint[]>([]);
  protected readonly scrubIndex = signal<number | null>(null);

  protected readonly homeColor = computed(() => this.home().primaryColor || "#2563eb");
  protected readonly awayColor = computed(() => this.away().primaryColor || "#dc2626");

  protected readonly points = computed<WinProbPoint[]>(() => {
    const base = this.data()?.points ?? [];
    const extra = this.livePoints();
    if (!extra.length) return base;
    // Only live points later than what the server already sent.
    const lastElapsed = base.length ? elapsed(base[base.length - 1]) : -1;
    return [...base, ...extra.filter((p) => elapsed(p) > lastElapsed)];
  });

  private readonly totalSeconds = computed(() => {
    const maxPeriod = Math.max(4, ...this.points().map((p) => p.period));
    return 2400 + (maxPeriod - 4) * 300;
  });

  private x(p: { period: number; clock: number }): number {
    return (elapsed(p) / this.totalSeconds()) * VB_W;
  }

  private y(homeProb: number): number {
    return (1 - homeProb) * VB_H;
  }

  protected readonly linePath = computed(() =>
    this.points()
      .map((p, i) => `${i ? "L" : "M"}${this.x(p).toFixed(1)},${this.y(p.homeProb).toFixed(1)}`)
      .join(" ")
  );

  protected readonly areaPath = computed(() => {
    const pts = this.points();
    if (!pts.length) return "";
    const mid = VB_H / 2;
    const first = this.x(pts[0]).toFixed(1);
    const last = this.x(pts[pts.length - 1]).toFixed(1);
    return `M${first},${mid} ` + pts.map((p) => `L${this.x(p).toFixed(1)},${this.y(p.homeProb).toFixed(1)}`).join(" ") + ` L${last},${mid} Z`;
  });

  protected readonly quarterLines = computed(() => {
    const lines: number[] = [];
    for (let s = 600; s < this.totalSeconds(); s += s < 2400 ? 600 : 300) lines.push((s / this.totalSeconds()) * VB_W);
    return lines;
  });

  private timeLabel(p: { period: number; clock: number }): string {
    const q = p.period <= 4 ? `Q${p.period}` : `${this.i18n.t("winProb.ot")}${p.period > 5 ? p.period - 4 : ""}`;
    return `${q} ${Math.floor(p.clock / 60)}:${String(p.clock % 60).padStart(2, "0")}`;
  }

  private leaderOf(homeProb: number): { code: string; pct: number } {
    return homeProb >= 0.5 ? { code: this.home().code, pct: Math.round(homeProb * 100) } : { code: this.away().code, pct: Math.round((1 - homeProb) * 100) };
  }

  protected readonly favourite = computed(() => this.leaderOf(this.data()?.pre?.homeProb ?? 0.5));

  protected readonly scrubPoint = computed(() => {
    const i = this.scrubIndex();
    const p = i === null ? null : this.points()[i];
    return p ? { x: this.x(p), y: this.y(p.homeProb) } : null;
  });

  protected readonly readout = computed(() => {
    const pts = this.points();
    const p = pts[this.scrubIndex() ?? pts.length - 1];
    if (!p) return null;
    const lead = this.leaderOf(p.homeProb);
    return { leader: lead.code, pct: lead.pct, time: this.timeLabel(p), score: `${p.homeScore}–${p.awayScore}` };
  });

  protected readonly swingMarks = computed(() => {
    const pts = this.points();
    return (this.data()?.swings ?? []).map((s) => {
      const match = pts.find((p) => p.period === s.period && p.clock === s.clock && Math.abs(p.homeProb - s.homeProbAfter) < 1e-3);
      const at = match ?? { period: s.period, clock: s.clock, homeProb: s.homeProbAfter };
      return { x: this.x(at), y: this.y(at.homeProb) };
    });
  });

  protected readonly swingRows = computed(() =>
    (this.data()?.swings ?? []).map((s: WinProbSwing) => {
      const forHome = s.teamId === this.home().id;
      const team = forHome ? this.home() : this.away();
      const before = Math.round((forHome ? s.homeProbBefore : 1 - s.homeProbBefore) * 100);
      const after = Math.round((forHome ? s.homeProbAfter : 1 - s.homeProbAfter) * 100);
      const play = this.i18n.t(`winProb.play.${s.playType}`);
      const who = s.playerName ? formatPlayerName(s.playerName) : team.code;
      return { time: this.timeLabel(s), label: `${who} ${play}`, change: `${team.code} ${before}% → ${after}%` };
    })
  );

  protected readonly summary = computed(() => {
    const pts = this.points();
    if (!pts.length) return this.i18n.t("winProb.title");
    let hi = pts[0];
    let lo = pts[0];
    for (const p of pts) {
      if (p.homeProb > hi.homeProb) hi = p;
      if (p.homeProb < lo.homeProb) lo = p;
    }
    const fill = (team: string, p: number, at: WinProbPoint) =>
      this.i18n.t("winProb.peak").replace("{team}", team).replace("{p}", String(p)).replace("{time}", this.timeLabel(at));
    return `${fill(this.home().code, Math.round(hi.homeProb * 100), hi)}. ${fill(this.away().code, Math.round((1 - lo.homeProb) * 100), lo)}.`;
  });

  constructor() {
    // (Re)load when the game or its status changes (e.g. live -> final).
    effect(() => {
      const id = this.gameId();
      this.status();
      untracked(() => {
        this.livePoints.set([]);
        this.api.getWinProb(id).subscribe({ next: (d) => this.data.set(d), error: () => this.data.set(null) });
      });
    });

    // Live: each score update for this game adds a point.
    effect(() => {
      const u = this.events.lastGameUpdate();
      if (!u || u.gameId !== untracked(() => this.gameId()) || u.status !== "live") return;
      if (u.homeWinProb === undefined || u.quarter === undefined || u.gameClockSeconds === undefined) return;
      const point: WinProbPoint = {
        period: u.quarter,
        clock: u.gameClockSeconds,
        s: u.quarter <= 4 ? (4 - u.quarter) * 600 + u.gameClockSeconds : u.gameClockSeconds,
        homeScore: u.homeScore,
        awayScore: u.awayScore,
        homeProb: u.homeWinProb,
      };
      untracked(() => this.livePoints.update((list) => [...list, point]));
    });
  }

  protected scrub(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const xVb = ((event.clientX - rect.left) / rect.width) * VB_W;
    const pts = this.points();
    let best = 0;
    let bestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(this.x(p) - xVb);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    this.scrubIndex.set(pts.length ? best : null);
  }
}
