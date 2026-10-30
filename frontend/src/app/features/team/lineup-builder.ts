import { Component, ElementRef, computed, inject, input, signal } from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { catchError, map, of, scan, startWith, switchMap } from "rxjs";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { AnalyticsPlayer, LineupBuilderResult } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { formatPlayerName } from "../../shared/player-name";
import { defRating, netRating, offRating, pace } from "./lineup-math";

const MAX_PICK = 5;
const SMALL_SAMPLE_SECONDS = 1200;

type LoadState = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ok"; result: LineupBuilderResult };
type ViewState = { status: LoadState["status"]; result: LineupBuilderResult | null };

/**
 * Lineup builder (2026-10-09, docs/superpowers/specs/2026-10-09-lineup-builder-design.md):
 * pick 2-5 of this team's players to see how they did together this season,
 * how the team did otherwise, and which teammate makes the group best.
 */
@Component({
  selector: "app-lineup-builder",
  standalone: true,
  // Block host so "Open in builder" can scroll to it; the margin keeps the
  // card's title clear of the sticky top bar.
  host: { class: "block scroll-mt-24" },
  imports: [ButtonDirective, PlayerPhotoComponent],
  template: `
    <div class="bg-card rounded-3xl border border-line shadow-card p-4 mb-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-display text-base">{{ i18n.t('ta.builderTitle') }}</p>
          <p class="text-[12px] text-muted">{{ i18n.t('ta.builderHint') }}</p>
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <span class="text-[12px] font-mono text-muted tabular-nums">{{ i18n.t('ta.pickCount').replace('{n}', '' + selection().length) }}</span>
          @if (selection().length > 0) {
            <button type="button" appButton="outline" appButtonSize="sm" (click)="clear()">{{ i18n.t('ta.clear') }}</button>
          }
        </div>
      </div>

      <!-- Pool -->
      <div class="flex flex-wrap gap-1.5 mt-3">
        @for (p of pool(); track p.code) {
          @let picked = isPicked(p.code);
          <button
            type="button"
            (click)="toggle(p.code)"
            [disabled]="!picked && selection().length >= maxPick"
            class="flex items-center gap-1.5 pl-0.5 pr-2.5 py-0.5 rounded-full border text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            [class]="picked ? 'bg-team-primary text-team-secondary border-transparent' : 'bg-page border-line hover:border-team-primary'"
          >
            <app-player-photo [name]="p.name ?? p.code" [photoUrl]="p.photoUrl ?? null" [size]="24" class="rounded-full block shrink-0" />
            <span class="truncate max-w-[7.5rem]">{{ shortName(p) }}</span>
          </button>
        }
      </div>

      @if (selection().length < 2) {
        <p class="text-sm text-muted mt-4">{{ i18n.t('ta.pickMore') }}</p>
      } @else {
        @switch (state().status) {
          @case ('error') {
            <div class="mt-4 flex items-center gap-3">
              <p class="text-sm text-muted flex-1">{{ i18n.t('ta.lineupError') }}</p>
              <button type="button" appButton="outline" appButtonSize="sm" (click)="retry()">{{ i18n.t('ta.retry') }}</button>
            </div>
          }
          @default {
            @if (shown(); as r) {
              <div class="mt-4 transition-opacity" [class.opacity-50]="state().status === 'loading'">
                @if (r.together.seconds === 0) {
                  <p class="text-sm font-semibold">{{ i18n.t('ta.neverTogether') }}</p>
                } @else {
                  <div [class.opacity-60]="small()">
                    <div class="flex items-end justify-between gap-3">
                      <div>
                        <p class="text-[11px] text-muted font-bold uppercase tracking-wider">{{ i18n.t('ta.together') }}</p>
                        <p class="font-display text-4xl leading-none tabular-nums mt-1" [class]="signClass(together().net)">{{ signed(together().net) }}</p>
                      </div>
                      <p class="text-[12px] text-muted text-right tabular-nums">
                        {{ i18n.t('ta.otherwise').replace('{net}', signed(otherwiseNet())) }}
                      </p>
                    </div>
                    <div class="grid grid-cols-3 gap-2 mt-3 text-center">
                      @for (s of grid(); track s.label) {
                        <div class="rounded-xl bg-page border border-line py-2">
                          <p class="text-[10px] text-muted font-bold uppercase tracking-wider">{{ s.label }}</p>
                          <p class="font-mono text-sm font-semibold tabular-nums mt-0.5">{{ s.value }}</p>
                        </div>
                      }
                    </div>
                  </div>
                  @if (small()) {
                    <p class="text-[11px] text-muted mt-2">{{ i18n.t('ta.lineupSmallSample') }}</p>
                  }

                  @if (selection().length < maxPick) {
                    <p class="text-[11px] text-muted font-bold uppercase tracking-wider mt-4 mb-1.5">{{ i18n.t('ta.bestPartners') }}</p>
                    @if (r.partners.length === 0) {
                      <p class="text-sm text-muted">{{ i18n.t('ta.noPartners') }}</p>
                    } @else {
                      <ul>
                        @for (pt of r.partners; track pt.player.code) {
                          @let ptNet = net(pt);
                          <li>
                            <button type="button" (click)="toggle(pt.player.code)" [disabled]="state().status === 'loading'" class="w-full flex items-center gap-2.5 py-2 border-t border-line first:border-t-0 text-left hover:bg-page/60 rounded-lg disabled:cursor-wait">
                              <app-player-photo [name]="pt.player.name ?? pt.player.code" [photoUrl]="pt.player.photoUrl" [size]="32" class="rounded-full block shrink-0" />
                              <span class="flex-1 min-w-0">
                                <span class="block text-sm font-semibold truncate">{{ shortName(pt.player) }}</span>
                                <span class="block text-[11px] text-muted font-mono">{{ minutes(pt.seconds) }} {{ i18n.t('ta.min') }}</span>
                              </span>
                              <span class="font-mono text-sm font-semibold tabular-nums" [class]="signClass(ptNet)">{{ signed(ptNet) }}</span>
                              <span class="w-6 h-6 rounded-full border border-line flex items-center justify-center text-muted shrink-0" aria-hidden="true">+</span>
                            </button>
                          </li>
                        }
                      </ul>
                    }
                  }
                }
              </div>
            } @else {
              <div class="mt-4 h-24 rounded-xl bg-line/60 animate-pulse" aria-hidden="true"></div>
            }
          }
        }
      }
    </div>
  `,
})
export class LineupBuilderComponent {
  private readonly api = inject(ApiService);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly i18n = inject(I18nService);

