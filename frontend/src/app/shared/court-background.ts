import { Component, computed, input } from "@angular/core";

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
//
// Responsive viewBox (2026-09-18, "expand svg for mobile as well. you just
// expanded the court box. not the actual court") — the mobile container
// (fantasy.html) got a taller aspect ratio the same day, but this SVG's own
// viewBox stayed fixed at 320x300 under "meet" mode, so the art itself
// stayed the same size and just gained more empty letterbox padding above/
// below instead of actually growing. "none" (a real stretch, tried once before
// for the same box-height problem) is not the fix either — it non-
// uniformly scales the circles/arcs into ovals ("court looks stretched").
// The actual fix, same technique the original 210->300 viewBox extension
// already used: grow the viewBox itself with MORE open floor, not a
// stretch of existing geometry — so "meet" has nothing left to letterbox
// once the art's own aspect ratio matches the container's.
// viewBoxTop (input, default -90 = today's desktop/unchanged behavior) is
// the single knob: everything below derives from it, all anchored to the
// same fixed baselineY=210 bottom edge so the basket/key/arc geometry
// itself never moves, only how much extra floor exists above it:
//   viewBoxHeight = baselineY - viewBoxTop  (the art's own aspect ratio)
//   floorTop      = viewBoxTop + 6          (same 6-unit margin as before)
//   floorHeight   = baselineY - floorTop
//   flipConstant  = viewBoxTop + baselineY  (keeps baselineY flipping onto
//                                             exactly the viewBox's own top
//                                             edge, same alignment the
//                                             original 120 constant gave —
//                                             120 = -90 + 210)
//   logoY         = viewBoxTop + 140        (slides the center-court decal
//                                             by the same delta as the top
//                                             edge, so it stays roughly
//                                             mid-floor rather than
//                                             drifting toward one edge)
// At the default -90, every one of these reduces to exactly the prior
// hardcoded constant (300/-84/294/120/50) — confirmed by hand, not just
// assumed — so this is a pure generalization with zero behavior change for
// desktop. fantasy.html passes viewBoxTop=-220 on mobile (matching its own
// aspect-[320/430] box exactly: 210-(-220)=430, so "meet" has zero
// letterbox left to show there either) via its existing isMobileViewport
// signal. Not verified live — the derivation is exact, but real pixel
// alignment (e.g. whether ROW_TOP's cosmetic row percentages still read
// well against the now letterbox-free, fully-expanded mobile art) hasn't
// been eyeballed in a browser this pass.
//
// Depth pass (2026-09-18, "3D essence" ask) — a real perspective tilt was
// considered and deliberately rejected: the draggable player slots
// (fantasy.html) are absolutely-positioned by hand-calibrated percentage
// over this SVG, and skewing the court itself would throw that alignment
// off with no live browser in this pass to re-verify pixel-by-pixel
// against. Depth instead comes from lighting/shadow only, nothing moves:
// (1) courtSpotlight, a soft overhead radial glow near the key, like arena
// lighting; (2) lineEmboss, an feDropShadow on the court lines/key/arcs
// (wrapped in their own <g>, not applied to the floor) so they read as
// carved/raised rather than flat-printed; (3) the existing vignette
// deepened (0.3 -> 0.45 max opacity) for a stronger corner falloff. Same
// "material identity doesn't shift with the theme toggle" reasoning as
// before — every new value here is a fixed tone, not theme-reactive.
@Component({
  selector: "app-court-background",
  standalone: true,
  template: `
    <!-- Reverted to "meet" (2026-09-17) — "none" (tried the same pass, to
         fill the container's new taller mobile ratio without letterboxing)
         visibly distorted the court's circles/arcs into ovals, reported
         live as "court looks stretched". "meet" always scales uniformly
         (no distortion) at the cost of letterboxing if the container's
         ratio doesn't exactly match this SVG's own 320x300 — fantasy.html
         dialed the mobile ratio back closer to that shape for the same
         reason, so whatever gap remains reads as intentional breathing
         room (the wrapper's own gradient shows through) rather than a
         glaring empty band. -->
    <svg [attr.viewBox]="'0 ' + viewBoxTop() + ' 320 ' + viewBoxHeight()" class="w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid meet">
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
        <!-- Overhead arena-light glow, centered over the key/paint — a soft
             warm highlight the floor gradient/vignette alone don't give, so
             the court reads as lit from above rather than a flat color
             fill. This rect lives INSIDE the flip group below, so cy is
             chosen in that group's own pre-flip local space: cy=0.76 of
             the floor rect's own y=-84..210 span lands at local y=140
             (between freeThrowLineY=96 and basketY=185, i.e. over the
             paint) — after the group's translate(0,120) scale(1,-1),
             that's displayed near the top of the court, where the flip
             comment above already moved the key/basket to. (A first pass
             at cy=0.32 skipped this local/pre-flip math entirely and
             ended up glowing over the open floor near mid-screen instead
             — caught rereading the flip transform, not live-verified.) -->
        <radialGradient id="courtSpotlight" cx="0.5" cy="0.76" r="0.5">
          <stop offset="0%" stop-color="#fff3d8" stop-opacity="0.55" />
          <stop offset="60%" stop-color="#fff3d8" stop-opacity="0.14" />
          <stop offset="100%" stop-color="#fff3d8" stop-opacity="0" />
        </radialGradient>
        <!-- Plank seams — thin darker verticals every 16 units (~20 across
             the 308-wide floor), just enough to read as real wood grain
             rather than a flat color fill, at low enough opacity to stay
             behind the court lines and player avatars. -->
        <pattern id="courtWoodGrain" width="16" [attr.height]="floorHeight()" patternUnits="userSpaceOnUse" [attr.patternTransform]="'translate(6, ' + floorTop() + ')'">
          <line x1="16" y1="0" x2="16" [attr.y2]="floorHeight()" stroke="#5a3512" stroke-opacity="0.14" stroke-width="1" />
        </pattern>
        <!-- Carved/raised look for the court lines and key — a drop shadow
             just below-right of each line, not applied to the floor itself
             (wrapped around its own <g> below), so the paint/markings lift
             off the wood rather than the whole court tilting. -->
        <filter id="lineEmboss" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="0.8" flood-color="#3a2004" flood-opacity="0.55" />
        </filter>
        <!-- The lines themselves pick up the same top-lit direction as
             courtSpotlight above, instead of a flat cream stroke — bright
             near the key/baseline (pre-flip y=210, displayed at the top
             post-flip, same place courtSpotlight is brightest) fading to a
             slightly dimmer cream toward the far edge (pre-flip y=-84,
             displayed at the bottom). userSpaceOnUse + the same basketX/
             baselineY constants the paths below are drawn with, so this
             stays correct if that geometry is ever recalibrated.
             Real bug caught after this first shipped: the dim stop
             originally went all the way to a khaki/tan (#cdb689) — close
             enough to the amber courtFloorGradient underneath that the
             long sidelines (mostly in that dim half of the gradient, since
             they run the court's full length) visually disappeared into
             the wood ("i dont see side lines"). Every stop below now
             stays in the bright cream/white family so contrast against the
             floor never collapses, at the cost of a subtler light-to-dark
             swing than first attempted. -->
        <linearGradient id="lineLightGradient" gradientUnits="userSpaceOnUse" x1="160" y1="210" x2="160" y2="-84">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="50%" stop-color="#fdf3e2" />
          <stop offset="100%" stop-color="#f0e4c8" />
        </linearGradient>
      </defs>
      <!-- Flipped vertically (2026-09-17, "switch sides — go to the other
           side (top)" ask) — the key/basket end used to render at the
           bottom of this box (baselineY=210, the viewBox's own bottom
           edge) with open floor up top, matching fantasy.ts's old
           ROW_TOP (Center near the bottom at 80%). A reference EuroLeague
           Fantasy screenshot instead puts the key/basket at the TOP with
           the Center standing right at it, guards toward open floor at
           the bottom — the more common "looking downcourt" convention.
           translate(0,120) scale(1,-1) mirrors every y-coordinate as
           newY = 120 - oldY around the viewBox's own vertical midpoint
           (-90 and 210 average to 60; the extra +60 lands the flip axis
           at 120 in the group's local pre-translate space) — cheaper and
           safer than hand-recalculating every path/rect's y-coordinate
           individually, and doesn't touch a single one of the calibrated
           geometry constants below (basketY, freeThrowLineY, etc.) — they
           stay exactly as calibrated, just rendered through this one
           transform. fantasy.ts's ROW_TOP was flipped to match
           (100 - old value each), same flip-around-center math. -->
      <g [attr.transform]="'translate(0, ' + flipConstant() + ') scale(1, -1)'">
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="4" fill="url(#courtFloorGradient)" />
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="4" fill="url(#courtWoodGrain)" />
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="4" fill="url(#courtSpotlight)" />
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="4" fill="url(#courtSheenGradient)" />
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="4" fill="url(#courtVignette)" />
        <g filter="url(#lineEmboss)">
          <!-- Full rectangle, flat bright stroke (2026-09-18 redo) — the
             mobile trapezoid clip on the whole component (fantasy.html)
             that used to sit over this court is gone now (it clipped away
             most of each sideline's length, causing "i dont see side
             lines"); the outer div's own rounded-2xl overflow-hidden is
             the only clip left. courtOutlinePath now closes into a real 4-
             sided rectangle (it used to deliberately skip the near
             baseline) since there's no longer a reason to leave one side
             open. Kept on a flat stroke rather than lineLightGradient —
             a plain, always-visible boundary. -->
          <path [attr.d]="courtOutlinePath()" fill="none" stroke="#fdf3e2" stroke-width="2.2" opacity="0.95" />
          <rect
            [attr.x]="keyLeftX"
            [attr.y]="freeThrowLineY"
            [attr.width]="keyWidth"
            [attr.height]="keyHeight"
            fill="var(--accent-primary)"
            fill-opacity="0.28"
            stroke="url(#lineLightGradient)"
            stroke-width="2.2"
            stroke-opacity="0.95"
          />
          <circle [attr.cx]="basketX" [attr.cy]="freeThrowLineY" [attr.r]="freeThrowCircleRadius" fill="none" stroke="url(#lineLightGradient)" stroke-width="2.2" opacity="0.95" />
          <path [attr.d]="restrictedAreaPath" fill="none" stroke="url(#lineLightGradient)" stroke-width="1.7" opacity="0.95" />
          <path [attr.d]="threePointArcPath" fill="none" stroke="url(#lineLightGradient)" stroke-width="2.2" opacity="0.95" />
        </g>
      </g>
      <!-- Center-court logo decal (2026-09-16) — now the real current app
           mark (clutch-icon-dark.png, the icon-only crop of the live logo,
           see CLAUDE.md's Branding section), not the extracted Archivo
           Black "C" glyph this used to be. That vector "C" was kept here
           specifically because it had no raster dependency and this decal
           needed to stay a lightweight path — moot now that the app's own
           logo is the source of truth for "the mark" everywhere else, so
           matching it here beats a bespoke vector stand-in that's already
           stale the moment the real logo changes again. The PNG's own
           transparency is used as-is, no reprocessing — same file every
           other icon-only usage (nav bar, /welcome header) renders.
           The "-dark" file (light-on-dark artwork), not the light variant, since its
           pale linework reads as a subtle sheen on this warm floor color,
           closer to the old decal's own pale #eef3f7 fill than the light
           variant's dark linework would. Fixed regardless of app
           light/dark theme — same "this floor's identity doesn't shift
           with the theme toggle" reasoning as the rest of this component —
           painted over the floor but under the real court lines so the
           key/arc strokes stay crisp on top of it.
           Deliberately kept OUTSIDE the flip group above and unrotated
           (2026-09-17) — flipping it along with the floor would render the
           logo upside-down, not just relocated. It happened to sit close
           to the viewBox's own vertical midpoint already (old y=19-107,
           center y=63, almost exactly the flip axis at 60), so it barely
           needed to move — nudged down (y=19->50) for real margin from the
           key's new top-edge boundary (the key's bottom, at
           flip(freeThrowLineY)=flip(96)=24, is now visually the top of
           open floor via the sibling group's flip — y=50 leaves 26 units
           of clearance below it, unlike the tighter first pass at y=40). -->
      <image href="/clutch-icon-dark.png" x="102" [attr.y]="logoY()" width="120" height="88" opacity="0.2" preserveAspectRatio="xMidYMid meet" />
    </svg>
  `,
})
export class CourtBackgroundComponent {
  // See the "Responsive viewBox" doc comment above the @Component
  // decorator for the full derivation. Default -90 is today's desktop
  // shape (unchanged); fantasy.html passes -220 on mobile.
  readonly viewBoxTop = input(-90);
  readonly viewBoxHeight = computed(() => this.baselineY - this.viewBoxTop());
  readonly floorTop = computed(() => this.viewBoxTop() + 6);
  readonly floorHeight = computed(() => this.baselineY - this.floorTop());
  readonly flipConstant = computed(() => this.viewBoxTop() + this.baselineY);
  readonly logoY = computed(() => this.viewBoxTop() + 140);

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

