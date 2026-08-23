import { Component } from "@angular/core";

// A small hand icon pressing down and releasing, hinting the card-preview's
// tap-to-flip gesture. Purely decorative — pointer-events: none — sits
// centered over the card and gets dismissed for good on first real
// interaction with it (see CardPreviewComponent.dismissGestureHint), same
// "learn once, never again" pattern as PageHintComponent, just
// interaction-triggered instead of an explicit close button.
//
// A plain rounded blob with a single straight digit on top reads as an
// obscene gesture, not "tap here" (found the hard way) — the knuckle
// bumps and a solid thumb below break the silhouette up enough that it
// reads unambiguously as a hand instead.
@Component({
  selector: "app-gesture-hint",
  standalone: true,
  template: `
    <svg width="46" height="46" viewBox="0 0 40 40" fill="none" class="hand">
      <g transform="rotate(14 20 21)">
        <!-- index finger -->
        <rect x="10" y="5" width="7.5" height="17" rx="3.75" class="fill-card stroke-ink" stroke-width="1.4" />
        <!-- curled-finger knuckles -->
        <circle cx="17.5" cy="21" r="3.6" class="fill-card stroke-ink" stroke-width="1.4" />
        <circle cx="23.5" cy="21.5" r="3.4" class="fill-card stroke-ink" stroke-width="1.4" />
        <circle cx="28.5" cy="23" r="3" class="fill-card stroke-ink" stroke-width="1.4" />
        <!-- palm -->
        <rect x="11" y="22" width="19" height="11" rx="5.5" class="fill-card stroke-ink" stroke-width="1.4" />
        <!-- thumb -->
        <rect
          x="3.5"
          y="24.5"
          width="10"
          height="6.5"
          rx="3.25"
          class="fill-card stroke-ink"
          stroke-width="1.4"
          transform="rotate(-22 8.5 27.75)"
        />
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        pointer-events: none;
      }
      .hand {
        transform-origin: 42% 32%;
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45));
        animation: gesture-tap 1.3s ease-in-out infinite;
      }
      @keyframes gesture-tap {
        0%,
        20%,
        100% {
          transform: translateY(0) scale(1);
        }
        45%,
        65% {
          transform: translateY(5px) scale(0.9);
        }
      }
    `,
  ],
})
export class GestureHintComponent {}
