import { Component, Input } from "@angular/core";

// The app's own 3-bar wordmark (same rects as app.component.html's nav
// logo), pulsing like an audio-equalizer instead of sitting static — a
// bar-chart mark is a natural fit for a "working" animation, and it reads
// as "this app" for any inline loading state, from a full skeleton
// placeholder down to a small busy-button spinner.
@Component({
  selector: "app-logo-spinner",
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="13" width="5" height="8" rx="1.3" class="fill-highlight bar bar-1" />
      <rect x="10.5" y="6.5" width="5" height="14.5" rx="1.3" class="fill-highlight bar bar-2" />
      <rect x="17" y="10" width="5" height="11" rx="1.3" class="fill-highlight bar bar-3" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .bar {
        transform-box: fill-box;
        transform-origin: bottom;
        animation: logo-pulse 0.9s ease-in-out infinite;
      }
      .bar-1 {
        animation-delay: 0s;
      }
      .bar-2 {
        animation-delay: 0.15s;
      }
      .bar-3 {
        animation-delay: 0.3s;
      }
      @keyframes logo-pulse {
        0%,
        100% {
          transform: scaleY(0.35);
          opacity: 0.5;
        }
        50% {
          transform: scaleY(1);
          opacity: 1;
        }
      }
    `,
  ],
})
export class LogoSpinnerComponent {
  @Input() size = 20;
}
