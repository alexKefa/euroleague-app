import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import type { Game, WinProbPreGame } from "../../core/models";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { TeamCodePipe } from "../../shared/team-display-code";

const SWIPE_PX = 90;

/**
 * Quick-pick deck (2026-10-08): the round's unpicked games one card at a
 * time. Swipe left = home, right = away, up = skip (buttons do the same).
 * Picks go out through `pick` into the page's normal unsaved picks, so the
 * page's own Save is the only write path. GSAP (lazy) throws the card off;
 * reduced motion just swaps it.
 */
@Component({
  selector: "app-swipe-deck",
  standalone: true,
  imports: [DecimalPipe, ButtonDirective, RetryImgDirective, TeamCodePipe],
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
            class="deck-card w-full rounded-3xl bg-card border border-line shadow-pop p-5 select-none touch-none"
            [style.transform]="'translate(' + dx() + 'px,' + dy() + 'px) rotate(' + dx() / 18 + 'deg)'"
            (pointerdown)="onDown($event)"
            (pointermove)="onMove($event)"
            (pointerup)="onUp()"
            (pointercancel)="onUp()"
          >
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
                  <p class="text-[10px] uppercase tracking-wide text-muted mt-1">{{ i18n.t(first ? "predictions.deck.swipeLeft" : "predictions.deck.swipeRight") }}</p>
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
          </div>

          <div class="w-full grid grid-cols-3 gap-2 mt-4">
            <button type="button" appButton="outline" (click)="decide('home')">&larr; {{ g.homeTeam.code | teamCode }}</button>
            <button type="button" appButton="secondary" (click)="decide('skip')">{{ i18n.t("predictions.deck.skip") }} &uarr;</button>
            <button type="button" appButton="outline" (click)="decide('away')">{{ g.awayTeam.code | teamCode }} &rarr;</button>
          </div>
        } @else {
          <div class="w-full rounded-3xl bg-card border border-line shadow-pop p-6 text-center">
            <p class="font-display text-4xl tabular-nums">{{ pickedCount() }}</p>
            <p class="text-sm text-muted mt-1">{{ i18n.t("predictions.deck.pickedSummary") }}</p>
            @if (pickedCount() > 0) {
              <button type="button" appButton class="w-full mt-4" (click)="save.emit()">{{ i18n.t("predictions.deck.save") }}</button>
            }
            <button type="button" appButton="secondary" class="w-full mt-2" (click)="closed.emit()">{{ i18n.t("predictions.deck.close") }}</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class SwipeDeckComponent {
  protected i18n = inject(I18nService);

  readonly games = input.required<Game[]>();
  readonly points = input.required<(game: Game, teamId: string) => number>();
  readonly probs = input<Record<string, WinProbPreGame>>({});
  readonly pick = output<{ game: Game; teamId: string }>();
  readonly save = output<void>();
  readonly closed = output<void>();

  private readonly card = viewChild<ElementRef<HTMLElement>>("card");
  protected readonly index = signal(0);
  protected readonly pickedCount = signal(0);
  protected readonly current = computed(() => this.games()[this.index()] ?? null);
  protected readonly dx = signal(0);
  protected readonly dy = signal(0);
  protected readonly lean = computed(() => (this.dx() < -30 ? "home" : this.dx() > 30 ? "away" : null));
  private start: { x: number; y: number } | null = null;
  private busy = false;

  onDown(e: PointerEvent): void {
    if (this.busy) return;
    this.start = { x: e.clientX, y: e.clientY };
  }

  onMove(e: PointerEvent): void {
    if (!this.start) return;
    this.dx.set(e.clientX - this.start.x);
    this.dy.set(Math.min(0, e.clientY - this.start.y));
  }

  onUp(): void {
    if (!this.start) return;
    this.start = null;
    const x = this.dx();
    const y = this.dy();
    if (x <= -SWIPE_PX) this.decide("home");
    else if (x >= SWIPE_PX) this.decide("away");
    else if (y <= -SWIPE_PX) this.decide("skip");
    else {
      this.dx.set(0);
      this.dy.set(0);
    }
  }

  async decide(choice: "home" | "away" | "skip"): Promise<void> {
    const game = this.current();
    if (!game || this.busy) return;
    this.busy = true;
    if (choice !== "skip") {
      this.pick.emit({ game, teamId: choice === "home" ? game.homeTeam.id : game.awayTeam.id });
      this.pickedCount.update((n) => n + 1);
    }
    await this.throwCard(choice);
    this.dx.set(0);
    this.dy.set(0);
    this.index.update((i) => i + 1);
    this.busy = false;
  }

  private async throwCard(choice: "home" | "away" | "skip"): Promise<void> {
    const el = this.card()?.nativeElement;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce) return;
    try {
      const { gsap } = await import("gsap");
      const w = window.innerWidth;
      const to =
        choice === "skip"
          ? { x: this.dx(), y: -window.innerHeight, rotation: 0 }
          : { x: choice === "home" ? -w : w, y: this.dy(), rotation: choice === "home" ? -24 : 24 };
      // The [style.transform] binding is reset right after, so GSAP's inline
      // transform/opacity are cleared when the next card renders.
      await gsap.fromTo(el, { opacity: 1 }, { ...to, opacity: 0, duration: 0.3, ease: "power2.in", clearProps: "opacity" });
      gsap.set(el, { clearProps: "transform" });
    } catch {
      // GSAP failed to load — just move on.
    }
  }
}
