import { Component, computed, input } from "@angular/core";

// NOTE (2026-09-29): the floor is no longer hardwood — see the "tactics
// board" comment in the template. The long history comments below about
// the wood gradient, plank seams, emboss filter and line lighting describe
// the previous design and are kept only as history.

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
      <!-- "Tactics board" restyle (2026-09-29, "too vanilla, doesn't match
           our whole concept"): the realistic orange hardwood (wood grain,
           embossed cream lines, warm spotlight) is replaced by the app's own
           language — theme page colour for the floor, a wash of the viewer's
           team colour toward the basket, a faint dot grid, thin ink lines and
           a team-colour paint + rim glow. Built from CSS variables, so it
           follows both the light/dark theme and the favourite team. All
           geometry (key, arcs, flip, viewBox) is unchanged. -->
      <defs>
        <!-- Pre-flip y grows toward the basket (displayed at the top after
             the flip below), so the team wash strengthens toward offset 1. -->
        <linearGradient id="courtTeamWash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.04" />
          <stop offset="65%" stop-color="var(--accent-primary)" stop-opacity="0.14" />
          <stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0.32" />
        </linearGradient>
        <radialGradient id="courtRimGlow" cx="0.5" cy="0.82" r="0.42">
          <stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.45" />
          <stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0" />
        </radialGradient>
        <!-- Floor planks + a clip for the centre circle (2026-10-06 court pass). -->
        <pattern id="courtPlanks" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect x="19.4" y="0" width="0.6" height="20" fill="var(--color-ink)" fill-opacity="0.05" />
        </pattern>
        <clipPath id="courtFloorClip">
          <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="10" />
        </clipPath>
        <pattern id="courtDotGrid" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="0.8" fill="var(--color-ink)" fill-opacity="0.13" />
        </pattern>
      </defs>
      <g [attr.transform]="'translate(0, ' + flipConstant() + ') scale(1, -1)'">
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="10" fill="var(--color-page)" />
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="10" fill="url(#courtTeamWash)" />
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="10" fill="url(#courtPlanks)" />
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="10" fill="url(#courtDotGrid)" />
        <!-- Half-court line + team-colour centre circle at the far end
             (the bottom of the displayed court), which used to be bare floor
             on the tall mobile court (2026-10-06 court pass). -->
        <g clip-path="url(#courtFloorClip)">
          <line x1="6" x2="314" [attr.y1]="floorTop() + 1" [attr.y2]="floorTop() + 1" stroke="var(--accent-primary)" stroke-opacity="0.55" stroke-width="2" />
          <circle cx="160" [attr.cy]="floorTop()" r="40" fill="var(--accent-primary)" fill-opacity="0.16" stroke="var(--accent-primary)" stroke-opacity="0.7" stroke-width="1.8" />
          <circle cx="160" [attr.cy]="floorTop()" r="14" fill="none" stroke="var(--accent-primary)" stroke-opacity="0.5" stroke-width="1.4" />
        </g>
        <rect x="6" [attr.y]="floorTop()" width="308" [attr.height]="floorHeight()" rx="10" fill="url(#courtRimGlow)" />
        <path [attr.d]="courtOutlinePath()" fill="none" stroke="var(--color-ink)" stroke-opacity="0.28" stroke-width="1.6" />
        <rect
          [attr.x]="keyLeftX"
          [attr.y]="freeThrowLineY"
          [attr.width]="keyWidth"
          [attr.height]="keyHeight"
          rx="2"
          fill="var(--accent-primary)"
          fill-opacity="0.2"
          stroke="var(--accent-primary)"
          stroke-opacity="0.85"
          stroke-width="1.8"
        />
        <circle [attr.cx]="basketX" [attr.cy]="freeThrowLineY" [attr.r]="freeThrowCircleRadius" fill="none" stroke="var(--accent-primary)" stroke-opacity="0.7" stroke-width="1.6" />
        <path [attr.d]="restrictedAreaPath" fill="none" stroke="var(--color-ink)" stroke-opacity="0.35" stroke-width="1.4" />
        <path [attr.d]="threePointArcPath" fill="none" stroke="var(--color-ink)" stroke-opacity="0.38" stroke-width="1.8" />
      </g>
      <!-- Center-court logo decal (2026-09-16) — now the real current app
           mark (brand/clutch-icon-dark.svg, the icon-only crop of the live logo,
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
      <image href="/brand/clutch-icon-dark.svg" x="102" [attr.y]="logoY()" width="120" height="88" opacity="0.1" preserveAspectRatio="xMidYMid meet" />
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
