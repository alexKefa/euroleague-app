import { Component } from "@angular/core";

// Bare decorative half-court backdrop for the Fantasy Five lineup builder —
// same hand-rolled-SVG approach and geometry as shot-chart.ts (1 unit = 5cm,
// FIBA-approximate key/arc/restricted-area), just without the shot markers,
// zone legend, or player-photo watermark, since here the "markers" are the
// draggable player slots overlaid on top by the caller
// (frontend/src/app/features/fantasy/fantasy.html) as real HTML elements,
// not SVG nodes — Angular CDK's drag-drop needs actual DOM elements to
// attach to, not raw SVG shapes, so this component stays purely decorative
// and pointer-events-none; the interactive slots are a sibling
// absolutely-positioned overlay, not children of this SVG.
//
// viewBox is 320x300, not shot-chart.ts's native 320x210 (2026-09-06) — the
// caller's court container is a taller 320/300 box (widened for bigger slot
// avatars), and this SVG used to keep the original 320x210 viewBox with
// `preserveAspectRatio="meet"` inside it, which letterboxes rather than
// stretches: the art rendered at its native ratio, centered, occupying only
// the middle ~70% of the container's height. Extended the viewBox to 300
// (the extra 90 units added above the 3-point line as more open half-court
// floor, not stretched into the basket/key/arc geometry) so the art fills
// the container edge-to-edge instead.
//
// The rim AND backboard are gone now, not just repositioned — first tried
// recalibrating fantasy.ts's ROW_TOP percentages to the corrected (post-
// letterbox-fix) geometry so "Center" would land in the paint above the rim
// instead of on it ("center is over the rim, does not look good"), then
// removed the rim circle outright when that still wasn't enough — reported
// as still overlapping ("over the line of the rim") even with the circle
// gone, most likely the backboard line sitting right where the rim used to
// be. There's no live browser in this session to verify exact pixel
// geometry, so rather than keep guessing at which specific line is the
// culprit, both are gone: nothing basket-shaped remains for a slot avatar
// to visually collide with, regardless of exactly where it lands.
//
// A translucent glass-floor gradient (glassFloorGradient/glassSheenGradient
// below, painted as the bottom-most layer before the court lines) replaces
// the plain transparent backdrop the lines used to float on — a slot
// avatar now visually reads as "standing on a floor" wherever it lands,
// rather than as a circle overlapping a thin line on nothing. Picked glass
// over a literal wood-grain texture to match this app's existing gradient-
// heavy, non-skeuomorphic visual language (team-hero-sweep, the
// collectible cards' holo-sweep, etc. — see CLAUDE.md) rather than
// introducing a photographic/textured look that would be the only one of
// its kind in the app. Deliberately not theme-reactive (fixed cool-blue
// tones, not --color-page/--color-card) — like the highlight accent color,
// a glass floor's icy look is a stylistic identity that should stay
// consistent whether the app is in light or dark mode, not shift with it.
@Component({
  selector: "app-court-background",
  standalone: true,
  template: `
    <svg viewBox="0 -90 320 300" class="w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="glassFloorGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#cfe6f2" stop-opacity="0.22" />
          <stop offset="55%" stop-color="#6f93ab" stop-opacity="0.14" />
          <stop offset="100%" stop-color="#101a24" stop-opacity="0.32" />
        </linearGradient>
        <linearGradient id="glassSheenGradient" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0" />
          <stop offset="45%" stop-color="#ffffff" stop-opacity="0.14" />
          <stop offset="55%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect x="6" y="-84" width="308" height="294" rx="4" fill="url(#glassFloorGradient)" />
      <rect x="6" y="-84" width="308" height="294" rx="4" fill="url(#glassSheenGradient)" />
      <!-- Center-court logo decal — the app's own standalone icon
           ("Bracket", 2026-09-12: three straight bars forming an open
           bracket with a backboard shooting-square nested inside, same
           path data as favicon-v6.svg, replacing the retired
           ring+curved-line+ball mark), faint and fixed-color like the
           rest of this glass floor rather than theme-reactive, painted
           over the floor but under the real court lines so the key/arc
           strokes stay crisp on top of it. -->
      <g transform="translate(160 63) scale(1.7) translate(-49 -50)" opacity="0.16">
        <rect x="24" y="22" width="12" height="56" rx="3" fill="#eef3f7" />
        <rect x="32" y="22" width="42" height="12" rx="3" fill="#eef3f7" />
        <rect x="32" y="66" width="42" height="12" rx="3" fill="#eef3f7" />
        <circle cx="58" cy="50" r="15" fill="#eef3f7" />
      </g>
      <path [attr.d]="courtOutlinePath" fill="none" class="stroke-muted" stroke-width="1.8" opacity="0.85" />
      <rect
        [attr.x]="keyLeftX"
        [attr.y]="freeThrowLineY"
        [attr.width]="keyWidth"
        [attr.height]="keyHeight"
        fill="none"
        class="stroke-muted"
        stroke-width="1.8"
        opacity="0.85"
      />
      <circle [attr.cx]="basketX" [attr.cy]="freeThrowLineY" [attr.r]="freeThrowCircleRadius" fill="none" class="stroke-muted" stroke-width="1.8" opacity="0.85" />
      <path [attr.d]="restrictedAreaPath" fill="none" class="stroke-muted" stroke-width="1.4" opacity="0.85" />
      <path [attr.d]="threePointArcPath" fill="none" class="stroke-muted" stroke-width="1.8" opacity="0.85" />
    </svg>
  `,
})
export class CourtBackgroundComponent {
  // --- Court geometry, copied from shot-chart.ts (kept in sync by hand —
  // see that file's own comment on where these FIBA-approximate numbers
  // come from) ---
  readonly basketX = 160;
  readonly basketY = 185;
  readonly baselineY = 210;

