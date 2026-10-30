import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { DatePipe } from "@angular/common";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { GameTeamSummary, MatchupDuelPlayer, MatchupEdgeRow, MatchupPreview, MatchupTeamForm } from "../../core/models";
import { NavIconComponent } from "../../shared/nav-icon";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { formatPlayerName } from "../../shared/player-name";
import { TeamCodePipe, displayTeamCode } from "../../shared/team-display-code";
import { injuryNoteFor, injuryStatusClass, injuryStatusLabel } from "../../shared/injury-status";

const LOWER_IS_BETTER = new Set(["defRating", "tovPg"]);

/**
 * Matchup preview on the game page (2026-10-09,
 * docs/superpowers/specs/2026-10-09-matchup-preview-design.md): form and
 * head-to-head, availability (injuries + short rest), and key matchups
 * (stat edges + key battle). Only rendered before tipoff; hides itself if
 * the request fails or the game has started.
 */
@Component({
  selector: "app-matchup-preview",
  standalone: true,
  imports: [DatePipe, NavIconComponent, PlayerPhotoComponent, TeamCodePipe],
  template: `
    @if (loading()) {
      <div class="bg-card rounded-3xl border border-line shadow-card p-4 mb-5 animate-pulse" aria-hidden="true">
        <div class="h-5 w-40 rounded bg-line mb-4"></div>
        <div class="h-24 rounded-xl bg-line/60 mb-3"></div>
        <div class="h-24 rounded-xl bg-line/60"></div>
      </div>
    } @else if (preview(); as p) {
      <div class="bg-card rounded-3xl border border-line shadow-card p-4 mb-5">
        <div class="card-head">
          <span class="card-head-icon"><app-nav-icon name="compass" [size]="18" /></span>
          <p class="font-display text-base flex-1 min-w-0 truncate">{{ i18n.t('matchup.title') }}</p>
        </div>

        <!-- 1. Form & head-to-head -->
        <p class="text-[12px] text-muted font-bold uppercase tracking-wider mb-2">{{ i18n.t('matchup.formH2h') }}</p>
        <div class="space-y-2 mb-3">
          @for (side of sides(); track side.team.id) {
            <div class="flex items-center gap-2 min-w-0">
              <span class="font-display text-sm w-10 shrink-0" [style.color]="side.color">{{ side.team.code | teamCode }}</span>
              @if (side.form.games.length === 0) {
                <span class="text-xs text-muted">{{ i18n.t('matchup.noGamesYet') }}</span>
              } @else {
                <div class="flex gap-1 min-w-0">
                  @for (g of formOldestFirst(side.form); track g.gameId) {
                    <span
                      class="w-7 h-7 rounded-lg flex flex-col items-center justify-center text-[10px] font-bold leading-none border"
                      [style.background]="g.won ? side.color : null"
                      [class.text-white]="g.won"
                      [class.border-transparent]="g.won"
                      [class.border-line]="!g.won"
                      [class.text-muted]="!g.won"
                      [attr.title]="(g.isHome ? 'vs ' : '@ ') + (g.opponent.code | teamCode) + ' ' + g.teamScore + '-' + g.opponentScore"
                    >
                      {{ g.won ? 'W' : 'L' }}
                      <span class="text-[8px] font-semibold opacity-80 mt-0.5">{{ g.opponent.code | teamCode }}</span>
                    </span>
                  }
                </div>
                @if (side.form.streak) {
                  <span class="ml-auto shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-page border border-line tabular-nums" [attr.title]="i18n.t('matchup.streak')">
                    {{ side.form.streak }}
                  </span>
                }
              }
            </div>
          }
        </div>
        <div class="rounded-xl bg-page border border-line px-3 py-2 mb-5">
          <p class="text-sm font-semibold">{{ h2hSummary() }}</p>
          @if (p.h2h.games.length > 0) {
            <ul class="mt-1.5 space-y-1">
              @for (m of p.h2h.games; track m.gameId) {
                <li class="flex items-center justify-between gap-2 text-xs text-muted tabular-nums">
                  <span>{{ m.tipoffAt | date: 'd MMM yy' : 'Europe/Athens' : dateLocale() }}</span>
                  <span>
                    <span [class.font-bold]="m.winnerTeamId === m.homeTeamId" [class.text-ink]="m.winnerTeamId === m.homeTeamId">{{ codeOf(m.homeTeamId) }} {{ m.homeScore }}</span>
                    –
                    <span [class.font-bold]="m.winnerTeamId !== m.homeTeamId" [class.text-ink]="m.winnerTeamId !== m.homeTeamId">{{ m.awayScore }} {{ codeOf(otherTeam(m.homeTeamId)) }}</span>
                  </span>
                </li>
              }
            </ul>
          }
        </div>

        <!-- 2. Availability -->
        <p class="text-[12px] text-muted font-bold uppercase tracking-wider mb-2">{{ i18n.t('matchup.availability') }}</p>
        @if (restBanner(); as banner) {
          <p class="text-xs font-semibold rounded-xl px-3 py-2 mb-2 bg-amber-500/10 text-amber-600 border border-amber-500/30">{{ banner }}</p>
        }
        @if (fullStrength()) {
          <p class="text-sm text-muted mb-5">{{ i18n.t('matchup.fullStrength') }}</p>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            @for (side of sides(); track side.team.id) {
              <div class="min-w-0">
                <p class="text-xs font-bold mb-1.5" [style.color]="side.color">{{ side.team.name }}</p>
                @if (side.injured.length === 0) {
                  <p class="text-xs text-muted">{{ i18n.t('matchup.noInjuries') }}</p>
                } @else {
                  <ul class="space-y-1.5">
                    @for (inj of side.injured; track inj.playerId) {
                      <li class="flex items-center gap-2 min-w-0">
                        <app-player-photo [name]="inj.name" [photoUrl]="inj.photoUrl" [teamCode]="side.team.code" [primaryColor]="side.team.primaryColor" [size]="28" class="rounded-full block shrink-0" />
                        <div class="min-w-0 flex-1">
                          <p class="text-sm truncate">{{ playerName(inj.name) }}</p>
                          @if (noteFor(inj.note, inj.noteEl); as note) {
                            <p class="text-[11px] text-muted truncate">{{ note }}</p>
                          }
                        </div>
                        <span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border" [class]="statusClass(inj.status)">{{ statusLabel(inj.status) }}</span>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </div>
        }

        <!-- 3. Key matchups -->
        <div class="flex items-center gap-2 mb-2">
          <p class="text-[12px] text-muted font-bold uppercase tracking-wider">{{ i18n.t('matchup.keyMatchups') }}</p>
          @if (p.usingPriorSeason) {
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-page border border-line text-muted">{{ i18n.t('matchup.lastSeason') }}</span>
          }
        </div>
        <div class="space-y-2.5">
          @for (e of p.edges; track e.key) {
            <div>
              <div class="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                <span [class.font-bold]="e.better === 'home'" [class.text-muted]="e.better !== 'home'">{{ fmt(e.home) }}</span>
                <span class="text-muted text-[11px] uppercase tracking-wide text-center">{{ i18n.t('matchup.stat.' + e.key) }}</span>
                <span [class.font-bold]="e.better === 'away'" [class.text-muted]="e.better !== 'away'">{{ fmt(e.away) }}</span>
              </div>
              <div class="mt-1 h-1.5 rounded-full overflow-hidden flex bg-line">
                <div class="h-full" [style.width.%]="homeShare(e)" [style.background]="e.better === 'home' ? homeColor() : 'var(--color-muted)'" [style.opacity]="e.better === 'home' ? 1 : 0.35"></div>
                <div class="h-full flex-1" [style.background]="e.better === 'away' ? awayColor() : 'var(--color-muted)'" [style.opacity]="e.better === 'away' ? 1 : 0.35"></div>
              </div>
            </div>
          }
        </div>

        @if (p.keyBattle; as kb) {
          <p class="text-[12px] text-muted font-bold uppercase tracking-wider mt-5 mb-2">{{ i18n.t('matchup.keyBattle') }}</p>
          <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            @for (duel of [{ p: kb.home, team: home() }]; track duel.p.playerId) {
              <div class="flex flex-col items-center text-center min-w-0">
                <app-player-photo [name]="duel.p.name" [photoUrl]="duel.p.photoUrl" [teamCode]="duel.team.code" [primaryColor]="duel.team.primaryColor" [size]="56" class="rounded-full block" />
                <p class="text-xs font-bold mt-1 w-full truncate">{{ playerName(duel.p.name) }}</p>
              </div>
            }
            <div class="space-y-1 text-[11px] tabular-nums">
              @for (s of duelStats(kb.home, kb.away); track s.label) {
                <div class="grid grid-cols-[2.5rem_2.5rem_2.5rem] items-center text-center">
                  <span [class.font-bold]="s.home > s.away" [class.text-muted]="s.home <= s.away">{{ s.home }}</span>
                  <span class="text-muted">{{ s.label }}</span>
                  <span [class.font-bold]="s.away > s.home" [class.text-muted]="s.away <= s.home">{{ s.away }}</span>
                </div>
              }
            </div>
            @for (duel of [{ p: kb.away, team: away() }]; track duel.p.playerId) {
              <div class="flex flex-col items-center text-center min-w-0">
                <app-player-photo [name]="duel.p.name" [photoUrl]="duel.p.photoUrl" [teamCode]="duel.team.code" [primaryColor]="duel.team.primaryColor" [size]="56" class="rounded-full block" />
                <p class="text-xs font-bold mt-1 w-full truncate">{{ playerName(duel.p.name) }}</p>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class MatchupPreviewComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(I18nService);

  readonly gameId = input.required<string>();
  readonly home = input.required<GameTeamSummary>();
  readonly away = input.required<GameTeamSummary>();

  protected readonly loading = signal(true);
  protected readonly preview = signal<MatchupPreview | null>(null);

  protected readonly homeColor = computed(() => this.home().primaryColor || "#2563eb");
  protected readonly awayColor = computed(() => this.away().primaryColor || "#dc2626");
  protected readonly dateLocale = computed(() => (this.i18n.lang() === "el" ? "el" : "en"));

  protected readonly sides = computed(() => {
    const p = this.preview();
    if (!p) return [];
    return [
      { team: this.home(), color: this.homeColor(), form: p.form.home, injured: p.availability.home.injured },
      { team: this.away(), color: this.awayColor(), form: p.form.away, injured: p.availability.away.injured },
    ];
  });

  protected readonly h2hSummary = computed(() => {
    const p = this.preview();
    if (!p) return "";
    const { homeWins: h, awayWins: a } = p.h2h;
    if (p.h2h.games.length === 0) return this.i18n.t("matchup.firstMeeting");
    if (h === a) return this.fill("matchup.tied", { a: h, b: a });
    const leader = displayTeamCode(h > a ? this.home().code : this.away().code);
    return this.fill("matchup.leads", { team: leader, a: Math.max(h, a), b: Math.min(h, a) });
  });

  protected readonly restBanner = computed(() => {
    const p = this.preview();
    if (!p) return null;
    const h = p.availability.home;
    const a = p.availability.away;
    if (h.shortRest && a.shortRest) return this.i18n.t("matchup.bothShortRest");
    if (!h.shortRest && !a.shortRest) return null;
    const [rested, tired, days] = h.shortRest ? [this.away(), this.home(), h.restDays] : [this.home(), this.away(), a.restDays];
    const played =
      days === 1 ? this.fill("matchup.playedYesterday", { team: displayTeamCode(tired.code) }) : this.fill("matchup.playedDaysAgo", { team: displayTeamCode(tired.code), n: days ?? 0 });
    return `${this.fill("matchup.restEdge", { team: displayTeamCode(rested.code) })} · ${played}`;
  });

  protected readonly fullStrength = computed(() => {
    const p = this.preview();
    return !!p && p.availability.home.injured.length === 0 && p.availability.away.injured.length === 0 && !this.restBanner();
  });

  constructor() {
    effect(() => {
      const id = this.gameId();
      untracked(() => {
        this.loading.set(true);
        this.api.getMatchupPreview(id).subscribe({
          next: (r) => {
            this.preview.set(r.available ? r : null);
            this.loading.set(false);
          },
          error: () => {
            this.preview.set(null);
            this.loading.set(false);
          },
        });
      });
    });
  }

  protected formOldestFirst(form: MatchupTeamForm) {
    return [...form.games].reverse();
  }

  protected codeOf(teamId: string): string {
    return displayTeamCode(teamId === this.home().id ? this.home().code : teamId === this.away().id ? this.away().code : "");
  }

  protected otherTeam(teamId: string): string {
    return teamId === this.home().id ? this.away().id : this.home().id;
  }

  protected fmt(v: number | null): string {
    return v === null ? "—" : String(v);
  }

  /** Home side's share of the bar; lower-is-better stats are inverted. */
  protected homeShare(e: MatchupEdgeRow): number {
    if (e.home === null || e.away === null || e.home + e.away <= 0) return 50;
    const share = e.home / (e.home + e.away);
    return (LOWER_IS_BETTER.has(e.key) ? 1 - share : share) * 100;
  }

  protected duelStats(h: MatchupDuelPlayer, a: MatchupDuelPlayer) {
    return [
      { label: this.i18n.t("game.colPTS"), home: h.pts, away: a.pts },
      { label: this.i18n.t("game.colREB"), home: h.reb, away: a.reb },
      { label: this.i18n.t("game.colAST"), home: h.ast, away: a.ast },
      { label: this.i18n.t("game.colPIR"), home: h.pir, away: a.pir },
    ];
  }

  protected playerName(name: string): string {
    return formatPlayerName(name);
  }

  protected noteFor(note: string | null, noteEl: string | null): string | null {
    return injuryNoteFor(this.i18n, note, noteEl);
  }

  protected statusClass = injuryStatusClass;

  protected statusLabel(status: MatchupPreview["availability"]["home"]["injured"][number]["status"]): string {
    return injuryStatusLabel(this.i18n, status);
  }

  private fill(key: string, vars: Record<string, string | number>): string {
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), this.i18n.t(key));
  }
}
