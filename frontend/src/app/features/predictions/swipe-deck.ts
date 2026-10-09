import { AfterViewInit, Component, ElementRef, HostListener, NgZone, computed, effect, inject, input, output, signal, viewChild } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import type { Game, PlayerAdvancedStatsRow, PreviewStrip, WinProbPreGame } from "../../core/models";
import { MatchupStripComponent } from "../../shared/matchup-strip";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { TeamCodePipe } from "../../shared/team-display-code";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { cdnImage } from "../../shared/cdn-image";

const SWIPE_PX = 90;
const PLAYER_PHOTO_PX = 52;
const HINT_KEY = "clutch.deckHintSeen";

type Gsap = typeof import("gsap").gsap;

/**
 * Quick-pick deck (2026-10-08): the round's unpicked games one card at a
 * time. Gestures only, no buttons: swipe left = home, right = away, up =
 * skip (arrow keys on desktop); a one-time demo nudge teaches it. After a
 * winner swipe the card flips to "Top scorer?" with the page's 3+3
 * recommendations: tap one (saved at once, same as the page's quick pick)
 * or swipe up to skip. Winner picks go out through `pick` into the page's
 * unsaved picks; its Save is the only write path for them.
 *
 * Motion: GSAP alone owns the card's transform/opacity (no Angular style
 * binding), and pointer events run outside the zone, so dragging never
 * runs change detection over the 1,200-line page behind the deck. A thrown
 * card stays hidden while the next game swaps in, then enterCard() brings
 * it in — no reset-to-centre frame between cards.
 */