  readonly restrictedAreaRadius = 25;
  readonly restrictedAreaLeftX = this.basketX - this.restrictedAreaRadius;
  readonly restrictedAreaRightX = this.basketX + this.restrictedAreaRadius;

  readonly keyHalfWidth = 49;
  readonly keyLeftX = this.basketX - this.keyHalfWidth;
  readonly keyWidth = this.keyHalfWidth * 2;
  readonly freeThrowLineY = 96;
  readonly keyHeight = this.baselineY - this.freeThrowLineY;
  readonly freeThrowCircleRadius = 18;

  readonly threePointRadius = 135;
  readonly threePointCornerX = this.basketX + 132;
  private readonly cornerArcMeetY = Math.sqrt(this.threePointRadius ** 2 - 132 ** 2);
  readonly threePointArcTopY = this.basketY - this.cornerArcMeetY;
  readonly threePointLeftCornerX = this.basketX - 132;

  // Top boundary sits at -84 (6 units in from the viewBox's -90 top edge,
  // same 6-unit margin the original 320x210 viewBox used against its own
  // y=0 top edge) rather than the old fixed 6 — see the viewBox comment
  // above for why this got taller.
  readonly courtOutlinePath = `
    M 6 ${this.baselineY}
    L 6 -84
    L 314 -84
    L 314 ${this.baselineY}
  `;

  readonly threePointArcPath = `
    M ${this.threePointLeftCornerX} ${this.baselineY}
    L ${this.threePointLeftCornerX} ${this.threePointArcTopY}
    A ${this.threePointRadius} ${this.threePointRadius} 0 0 1 ${this.threePointCornerX} ${this.threePointArcTopY}
    L ${this.threePointCornerX} ${this.baselineY}
  `;

  readonly restrictedAreaPath = `M ${this.restrictedAreaLeftX} ${this.basketY} A ${this.restrictedAreaRadius} ${this.restrictedAreaRadius} 0 0 1 ${this.restrictedAreaRightX} ${this.basketY}`;
}