  // Top boundary sits at floorTop (6 units in from the viewBox's own top
  // edge, same 6-unit margin the original 320x210 viewBox used against its
  // own y=0 top edge) rather than a fixed number now — floorTop is
  // computed from the responsive viewBoxTop input (see the "Responsive
  // viewBox" doc comment above the @Component decorator), so this stays
  // correct whether it's rendering the desktop or mobile shape.
  //
  // Redone as a closed 4-sided rectangle (2026-09-18) — it used to stop
  // one side short (no near-baseline segment) specifically to stay clear
  // of the trapezoid clip-path that sat over this whole component; now
  // that clip is gone (see fantasy.html and the outline's own template
  // comment above), a plain closed rectangle is simpler and has no reason
  // to leave a side open. Z closes back to the starting point.
  //
  // Also converted from a plain string to a computed() the same pass
  // (responsive viewBox) — it now reads floorTop(), a signal, so it has to
  // recompute reactively rather than being fixed at construction time.
  readonly courtOutlinePath = computed(
    () => `
    M 6 ${this.baselineY}
    L 6 ${this.floorTop()}
    L 314 ${this.floorTop()}
    L 314 ${this.baselineY}
    Z
  `
  );

  readonly threePointArcPath = `
    M ${this.threePointLeftCornerX} ${this.baselineY}
    L ${this.threePointLeftCornerX} ${this.threePointArcTopY}
    A ${this.threePointRadius} ${this.threePointRadius} 0 0 1 ${this.threePointCornerX} ${this.threePointArcTopY}
    L ${this.threePointCornerX} ${this.baselineY}
  `;

  readonly restrictedAreaPath = `M ${this.restrictedAreaLeftX} ${this.basketY} A ${this.restrictedAreaRadius} ${this.restrictedAreaRadius} 0 0 1 ${this.restrictedAreaRightX} ${this.basketY}`;
}
