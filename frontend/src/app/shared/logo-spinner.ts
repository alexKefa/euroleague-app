import { Component, Input } from "@angular/core";

// Bouncing basketball, tinted to the viewer's team color (2026-09-18,
// "spinning ball with preferred team color", then corrected same pass —
// "that is not a ball. do a bounce animation") — replacing the old 3-bar
// audio-equalizer pulse. That old mark's own comment claimed it matched
// "the same rects as app.component.html's nav logo" — stale even before
// this pass: the real nav logo has been a raster illustration (hoop/
// backboard/ball, see CLAUDE.md's Branding section) for a while, not
// vector bars, so the old spinner didn't actually match anything anymore.
// Reusing the real logo mark directly was considered and passed over for
// a concrete technical reason: it's a two-file raster PNG (light/dark
// variants), not easily recolorable to an arbitrary team color via CSS —
// a hand-drawn vector ball is trivially tintable instead.
// First attempt (rotation) didn't actually read as a ball — spinning a
// near-symmetric seam pattern (vertical + horizontal + two mirrored
// curves, each roughly 180°-rotationally-symmetric) barely looks like
// it's moving at all, and no live browser this pass to catch that before
// shipping it. Redone two ways: (1) simplified the seam pattern into one
// path (vertical + horizontal + two side curves) matching the standard
// minimal basketball glyph rather than my first hand-tuned curve, and
// (2) swapped rotation for an actual bounce — translateY up off a fixed
// baseline with a squash-on-landing/stretch-in-air scale, anchored at the
// ball's own bottom edge (transform-origin 50% 100%) so the squash reads
// as compressing against a floor, not the ball's center.
// Real bug in that first redo, caught the same pass ("fix the lines on
// the edges to not go outside the ball shape"): the side-curve endpoints
// (4.8, 5.6) etc. weren't actually checked against the circle's own
// math — at distance ~9.63 from center on a r=9 circle, they sat outside
// it. Recomputed properly (x = 12 ± sqrt(81 - 6.4²) for the y=5.6/18.4
// curve endpoints, so they land exactly ON the circle) and dropped
// stroke-linecap="round" — the vertical/horizontal cross's endpoints are
// already exactly on the circle too, and a round cap extends the stroke
// ~half its width past the mathematical endpoint, which poked those past
// the edge as well even though the line's own path didn't.
// Uses BOTH team colors together, not just one: the ball's body is
// team-primary (fill), the seam lines are team-secondary (stroke) — same
// contrast reasoning as every other solid-team-color-fill element this
// session (button.directive.ts's primary variant, the dashboard/fantasy/
// predictions/album tab switchers): a near-white team primary (Real
// Madrid, Dubai Basketball) needs a seam color that's built to contrast
// against it, not a fixed dark tone that could vanish against a dark
// team color instead. Falls back to the same neutral DEFAULT_PRIMARY/
// DEFAULT_SECONDARY every other team-colored element already falls back
// to pre-team-selection.
@Component({
  selector: "app-logo-spinner",
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" aria-hidden="true">
      <g class="ball-bounce">
        <circle cx="12" cy="12" r="9" class="fill-team-primary" />
        <path
          d="M12 3 V21 M3 12 H21 M5.67 5.6 C 9 9, 9 15, 5.67 18.4 M18.33 5.6 C 15 9, 15 15, 18.33 18.4"
          class="stroke-team-secondary"
          stroke-width="1.3"
          fill="none"
        />
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .ball-bounce {
        transform-box: fill-box;
        transform-origin: 50% 100%;
        animation: ball-bounce 0.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      @keyframes ball-bounce {
        0%,
        100% {
          transform: translateY(0) scale(1.12, 0.88);
        }
        15% {
          transform: translateY(-1px) scale(1, 1);
        }
        50% {
          transform: translateY(-7px) scale(1, 1);
        }
        85% {
          transform: translateY(-1px) scale(1, 1);
        }
      }
    `,
  ],
})
export class LogoSpinnerComponent {
  @Input() size = 20;
}
