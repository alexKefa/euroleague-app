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
// Hardwood-court floor (2026-09-16, replacing the earlier "glass floor"
// look) — direct feedback that the icy blue-glass gradient didn't read as
// an actual basketball court and asked for more intense color. Swapped the
// cool translucent glassFloorGradient/glassSheenGradient pair for a warm,
// saturated amber-wood gradient (courtFloorGradient), a subtle repeating
// plank-seam pattern (courtWoodGrain) for real floor texture, a soft corner
// vignette for depth, and a painted key (the keyLeftX/keyWidth/keyHeight
// rect now gets a translucent var(--accent-primary) fill, not just an
// outline) — real broadcast courts paint the lane a distinct color, and
// tying it to the user's own reskin accent echoes this app's existing
// team-color theming rather than introducing an unrelated new color.
// Court lines switched from the muted `stroke-muted` theme color to a
// fixed bright cream (line paint reads white/cream on real hardwood,
// regardless of app theme) at a heavier stroke-width and full opacity for
// real contrast against the now-much-busier floor. Deliberately still not
// theme-reactive (fixed warm tones) — same reasoning as before: a floor's
// material identity shouldn't flip with light/dark mode, only the accent
// tint (already theme-independent itself) ties it to the user's team.
// Geometry (viewBox, courtOutlinePath, keyLeftX/keyWidth/etc., the arc
// paths) is untouched — every one of those numbers was calibrated against
// a live browser in earlier passes (see the calibration comments below and
// in fantasy.ts's ROW_TOP/rowXPositions), and this pass has no live
// browser to re-verify pixel alignment against, so it's colors/fills only.
@Component({
  selector: "app-court-background",
  standalone: true,
  template: `
    <svg viewBox="0 -90 320 300" class="w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="courtFloorGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f0b46a" stop-opacity="0.96" />
          <stop offset="50%" stop-color="#d68a3e" stop-opacity="0.94" />
          <stop offset="100%" stop-color="#96551f" stop-opacity="0.96" />
        </linearGradient>
        <linearGradient id="courtSheenGradient" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0" />
          <stop offset="45%" stop-color="#ffffff" stop-opacity="0.22" />
          <stop offset="55%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
        <radialGradient id="courtVignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="55%" stop-color="#000000" stop-opacity="0" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.3" />
        </radialGradient>
        <!-- Plank seams — thin darker verticals every 16 units (~20 across
             the 308-wide floor), just enough to read as real wood grain
             rather than a flat color fill, at low enough opacity to stay
             behind the court lines and player avatars. -->
        <pattern id="courtWoodGrain" width="16" height="294" patternUnits="userSpaceOnUse" patternTransform="translate(6, -84)">
          <line x1="16" y1="0" x2="16" y2="294" stroke="#5a3512" stroke-opacity="0.14" stroke-width="1" />
        </pattern>
      </defs>
      <rect x="6" y="-84" width="308" height="294" rx="4" fill="url(#courtFloorGradient)" />
      <rect x="6" y="-84" width="308" height="294" rx="4" fill="url(#courtWoodGrain)" />
      <rect x="6" y="-84" width="308" height="294" rx="4" fill="url(#courtSheenGradient)" />
      <rect x="6" y="-84" width="308" height="294" rx="4" fill="url(#courtVignette)" />
      <!-- Center-court logo decal — the "C" mark (2026-09-12: the real
           Archivo Black "C" glyph outline, extracted once via fontTools so
           it's a plain vector path with no runtime font dependency,
           replacing the retired bracket+ball mark), faint and fixed-color
           like the rest of this floor rather than theme-reactive,
           painted over the floor but under the real court lines so the
           key/arc strokes stay crisp on top of it. Deliberately NOT
           swapped for the v8 (2026-09-13) illustrated mark used elsewhere —
           that mark is a raster PNG with no vector source, and this decal
           needs to stay a lightweight vector path rendered at 0.16 opacity;
           the old standalone favicon this path used to match (favicon-v7.svg)
           is gone, but the path itself is unaffected — it was always this
           app's own extracted "C" outline, not the favicon file itself. -->
      <g transform="translate(160 63) scale(1.7) translate(-49 -50)" opacity="0.16">
        <g transform="translate(50 50) scale(0.09 -0.09) translate(-389 -344)">
          <path d="M733 405H522Q522 465 490.5 500.0Q459 535 401 535Q334 535 302.5 493.0Q271 451 271 376V312Q271 238 302.5 195.5Q334 153 399 153Q463 153 496.0 186.0Q529 219 529 279H733Q733 138 646.5 63.0Q560 -12 402 -12Q226 -12 135.5 78.0Q45 168 45 344Q45 520 135.5 610.0Q226 700 402 700Q555 700 644.0 623.5Q733 547 733 405Z" fill="#eef3f7" />
        </g>
      </g>
      <path [attr.d]="courtOutlinePath" fill="none" stroke="#fdf3e2" stroke-width="2.2" opacity="0.95" />
      <rect
        [attr.x]="keyLeftX"
        [attr.y]="freeThrowLineY"
        [attr.width]="keyWidth"
        [attr.height]="keyHeight"
        fill="var(--accent-primary)"
        fill-opacity="0.28"
        stroke="#fdf3e2"
        stroke-width="2.2"
        stroke-opacity="0.95"
      />
      <circle [attr.cx]="basketX" [attr.cy]="freeThrowLineY" [attr.r]="freeThrowCircleRadius" fill="none" stroke="#fdf3e2" stroke-width="2.2" opacity="0.95" />
      <path [attr.d]="restrictedAreaPath" fill="none" stroke="#fdf3e2" stroke-width="1.7" opacity="0.95" />
      <path [attr.d]="threePointArcPath" fill="none" stroke="#fdf3e2" stroke-width="2.2" opacity="0.95" />
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
