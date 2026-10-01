import { Component, OnDestroy, OnInit, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { CollectibleTier, PackType, SpinResult } from "../../core/models";
import { NavIconComponent } from "../../shared/nav-icon";
import { PACK_VISUAL_CLASSES } from "../../shared/pack-visual";
import { PackArtComponent } from "../../shared/pack-art";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHintComponent } from "../../shared/page-hint";
import { SkeletonComponent } from "../../shared/skeleton";
import { newsDateLocale, gameDateTimeFormat as gameDateTimeFormatFn } from "../../shared/news-date-format";
import { PageHeaderComponent } from "../../shared/page-header";

// Matches the CSS transition-duration on the wheel graphic — the reveal is
// deliberately held back until the spin animation actually finishes, even
// if the API responds sooner, so the animation never gets cut short.
// Spin rework (2026-09-29): a longer main spin that overshoots the target a
// few degrees, a short settle back, then the landed wedge glows briefly
// before the prize shows.
const SPIN_ANIMATION_MS = 3000;
const SETTLE_MS = 380;
const LANDED_HOLD_MS = 650;
const OVERSHOOT_DEG = 5;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: "app-wheel",
  standalone: true,
  imports: [PageHeaderComponent, CommonModule, RouterLink, NavIconComponent, ButtonDirective, PageHintComponent, SkeletonComponent, PackArtComponent],
  templateUrl: "./wheel.html",
  styleUrl: "./wheel.css",
})
export class WheelComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  readonly loading = signal(true);
  readonly canSpin = signal(false);
  readonly nextEligibleAt = signal<string | null>(null);

  readonly spinning = signal(false);
  readonly spinError = signal<string | null>(null);
  readonly lastWonPack = signal<SpinResult["wonPack"] | undefined>(undefined); // undefined = no spin yet this visit
  readonly wheelRotation = signal(0);
  // Transition applied to the disc for the current move (main spin vs.
  // settle), bound in wheel.html.
  readonly discTransition = signal("none");
  // Pointer "tick" speed while the wheel passes wedges.
  readonly pointerTick = signal<"" | "fast" | "slow">("");
  // Tier of the wedge just landed on, while its glow shows.
  readonly landedTier = signal<CollectibleTier | null>(null);

  // Cooldown ring: re-evaluated every 30s.
  private readonly now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;
  readonly cooldownLeftMs = computed(() => {
    const next = this.nextEligibleAt();
    return next ? Math.max(0, new Date(next).getTime() - this.now()) : 0;
  });
  readonly cooldownPct = computed(() => Math.min(100, Math.max(0, 100 - (this.cooldownLeftMs() / COOLDOWN_MS) * 100)));
  readonly cooldownLabel = computed(() => {
    const mins = Math.ceil(this.cooldownLeftMs() / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hs = this.i18n.t("wheel.hoursShort");
    const ms = this.i18n.t("wheel.minutesShort");
    return h > 0 ? `${h}${hs} ${m.toString().padStart(2, "0")}${ms}` : `${m}${ms}`;
  });
  readonly visualClasses = PACK_VISUAL_CLASSES;

  // Angles for the win-burst starburst rays, evenly spaced around the card.
  readonly burstRays = Array.from({ length: 12 }, (_, i) => i * 30);

  // Boundary angles between the wheel's 12 wedges — rendered as straight
  // overlay lines (see .wheel-divider in wheel.css) rather than baked into
  // the conic-gradient as thin pie-slice dividers, which browsers render
  // with visible antialiasing artifacts (looked like broken/jagged lines,
  // especially once the disc is rotated). Bumped 8->12 wedges (2026-09-03,
  // coach cards added) — 8 slices can't cleanly fit a 4th tier at anything
  // close to its real odds share; 12 does (see WEDGE_TIERS below).
  readonly wedgeBoundaries = Array.from({ length: 12 }, (_, i) => i * 30);
  // 24 rim bulbs, one every 15deg (wheel.html / .wheel-bulb).
  readonly bulbs = Array.from({ length: 24 }, (_, i) => i);

  // Scattered twinkle positions for the legendary reveal — fixed, not
  // random, so the effect is identical on every pull. Same set as the pack
  // reveal (features/packs/packs.ts).
  readonly sparklePositions = [
    { top: "8%", left: "14%", delay: "0s" },
    { top: "18%", left: "82%", delay: "0.12s" },
    { top: "48%", left: "-4%", delay: "0.24s" },
    { top: "58%", left: "96%", delay: "0.06s" },
    { top: "82%", left: "20%", delay: "0.3s" },
    { top: "88%", left: "76%", delay: "0.18s" },
    { top: "4%", left: "50%", delay: "0.36s" },
  ];

  // The disc's 12 wedges, one tier per 30° slice — roughly mirrors the real
  // server-side odds (60/21/11/8 common/rare/legendary/coach, see
  // routes/spin.ts's SPIN_ODDS) without needing exact fractional wedges:
  // 7 common, 3 rare, 1 legendary, 1 coach. See the conic-gradient in
  // wheel.html, which colors each slice to match. Legendary and coach sit
  // well apart (wedges 4 and 8) rather than adjacent, so the disc doesn't
  // read as "one big-win zone."
  private static readonly WEDGE_TIERS: CollectibleTier[] = [
    "common",
    "common",
    "rare",
    "common",
    "legendary",
    "common",
    "rare",
    "common",
    "coach",
    "common",
    "rare",
    "common",
  ];

  // Which unopened pack a wedge actually grants (mirrors the backend's
  // SPIN_ODDS tiers -> starter/pro/wheelLegendary/wheelCoach mapping) — used to render the real pack art (PACK_VISUAL_CLASSES) on
  // each wedge instead of a plain glyph.
  private static readonly WEDGE_PACK_TYPE: Record<CollectibleTier, PackType> = {
    common: "starter",
    rare: "pro",
    legendary: "wheelLegendary",
    coach: "wheelCoach",
  };

  // One mark per wedge, centered at its mid-angle — rendered as an overlay
  // in wheel.html the same way wedgeBoundaries' divider lines are.
  readonly wedgeMarks = WheelComponent.WEDGE_TIERS.map((tier, i) => ({
    angle: i * 30 + 15,
    tier,
    packType: WheelComponent.WEDGE_PACK_TYPE[tier],
  }));

  ngOnDestroy(): void {
    if (this.clock) clearInterval(this.clock);
  }

  ngOnInit(): void {
    this.clock = setInterval(() => {
      this.now.set(Date.now());
      // Cooldown ran out while the page was open: allow a spin again.
      if (!this.canSpin() && this.nextEligibleAt() && this.cooldownLeftMs() === 0) this.canSpin.set(true);
    }, 30000);
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

    this.api.getSpinStatus().subscribe({
      next: (status) => {
        this.canSpin.set(status.canSpin);
        this.nextEligibleAt.set(status.nextEligibleAt);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  spin(): void {
    if (!this.canSpin() || this.spinning()) return;
    this.spinning.set(true);
    this.spinError.set(null);

    // The outcome is already decided server-side before the wheel ever
    // moves — spin to a stop angle inside a wedge matching that real
    // result, so landing on orange always means a win.
    this.api.spin().subscribe({
      next: (result) => this.animateToResult(result, () => this.applyResult(result)),
      error: (err) => this.applyError(err),
    });
  }

  /** Admin-only debug tool — always wins a legendary pack, doesn't touch the real cooldown. */
  cheatSpin(): void {
    if (this.spinning()) return;
    this.spinning.set(true);
    this.spinError.set(null);

    this.api.cheatSpin().subscribe({
      next: (result) => this.animateToResult(result, () => this.lastWonPack.set(result.wonPack)),
      error: (err) => this.applyError(err),
    });
  }

  /** Same as cheatSpin(), plus the granted pack is guaranteed to open foil. */
  cheatSpinFoil(): void {
    if (this.spinning()) return;
    this.spinning.set(true);
    this.spinError.set(null);

    this.api.cheatSpinFoil().subscribe({
      next: (result) => this.animateToResult(result, () => this.lastWonPack.set(result.wonPack)),
      error: (err) => this.applyError(err),
    });
  }

  /** Same as cheatSpin(), for the coach pool instead — otherwise verifying
   * the violet reveal means waiting on an 8% real spin chance. */
  cheatSpinCoach(): void {
    if (this.spinning()) return;
    this.spinning.set(true);
    this.spinError.set(null);

    this.api.cheatSpinCoach().subscribe({
      next: (result) => this.animateToResult(result, () => this.lastWonPack.set(result.wonPack)),
      error: (err) => this.applyError(err),
    });
  }

  private animateToResult(result: SpinResult, apply: () => void): void {
    this.landedTier.set(null);
    const target = this.spinToWedge(result.wonPack.tier);
    this.pointerTick.set("fast");
    setTimeout(() => this.pointerTick.set("slow"), SPIN_ANIMATION_MS * 0.45);
    setTimeout(() => {
      // Settle back from the overshoot.
      this.pointerTick.set("");
      this.discTransition.set(`transform ${SETTLE_MS}ms cubic-bezier(0.34, 1.4, 0.64, 1)`);
      this.wheelRotation.set(target);
    }, SPIN_ANIMATION_MS);
    setTimeout(() => this.landedTier.set(result.wonPack.tier), SPIN_ANIMATION_MS + SETTLE_MS);
    setTimeout(() => {
      this.spinning.set(false);
      this.landedTier.set(null);
      apply();
    }, SPIN_ANIMATION_MS + SETTLE_MS + LANDED_HOLD_MS);
  }

  /**
   * Rotates the wheel so it stops with the pointer inside a wedge matching
   * the tier that was actually decided server-side. See the conic-gradient
   * in wheel.html for the wedge layout this mirrors.
   */
  private spinToWedge(tier: CollectibleTier): number {
    const wedgeStarts = WheelComponent.WEDGE_TIERS.reduce<number[]>((starts, t, i) => {
      if (t === tier) starts.push(i * 30);
      return starts;
    }, []);
    const start = wedgeStarts[Math.floor(Math.random() * wedgeStarts.length)];
    const inset = 6; // stay clear of wedge boundaries so the color reads unambiguously
    const targetAngle = start + inset + Math.random() * (30 - 2 * inset);

    // The pointer sits at the top (screen angle 0); after rotating the
    // disc clockwise by R degrees, the wedge now under the pointer is the
    // one that was originally at (360 - R mod 360) mod 360.
    const targetMod = (360 - targetAngle + 360) % 360;
    const current = this.wheelRotation();
    const currentMod = ((current % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;

    const extraSpins = 5 + Math.floor(Math.random() * 3);
    const target = current + extraSpins * 360 + delta;
    // Main spin runs slightly past the target; animateToResult settles it back.
    this.discTransition.set(`transform ${SPIN_ANIMATION_MS}ms cubic-bezier(0.15, 0.7, 0.1, 1)`);
    this.wheelRotation.set(target + OVERSHOOT_DEG);
    return target;
  }

  private applyResult(result: SpinResult): void {
    this.canSpin.set(false);
    this.nextEligibleAt.set(result.nextEligibleAt);
    this.lastWonPack.set(result.wonPack);
  }

  private applyError(err: unknown): void {
    this.spinning.set(false);
    const message = (err as { error?: { error?: string } })?.error?.error ?? "Couldn't spin right now.";
    this.spinError.set(message);
  }

  // Athens-time, Greek-aware — same shared/news-date-format.ts pattern
  // already used on the dashboard/schedule/roster/predictions pages instead
  // of the raw date pipe this used to use directly in the template.
  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  gameDateTimeFormat(): string {
    return gameDateTimeFormatFn(this.i18n.lang());
  }
}
