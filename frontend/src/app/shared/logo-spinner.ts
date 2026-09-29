import { Component, Input } from "@angular/core";

/**
 * App-wide small loader (2026-09-29 rework, replacing a generic bouncing
 * ball): a "shot clock" — a thin team-colour arc sweeping round a faint
 * track, with a ball dot in the middle. Same ring language as the budget /
 * collection rings, and it stays crisp down to 12px inside buttons. For
 * bigger, full-block waits use <app-swish-loader> instead.
 */
@Component({
  selector: "app-logo-spinner",
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" aria-hidden="true" class="shot-clock">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke-width="2.6" class="stroke-line" />
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="none"
        stroke-width="2.6"
        stroke-linecap="round"
        pathLength="100"
        class="shot-clock-arc stroke-team-primary"
      />
      <circle cx="12" cy="12" r="3.4" class="shot-clock-ball fill-team-primary" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .shot-clock {
        animation: shot-clock-spin 1.1s linear infinite;
      }
      .shot-clock-arc {
        stroke-dasharray: 25 100;
        animation: shot-clock-sweep 1.4s ease-in-out infinite;
      }
      .shot-clock-ball {
        transform-box: fill-box;
        transform-origin: center;
        animation: shot-clock-pulse 1.4s ease-in-out infinite;
      }
      @keyframes shot-clock-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @keyframes shot-clock-sweep {
        0% { stroke-dasharray: 8 100; stroke-dashoffset: 0; }
        50% { stroke-dasharray: 60 100; stroke-dashoffset: -15; }
        100% { stroke-dasharray: 8 100; stroke-dashoffset: -100; }
      }
      @keyframes shot-clock-pulse {
        0%, 100% { transform: scale(0.8); opacity: 0.7; }
        50% { transform: scale(1); opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .shot-clock { animation-duration: 2.4s; }
        .shot-clock-arc, .shot-clock-ball { animation: none; }
      }
    `,
  ],
})
export class LogoSpinnerComponent {
  @Input() size = 20;
}