  readonly teamId = input.required<string>();
  readonly pool = input.required<AnalyticsPlayer[]>();

  protected readonly maxPick = MAX_PICK;
  protected readonly selection = signal<string[]>([]);
  private readonly retryTick = signal(0);

  // Latest selection only: switchMap drops any in-flight request when the
  // picks change, so quick taps never show an older group's numbers.
  private readonly request = computed(() => ({
    teamId: this.teamId(),
    codes: [...this.selection()].sort(),
    retry: this.retryTick(),
  }));
  // The last good result rides along while the next one loads (shown
  // dimmed, partner rows disabled); idle and error clear it.
  protected readonly state = toSignal(
    toObservable(this.request).pipe(
      switchMap(({ teamId, codes }) =>
        codes.length < 2
          ? of<LoadState>({ status: "idle" })
          : this.api.getTeamLineup(teamId, codes).pipe(
              map((result): LoadState => ({ status: "ok", result })),
              catchError(() => of<LoadState>({ status: "error" })),
              startWith<LoadState>({ status: "loading" })
            )
      ),
      scan<LoadState, ViewState>(
        (prev, s) => ({ status: s.status, result: s.status === "ok" ? s.result : s.status === "loading" ? prev.result : null }),
        { status: "idle", result: null }
      )
    ),
    { initialValue: { status: "idle", result: null } as ViewState }
  );

  protected readonly shown = computed(() => this.state().result);

  protected readonly together = computed(() => {
    const t = this.shown()?.together;
    return { net: t ? netRating(t.ptsFor, t.possFor, t.ptsAgainst, t.possAgainst) : null };
  });
  protected readonly otherwiseNet = computed(() => {
    const o = this.shown()?.otherwise;
    return o ? netRating(o.ptsFor, o.possFor, o.ptsAgainst, o.possAgainst) : null;
  });
  protected readonly small = computed(() => (this.shown()?.together.seconds ?? 0) < SMALL_SAMPLE_SECONDS);

  protected readonly grid = computed(() => {
    const t = this.shown()?.together;
    if (!t) return [];
    const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(1));
    return [
      { label: this.i18n.t("ta.min"), value: this.minutes(t.seconds) },
      { label: this.i18n.t("ta.gp"), value: String(t.games) },
      { label: this.i18n.t("ta.pts"), value: `${t.ptsFor}-${t.ptsAgainst} (${this.signedInt(t.ptsFor - t.ptsAgainst)})` },
      { label: this.i18n.t("ta.ortg"), value: fmt(offRating(t.ptsFor, t.possFor)) },
      { label: this.i18n.t("ta.drtg"), value: fmt(defRating(t.ptsAgainst, t.possAgainst)) },
      { label: this.i18n.t("ta.pace"), value: fmt(pace(t.possFor, t.possAgainst, t.seconds)) },
    ];
  });

  /** Replaces the selection (used by the lineups card's "Open in builder") and scrolls here. */
  load(codes: string[]): void {
    this.selection.set([...new Set(codes)].slice(0, MAX_PICK));
    this.host.nativeElement.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  protected isPicked(code: string): boolean {
    return this.selection().includes(code);
  }

  protected toggle(code: string): void {
    this.selection.update((s) => (s.includes(code) ? s.filter((c) => c !== code) : s.length >= MAX_PICK ? s : [...s, code]));
  }

  protected clear(): void {
    this.selection.set([]);
  }

  protected retry(): void {
    this.retryTick.update((n) => n + 1);
  }

  protected net(s: { ptsFor: number; possFor: number; ptsAgainst: number; possAgainst: number }): number | null {
    return netRating(s.ptsFor, s.possFor, s.ptsAgainst, s.possAgainst);
  }

  protected shortName(p: { name: string | null; code: string }): string {
    return formatPlayerName(p.name ?? p.code);
  }

  protected minutes(seconds: number): string {
    return String(Math.round(seconds / 60));
  }

  protected signed(v: number | null): string {
    if (v == null) return "—";
    return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  }

  protected signedInt(v: number): string {
    return `${v > 0 ? "+" : ""}${v}`;
  }

  protected signClass(v: number | null): string {
    return v == null || v === 0 ? "text-ink" : v > 0 ? "text-emerald-500" : "text-red-500";
  }
}
