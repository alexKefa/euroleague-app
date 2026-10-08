import { AfterViewInit, Component, ElementRef, HostListener, computed, inject, input, output, signal, viewChild } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import type { Game, PlayerAdvancedStatsRow, WinProbPreGame } from "../../core/models";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { TeamCodePipe } from "../../shared/team-display-code";
import { PlayerPhotoComponent } from "../../shared/player-photo";

const SWIPE_PX = 90;
const HINT_KEY = "clutch.deckHintSeen";

/**
 * Quick-pick deck (2026-10-08): the round's unpicked games one card at a
 * time. Gestures only, no buttons: swipe left = home, right = away, up =
 * skip (arrow keys on desktop); a one-time demo nudge teaches it. After a
 * winner swipe the card flips to "Top scorer?" with the page's 3+3
 * recommendations: tap one (saved at once, same as the page's quick pick)
 * or swipe up to skip. Winner picks go out through `pick` into the page's
 * unsaved picks; its Save is the only write path for them.
 */
@Component({
  selector: "app-swipe-deck",
  standalone: true,
  imports: [DecimalPipe, ButtonDirective, RetryImgDirective, TeamCodePipe, PlayerPhotoComponent],
  template: `
    <div class="sheet-backdrop fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4" (click)="closed.emit()">
      <div class="w-full max-w-sm flex flex-col items-center" (click)="$event.stopPropagation()">
        <div class="w-full flex items-center justify-between mb-3 text-white">
          <p class="font-display text-lg">{{ i18n.t("predictions.deck.title") }}</p>
          <button type="button" (click)="closed.emit()" class="text-white/70 hover:text-white text-3xl leading-none font-bold" [attr.aria-label]="i18n.t('hint.dismiss')">&times;</button>
        </div>

        @if (current(); as g) {
          <p class="text-white/60 text-[12px] font-semibold mb-2 tabular-nums">{{ index() + 1 }} / {{ games().length }}</p>
          <div
            #card
            class="w-full rounded-3xl bg-card border border-line shadow-pop p-5 select-none touch-none"
            [style.transform]="'translate(' + dx() + 'px,' + dy() + 'px) rotate(' + dx() / 18 + 'deg)'"
            (pointerdown)="onDown($event)"
            (pointermove)="onMove($event)"
            (pointerup)="onUp()"
            (pointercancel)="onUp()"
          >
            @if (phase() === "winner") {
              <div class="grid grid-cols-2 gap-3">
                @for (side of [g.homeTeam, g.awayTeam]; track side.id; let first = $first) {
                  <div class="flex flex-col items-center text-center rounded-2xl p-3 transition-colors"
                    [style.background]="lean() === (first ? 'home' : 'away') ? 'color-mix(in srgb, var(--accent-primary) 18%, transparent)' : 'transparent'">
                    @if (side.logoUrl) {
                      <img [src]="side.logoUrl" [alt]="side.code | teamCode" appRetryImg class="w-16 h-16 object-contain team-logo" draggable="false" />
                    } @else {
                      <span class="w-16 h-16 flex items-center justify-center font-display text-xl">{{ side.code | teamCode }}</span>
                    }
                    <p class="font-semibold text-[13px] leading-tight mt-2 line-clamp-2">{{ side.name }}</p>
                    <p class="font-mono text-[11px] font-bold text-team-primary mt-1">+{{ points()(g, side.id) }} {{ i18n.t("predictions.pts") }}</p>
                  </div>
                }
              </div>
              @if (probs()[g.id]; as wp) {
                <p class="text-center text-[11px] text-muted mt-3 tabular-nums">
                  {{ i18n.t("winProb.clutchPredicts") }}:
                  <span class="font-semibold text-ink">{{ wp.homeProb >= 0.5 ? g.homeTeam.name : g.awayTeam.name }}</span>
                  {{ (wp.homeProb >= 0.5 ? wp.homeProb : 1 - wp.homeProb) * 100 | number: "1.0-0" }}%
                </p>
              }
            } @else {
              <p class="font-display text-lg text-center mb-3">{{ i18n.t("predictions.deck.topScorerQ") }}</p>
              <div class="grid grid-cols-3 gap-2">
                @for (r of scorerOptions(); track r.player.id) {
                  <button type="button" (click)="chooseScorer(r.player.id)" (pointerdown)="$event.stopPropagation()"
                    class="flex flex-col items-center gap-1 rounded-2xl p-2 hover:bg-team-primary/10 active:scale-95 transition">
                    <app-player-photo [name]="r.player.name" [photoUrl]="r.player.photoUrl" [size]="52" />
                    <span class="text-[11px] font-semibold leading-tight truncate max-w-full">{{ r.player.name.split(",")[0] }}</span>
                    <span class="font-mono text-[10px] text-muted">
                      @if (quote()(g, r.player.id); as q) { +{{ q }} {{ i18n.t("predictions.pts") }} } @else { {{ r.stats.pointsPerGame | number: "1.1-1" }} PPG }
                    </span>
                  </button>
                }
              </div>
            }
          </div>

          <!-- Gesture legend instead of buttons (2026-10-08). -->
          <p class="mt-4 text-white/80 text-[12px] font-semibold tracking-wide text-center">
            @if (phase() === "winner") {
              &larr; {{ g.homeTeam.code | teamCode }} &nbsp;·&nbsp; &uarr; {{ i18n.t("predictions.deck.skip") }} &nbsp;·&nbsp; {{ g.awayTeam.code | teamCode }} &rarr;
            } @else {
              {{ i18n.t("predictions.deck.tapPlayer") }} &nbsp;·&nbsp; &uarr; {{ i18n.t("predictions.deck.skip") }}
            }
          </p>
        } @else {
          <div class="w-full rounded-3xl bg-card border border-line shadow-pop p-6 text-center">
            <p class="font-display text-3xl tabular-nums">
              {{ winners() }} <span class="text-base text-muted">{{ i18n.t("predictions.deck.winners") }}</span>
              · {{ scorers() }} <span class="text-base text-muted">{{ i18n.t("predictions.deck.scorers") }}</span>
            </p>
            <p class="text-sm text-muted mt-2">{{ i18n.t(winners() > 0 ? "predictions.deck.saveNote" : "predictions.deck.scorersSaved") }}</p>
            @if (winners() > 0) {
              <button type="button" appButton class="w-full mt-4" (click)="save.emit()">{{ i18n.t("predictions.deck.save") }}</button>
            }
            <button type="button" appButton="secondary" class="w-full mt-2" (click)="closed.emit()">{{ i18n.t("predictions.deck.close") }}</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class SwipeDeckComponent implements AfterViewInit {
  protected i18n = inject(I18nService);

  readonly games = input.required<Game[]>();
  readonly points = input.required<(game: Game, teamId: string) => number>();
  readonly probs = input<Record<string, WinProbPreGame>>({});
  // Top-scorer step: the page's own recommendations, quotes and state.
  readonly recommendations = input.required<(teamId: string) => PlayerAdvancedStatsRow[]>();
  readonly quote = input.required<(game: Game, playerId: string) => number | null>();
  readonly hasTopScorer = input.required<(game: Game) => boolean>();
  readonly isOut = input.required<(playerId: string) => boolean>();
  readonly pick = output<{ game: Game; teamId: string }>();
  readonly topScorer = output<{ game: Game; playerId: string }>();
  readonly save = output<void>();
  readonly closed = output<void>();

  private readonly card = viewChild<ElementRef<HTMLElement>>("card");
  protected readonly index = signal(0);
  protected readonly phase = signal<"winner" | "scorer">("winner");
  protected readonly winners = signal(0);
  protected readonly scorers = signal(0);
  private readonly pickedTeamId = signal<string | null>(null);
  protected readonly current = computed(() => this.games()[this.index()] ?? null);
  protected readonly dx = signal(0);
  protected readonly dy = signal(0);
  protected readonly lean = computed(() => (this.dx() < -30 ? "home" : this.dx() > 30 ? "away" : null));
  private start: { x: number; y: number } | null = null;
  private busy = false;

  // Picked team's players first, then the other side; injured-out dropped.
  protected readonly scorerOptions = computed(() => {
    const g = this.current();
    if (!g) return [];
    const first = this.pickedTeamId() === g.awayTeam.id ? g.awayTeam.id : g.homeTeam.id;
    const second = first === g.homeTeam.id ? g.awayTeam.id : g.homeTeam.id;
    const rec = this.recommendations();
    return [...rec(first), ...rec(second)].filter((r) => !this.isOut()(r.player.id));
  });

  ngAfterViewInit(): void {
    let seen = true;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
      if (!seen) localStorage.setItem(HINT_KEY, "1");
    } catch {
      seen = true; // storage blocked: skip the demo rather than repeat it
    }
    if (!seen) setTimeout(() => this.demoNudge(), 400);
  }

  // One-time demo: nudge left (home lights up), right (away), settle.
  private async demoNudge(): Promise<void> {
    if (this.reduceMotion() || this.busy) return;
    try {
      const { gsap } = await import("gsap");
      const proxy = { x: 0 };
      const set = () => this.dx.set(proxy.x);
      await gsap
        .timeline()
        .to(proxy, { x: -60, duration: 0.45, ease: "power2.out", onUpdate: set })
        .to(proxy, { x: 60, duration: 0.6, ease: "power2.inOut", onUpdate: set, delay: 0.25 })
        .to(proxy, { x: 0, duration: 0.45, ease: "power2.in", onUpdate: set, delay: 0.25 });
    } catch {
      // no demo without GSAP
    }
  }

  @HostListener("document:keydown", ["$event"])
  onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowUp") this.decide("skip");
    else if (this.phase() === "winner" && e.key === "ArrowLeft") this.decide("home");
    else if (this.phase() === "winner" && e.key === "ArrowRight") this.decide("away");
    else if (e.key === "Escape") this.closed.emit();
  }

  onDown(e: PointerEvent): void {
    if (this.busy) return;
    this.start = { x: e.clientX, y: e.clientY };
  }

  onMove(e: PointerEvent): void {
    if (!this.start) return;
    // On the top-scorer face only the upward skip drags.
    if (this.phase() === "winner") this.dx.set(e.clientX - this.start.x);
    this.dy.set(Math.min(0, e.clientY - this.start.y));
  }

  onUp(): void {
    if (!this.start) return;
    this.start = null;
    const x = this.dx();
    const y = this.dy();
    if (y <= -SWIPE_PX && Math.abs(y) > Math.abs(x)) this.decide("skip");
    else if (x <= -SWIPE_PX) this.decide("home");
    else if (x >= SWIPE_PX) this.decide("away");
    else {
      this.dx.set(0);
      this.dy.set(0);
    }
  }

  async decide(choice: "home" | "away" | "skip"): Promise<void> {
    const game = this.current();
    if (!game || this.busy) return;
    this.busy = true;
    if (this.phase() === "scorer") {
      // Only "skip" reaches here on the top-scorer face.
      await this.throwCard("skip");
      this.next();
      return;
    }
    if (choice === "skip") {
      await this.throwCard("skip");
      this.next();
      return;
    }
    const teamId = choice === "home" ? game.homeTeam.id : game.awayTeam.id;
    this.pick.emit({ game, teamId });
    this.winners.update((n) => n + 1);
    this.pickedTeamId.set(teamId);
    if (this.hasTopScorer()(game) || this.scorerOptions().length === 0) {
      await this.throwCard(choice);
      this.next();
      return;
    }
    await this.flipTo("scorer");
    this.busy = false;
  }

  async chooseScorer(playerId: string): Promise<void> {
    const game = this.current();
    if (!game || this.busy) return;
    this.busy = true;
    this.topScorer.emit({ game, playerId });
    this.scorers.update((n) => n + 1);
    await this.throwCard("skip");
    this.next();
  }

  private next(): void {
    this.dx.set(0);
    this.dy.set(0);
    this.phase.set("winner");
    this.pickedTeamId.set(null);
    this.index.update((i) => i + 1);
    this.busy = false;
  }

  private reduceMotion(): boolean {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Card turns edge-on, swaps to the top-scorer face, turns back.
  private async flipTo(phase: "scorer"): Promise<void> {
    const el = this.card()?.nativeElement;
    if (!el || this.reduceMotion()) {
      this.dx.set(0);
      this.dy.set(0);
      this.phase.set(phase);
      return;
    }
    try {
      const { gsap } = await import("gsap");
      await gsap.to(el, { rotationY: 90, duration: 0.18, ease: "power2.in" });
      this.dx.set(0);
      this.dy.set(0);
      this.phase.set(phase);
      await gsap.fromTo(el, { rotationY: -90 }, { rotationY: 0, duration: 0.22, ease: "power2.out", clearProps: "transform" });
    } catch {
      this.phase.set(phase);
    }
  }

  private async throwCard(choice: "home" | "away" | "skip"): Promise<void> {
    const el = this.card()?.nativeElement;
    if (!el || this.reduceMotion()) return;
    try {
      const { gsap } = await import("gsap");
      const w = window.innerWidth;
      const to =
        choice === "skip"
          ? { x: this.dx(), y: -window.innerHeight, rotation: 0 }
          : { x: choice === "home" ? -w : w, y: this.dy(), rotation: choice === "home" ? -24 : 24 };
      await gsap.fromTo(el, { opacity: 1 }, { ...to, opacity: 0, duration: 0.3, ease: "power2.in", clearProps: "opacity" });
      gsap.set(el, { clearProps: "transform" });
    } catch {
      // GSAP failed to load — just move on.
    }
  }
}
