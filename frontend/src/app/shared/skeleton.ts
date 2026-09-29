import { Component, Input } from "@angular/core";

// Drop-in replacement for a plain `animate-pulse bg-line` placeholder box.
// Reworked 2026-09-29 ("our loader is a vanilla one"): instead of the whole
// box blinking with a faint spinner in the middle, a soft team-tinted shine
// sweeps across it — the loading pattern most modern apps use, and it
// reads as progress rather than a flashing grey rectangle. Callers still
// control shape/size via classes on the host (h-24, rounded-2xl, etc.).
@Component({
  selector: "app-skeleton",
  standalone: true,
  template: `<div class="skeleton-shine absolute inset-0" aria-hidden="true"></div>`,
  styles: [
    `
      .skeleton-shine {
        background: linear-gradient(
          100deg,
          transparent 20%,
          color-mix(in srgb, var(--accent-primary) 16%, transparent) 40%,
          color-mix(in srgb, var(--color-card) 55%, transparent) 50%,
          color-mix(in srgb, var(--accent-primary) 16%, transparent) 60%,
          transparent 80%
        );
        transform: translateX(-100%);
        animation: skeleton-shine 1.4s ease-in-out infinite;
      }
      @keyframes skeleton-shine {
        to {
          transform: translateX(100%);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .skeleton-shine {
          animation: none;
          opacity: 0.4;
          transform: none;
        }
      }
    `,
  ],
  host: { class: "relative block overflow-hidden bg-line", "aria-busy": "true" },
})
export class SkeletonComponent {
  // Kept for API compatibility with existing callers; the shine replaced
  // the centred spinner these used to control, so they no longer render.
  @Input() icon = true;
  @Input() iconSize = 18;
}