@Component({
  selector: "app-swipe-deck",
  standalone: true,
  imports: [DecimalPipe, ButtonDirective, RetryImgDirective, TeamCodePipe, PlayerPhotoComponent, MatchupStripComponent],
  template: `
    <div class="sheet-backdrop fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4" (click)="closed.emit()">
      <div class="w-full max-w-sm flex flex-col items-center" (click)="$event.stopPropagation()">
        <div class="w-full flex items-center justify-between mb-3 text-white">
          <p class="font-display text-lg">{{ i18n.t("predictions.deck.title") }}</p>
          <button type="button" (click)="closed.emit()" class="text-white/70 hover:text-white text-3xl leading-none font-bold" [attr.aria-label]="i18n.t('hint.dismiss')">&times;</button>
        </div>

        @if (current(); as g) {
          <p class="text-white/60 text-[12px] font-semibold mb-2 tabular-nums">{{ index() + 1 }} / {{ games().length }}</p>
          <div #card class="w-full rounded-3xl bg-card border border-line shadow-pop p-5 select-none touch-none will-change-transform">
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
              @if (previews()[g.id]; as strip) {
                <app-matchup-strip class="block mt-3" [strip]="strip" [home]="g.homeTeam" [away]="g.awayTeam" [gameId]="g.id" />
              }
            } @else {
              <p class="font-display text-lg text-center mb-3">{{ i18n.t("predictions.deck.topScorerQ") }}</p>
              <div class="grid grid-cols-3 gap-2">
                @for (r of scorerOptions(); track r.player.id) {
                  <button type="button" (click)="chooseScorer(r.player.id)"
                    class="deck-player flex flex-col items-center gap-1 rounded-2xl p-2 hover:bg-team-primary/10 transition-colors">
                    <app-player-photo [name]="r.player.name" [photoUrl]="r.player.photoUrl" [size]="playerPhotoPx" />
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
  private readonly zone = inject(NgZone);

  readonly games = input.required<Game[]>();
  readonly points = input.required<(game: Game, teamId: string) => number>();
  readonly probs = input<Record<string, WinProbPreGame>>({});
  readonly previews = input<Record<string, PreviewStrip>>({});
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
  protected readonly playerPhotoPx = PLAYER_PHOTO_PX;
  protected readonly index = signal(0);
  protected readonly phase = signal<"winner" | "scorer">("winner");
  protected readonly winners = signal(0);
  protected readonly scorers = signal(0);
  private readonly pickedTeamId = signal<string | null>(null);
  protected readonly current = computed(() => this.games()[this.index()] ?? null);
  // Only the side highlight is a signal; it changes when the drag crosses ±30px.
  protected readonly lean = signal<"home" | "away" | null>(null);

  private x = 0;
  private y = 0;
  private start: { x: number; y: number } | null = null;
  private busy = false;
  private gsap: Gsap | null = null;

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
    import("gsap").then(({ gsap }) => (this.gsap = gsap)).catch(() => {});
    let seen = true;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
      if (!seen) localStorage.setItem(HINT_KEY, "1");
    } catch {
      seen = true; // storage blocked: skip the demo rather than repeat it
    }
    if (!seen) setTimeout(() => this.demoNudge(), 400);
  }

  // Pointer listeners on the card, attached outside the zone; re-attached
  // if the card element is replaced (e.g. after the end screen).
  private readonly bindPointer = effect((onCleanup) => {
    const el = this.card()?.nativeElement;
    if (!el) return;
    const down = (e: PointerEvent) => {
      if (this.busy || (e.target as HTMLElement).closest(".deck-player")) return;
      this.start = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!this.start) return;
      // On the top-scorer face only the upward skip drags.
      const x = this.phase() === "winner" ? e.clientX - this.start.x : 0;
      this.setDrag(x, Math.min(0, e.clientY - this.start.y));
    };
    const up = () => this.release();
    this.zone.runOutsideAngular(() => {
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
    onCleanup(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    });
  });

  private setDrag(x: number, y: number): void {
    this.x = x;
    this.y = y;
    const el = this.card()?.nativeElement;
    if (el) {
      if (this.gsap) this.gsap.set(el, { x, y, rotation: x / 18 });
      else el.style.transform = `translate(${x}px, ${y}px) rotate(${x / 18}deg)`;
    }
    const lean = x < -30 ? "home" : x > 30 ? "away" : null;
    if (lean !== this.lean()) this.zone.run(() => this.lean.set(lean));
  }

  private release(): void {
    if (!this.start) return;
    this.start = null;
    const { x, y } = this;
    this.zone.run(() => {
      if (y <= -SWIPE_PX && Math.abs(y) > Math.abs(x)) this.decide("skip");
      else if (x <= -SWIPE_PX) this.decide("home");
      else if (x >= SWIPE_PX) this.decide("away");
      else this.snapBack();
    });
  }

  // Under the threshold: spring back to centre.
  private snapBack(): void {
    if (!this.gsap || this.reduceMotion()) {
      this.setDrag(0, 0);
      return;
    }
    const gsap = this.gsap;
    const proxy = { x: this.x, y: this.y };
    this.zone.runOutsideAngular(() =>
      gsap.to(proxy, { x: 0, y: 0, duration: 0.3, ease: "back.out(2)", onUpdate: () => this.setDrag(proxy.x, proxy.y) })
    );
  }

  // One-time demo: nudge left (home lights up), right (away), settle.
  private async demoNudge(): Promise<void> {
    if (this.reduceMotion() || this.busy) return;
    try {
      const { gsap } = await import("gsap");
      this.gsap = gsap;
      const proxy = { x: 0 };
      const set = () => this.setDrag(proxy.x, 0);
      this.zone.runOutsideAngular(() =>
        gsap
          .timeline()
          .to(proxy, { x: -60, duration: 0.45, ease: "power2.out", onUpdate: set })
          .to(proxy, { x: 60, duration: 0.6, ease: "power2.inOut", onUpdate: set, delay: 0.25 })
          .to(proxy, { x: 0, duration: 0.45, ease: "power2.in", onUpdate: set, delay: 0.25 })
      );
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

  async decide(choice: "home" | "away" | "skip"): Promise<void> {
    const game = this.current();
    if (!game || this.busy) return;
    this.busy = true;
    if (this.phase() === "scorer" || choice === "skip") {
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

  // The thrown card is still hidden here; the next game's content swaps in
  // underneath, then enterCard() brings it in.
  private next(): void {
    this.x = 0;
    this.y = 0;
    this.lean.set(null);
    this.phase.set("winner");
    this.pickedTeamId.set(null);
    this.index.update((i) => i + 1);
    this.busy = false;
    this.afterRender(() => this.enterCard());
  }

  // Runs once Angular has painted the new content (two frames).
  private afterRender(fn: () => void): void {
    this.zone.runOutsideAngular(() => requestAnimationFrame(() => requestAnimationFrame(fn)));
  }

  private enterCard(): void {
    const el = this.card()?.nativeElement;
    if (!el) return;
    if (!this.gsap || this.reduceMotion()) {
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
      return;
    }
    this.gsap.fromTo(
      el,
      { x: 0, y: 28, rotation: 0, rotationY: 0, scale: 0.94, opacity: 0 },
      { y: 0, scale: 1, opacity: 1, duration: 0.34, ease: "back.out(1.5)", clearProps: "transform,opacity" }
    );
  }

  // Top-scorer faces fade up one after another once the flip lands.
  private staggerPlayers(): void {
    const el = this.card()?.nativeElement;
    if (!el || !this.gsap || this.reduceMotion()) return;
    this.gsap.fromTo(
      el.querySelectorAll(".deck-player"),
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.26, ease: "power2.out", stagger: 0.045, clearProps: "opacity,transform" }
    );
  }

  // Warm the browser cache so photos and crests are ready before they show:
  // this game's top-scorer candidates, and the next game's crests.
  private readonly preloaded = new Set<string>();
  private readonly preload = effect(() => {
    const g = this.current();
    if (!g) return;
    const nextGame = this.games()[this.index() + 1];
    const rec = this.recommendations();
    // Players go through the same cdnImage(url, 52) as app-player-photo, so
    // the browser picks the same srcset candidate it will render.
    const players = [...rec(g.homeTeam.id), ...rec(g.awayTeam.id)].map((r) => r.player.photoUrl);
    const images = [
      ...players.filter((u): u is string => !!u).map((u) => cdnImage(u, PLAYER_PHOTO_PX)),
      ...[nextGame?.homeTeam.logoUrl, nextGame?.awayTeam.logoUrl].filter((u): u is string => !!u).map((u) => ({ src: u, srcset: null, sizes: null })),
    ];
    for (const im of images) {
      if (this.preloaded.has(im.src)) continue;
      this.preloaded.add(im.src);
      const img = new Image();
      img.decoding = "async";
      if (im.sizes) img.sizes = im.sizes;
      if (im.srcset) img.srcset = im.srcset;
      img.src = im.src;
    }
  });

  private reduceMotion(): boolean {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Card turns edge-on, swaps to the top-scorer face, turns back.
  private async flipTo(phase: "scorer"): Promise<void> {
    const el = this.card()?.nativeElement;
    this.lean.set(null);
    if (!el || !this.gsap || this.reduceMotion()) {
      this.setDrag(0, 0);
      this.phase.set(phase);
      return;
    }
    const gsap = this.gsap;
    await this.zone.runOutsideAngular(() => gsap.to(el, { x: 0, y: 0, rotation: 0, rotationY: 90, duration: 0.18, ease: "power2.in" }));
    this.x = 0;
    this.y = 0;
    this.zone.run(() => this.phase.set(phase));
    this.afterRender(() => this.staggerPlayers());
    await this.zone.runOutsideAngular(() => gsap.fromTo(el, { rotationY: -90 }, { rotationY: 0, duration: 0.22, ease: "power2.out", clearProps: "transform" }));
  }

  // Throws from wherever the drag left it; the card stays hidden afterwards.
  private async throwCard(choice: "home" | "away" | "skip"): Promise<void> {
    const el = this.card()?.nativeElement;
    if (!el || !this.gsap || this.reduceMotion()) return;
    const w = window.innerWidth;
    const to =
      choice === "skip"
        ? { x: this.x, y: -window.innerHeight, rotation: this.x / 18 }
        : { x: choice === "home" ? -w : w, y: this.y, rotation: choice === "home" ? -24 : 24 };
    const gsap = this.gsap;
    await this.zone.runOutsideAngular(() => gsap.to(el, { ...to, opacity: 0, duration: 0.3, ease: "power2.in" }));
  }
}
