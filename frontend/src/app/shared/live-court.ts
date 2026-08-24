import { Component, Input, OnChanges, SimpleChanges, signal } from "@angular/core";
import { CommonModule } from "@angular/common";

type Side = "home" | "away";

// A reactive full-court diagram, inspired by OAKA's ASB GlassFloor (the LED
// glass court Panathinaikos plays on) — the point there isn't the glass
// tile texture, it's that the *court itself* reacts to what's happening.
// This is the same idea at web-app scale: each team's half is washed in
// their own color and watermarked with their logo, a basket flashes a big
// "+2"/"+3" when that team scores (ngOnChanges diffing homeScore/awayScore
// — no new data source, game-detail.ts already streams these live over
// SSE; the live-score simulator only ever bumps a score by exactly 2 or 3
// in one tick — see realtime/liveScoreSimulator.ts's `bump` — so the score
// delta alone tells us the shot value, no backend change needed), and
// whichever side currently has an "on fire" player gets a slow ambient
// pulse. Hand-drawn SVG, same approach as shot-chart.ts — no charting/
// animation library.
//
// Court geometry mirrors shot-chart.ts's own constants (which are already
// close FIBA approximations — 490cm key, 675cm 3PT radius, 132cm corner-3
// offset, 580cm free-throw line, 5cm/unit) rather than re-deriving them,
// just transposed into a full court (two baskets, joined at half-court)
// instead of one half-court: their "depth from baseline" (their Y axis,
// basket near the bottom) becomes my X axis (basket near each side edge),
// their "sideways" (their X axis) becomes my Y axis.
@Component({
  selector: "app-live-court",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./live-court.html",
  styles: [
    `
      @keyframes courtBurst {
        0% {
          opacity: 0;
          transform: scale(0.4);
        }
        25% {
          opacity: 0.8;
        }
        100% {
          opacity: 0;
          transform: scale(2.3);
        }
      }
      .court-burst {
        animation: courtBurst 1500ms ease-out;
        transform-origin: center;
        transform-box: fill-box;
      }
      .court-burst.is-three {
        animation-duration: 1900ms;
      }

      @keyframes courtNumber {
        0% {
          opacity: 0;
          transform: scale(0.25) translateY(6px);
        }
        18% {
          opacity: 1;
          transform: scale(1.2) translateY(0);
        }
        32% {
          transform: scale(1) translateY(0);
        }
        78% {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
        100% {
          opacity: 0;
          transform: scale(1) translateY(-16px);
        }
      }
      .court-number {
        animation: courtNumber 1500ms ease-out;
        transform-origin: center;
        transform-box: fill-box;
      }
      .court-number.is-three {
        animation-duration: 1900ms;
      }

      @keyframes courtHotGlow {
        0%,
        100% {
          opacity: 0.16;
        }
        50% {
          opacity: 0.32;
        }
      }
      .court-hot {
        animation: courtHotGlow 1.6s ease-in-out infinite;
      }
    `,
  ],
})
export class LiveCourtComponent implements OnChanges {
  @Input() homeColor: string | null = null;
  @Input() awayColor: string | null = null;
  @Input() homeLogoUrl: string | null = null;
  @Input() awayLogoUrl: string | null = null;
  @Input() homeScore: number | null = null;
  @Input() awayScore: number | null = null;
  @Input() hotSide: Side | "both" | null = null;
  // Pulsing only makes sense while a game is actually live — off for
  // scheduled/final games (the parent simply doesn't render this component
  // then, but this guards direct usage too).
  @Input() active = true;

  readonly pulseSide = signal<Side | null>(null);
  // The shot value driving the "+2"/"+3" number — null for a score jump
  // that isn't a clean 2 or 3 (shouldn't happen from the simulator, but a
  // real future feed might report free throws or batched updates
  // differently), in which case only the plain glow burst plays.
  readonly pulseValue = signal<2 | 3 | null>(null);
  private pulseTimeout?: ReturnType<typeof setTimeout>;

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.active) return;
    this.maybePulse(changes, "homeScore", "home");
    this.maybePulse(changes, "awayScore", "away");
  }

  private maybePulse(changes: SimpleChanges, key: "homeScore" | "awayScore", side: Side): void {
    const change = changes[key];
    if (!change || change.firstChange) return;
    const prev = change.previousValue as number | null;
    const cur = change.currentValue as number | null;
    if (prev == null || cur == null || cur <= prev) return;

    const delta = cur - prev;
    this.pulseSide.set(side);
    this.pulseValue.set(delta === 2 || delta === 3 ? delta : null);

    clearTimeout(this.pulseTimeout);
    const duration = delta === 3 ? 1900 : 1500;
    this.pulseTimeout = setTimeout(() => {
      this.pulseSide.set(null);
      this.pulseValue.set(null);
    }, duration);
  }

  isHot(side: Side): boolean {
    return this.hotSide === side || this.hotSide === "both";
  }

  // --- Court geometry (5cm/unit, mirroring shot-chart.ts's own FIBA-ish
  // constants — see the class comment above) ---
  readonly viewBoxWidth = 560;
  readonly viewBoxHeight = 300;
  private readonly unit = 5;

  readonly homeBasketX = 25;
  readonly awayBasketX = this.viewBoxWidth - 25;
  readonly basketY = this.viewBoxHeight / 2;
  readonly rimRadius = 4.5;

  readonly homeBackboardX = this.homeBasketX - 3;
  readonly awayBackboardX = this.awayBasketX + 3;
  readonly backboardY1 = this.basketY - 18;
  readonly backboardY2 = this.basketY + 18;

  private readonly restrictedAreaRadius = 25;
  readonly homeRestrictedAreaPath = `M ${this.homeBasketX} ${this.basketY - this.restrictedAreaRadius} A ${this.restrictedAreaRadius} ${this.restrictedAreaRadius} 0 0 1 ${this.homeBasketX} ${this.basketY + this.restrictedAreaRadius}`;
  readonly awayRestrictedAreaPath = `M ${this.awayBasketX} ${this.basketY - this.restrictedAreaRadius} A ${this.restrictedAreaRadius} ${this.restrictedAreaRadius} 0 0 0 ${this.awayBasketX} ${this.basketY + this.restrictedAreaRadius}`;

  private readonly keyHalfWidth = 49;
  private readonly freeThrowLineDepth = 114; // distance from baseline to free-throw line
  readonly keyTopY = this.basketY - this.keyHalfWidth;
  readonly keyHeight = this.keyHalfWidth * 2;
  readonly homeKeyX = 0;
  readonly awayKeyX = this.viewBoxWidth - this.freeThrowLineDepth;
  readonly keyWidth = this.freeThrowLineDepth;

  readonly freeThrowRadius = 18;
  readonly homeFreeThrowX = this.freeThrowLineDepth;
  readonly awayFreeThrowX = this.viewBoxWidth - this.freeThrowLineDepth;

  readonly centerX = this.viewBoxWidth / 2;
  readonly centerCircleRadius = 18;

  private readonly threePointRadius = 135;
  private readonly cornerOffset = 132;
  private readonly cornerMeet = Math.sqrt(this.threePointRadius ** 2 - this.cornerOffset ** 2);
  private readonly cornerTopY = this.basketY - this.cornerOffset;
  private readonly cornerBottomY = this.basketY + this.cornerOffset;

  readonly homeThreePointPath = `
    M 0 ${this.cornerTopY}
    L ${this.homeBasketX + this.cornerMeet} ${this.cornerTopY}
    A ${this.threePointRadius} ${this.threePointRadius} 0 0 1 ${this.homeBasketX + this.cornerMeet} ${this.cornerBottomY}
    L 0 ${this.cornerBottomY}
  `;

  readonly awayThreePointPath = `
    M ${this.viewBoxWidth} ${this.cornerTopY}
    L ${this.awayBasketX - this.cornerMeet} ${this.cornerTopY}
    A ${this.threePointRadius} ${this.threePointRadius} 0 0 0 ${this.awayBasketX - this.cornerMeet} ${this.cornerBottomY}
    L ${this.viewBoxWidth} ${this.cornerBottomY}
  `;

  // Logo watermark centers — one per half, big and faint (like shot-chart's
  // player-photo watermark, no clip-path needed since these logos already
  // ship as transparent-background PNGs).
  readonly logoSize = 170;
  readonly homeLogoX = this.centerX / 2 - this.logoSize / 2;
  readonly awayLogoX = this.centerX + this.centerX / 2 - this.logoSize / 2;
  readonly logoY = this.basketY - this.logoSize / 2;
}
