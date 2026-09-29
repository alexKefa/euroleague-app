import { Component, Input } from "@angular/core";

/**
 * Bigger "swish" loader (2026-09-29) for full-block waits (claim page, card
 * stats, roster pickers): a ball arcs in, drops through a simple hoop and
 * the net ripples, on a loop. Team-coloured ball and rim; theme-coloured
 * net/backboard so it works in light and dark. Small inline spinners use
 * <app-logo-spinner> (the shot clock) instead.
 */
@Component({
  selector: "app-swish-loader",
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size * 1.1" viewBox="0 0 60 66" aria-hidden="true" class="overflow-visible">
      <!-- backboard -->
      <rect x="14" y="4" width="32" height="20" rx="3" fill="none" stroke="var(--color-muted)" stroke-opacity="0.55" stroke-width="2" />
      <rect x="24" y="12" width="12" height="8" rx="1" fill="none" stroke="var(--color-muted)" stroke-opacity="0.45" stroke-width="1.5" />
      <!-- net (behind the ball) -->
      <g class="swish-net">
        <path d="M19 29 L23 44 L37 44 L41 29" fill="none" stroke="var(--color-ink)" stroke-opacity="0.45" stroke-width="1.4" stroke-linejoin="round" />
        <path d="M24 29 L27 44 M30 29 L30 44 M36 29 L33 44 M21 36 L39 36" fill="none" stroke="var(--color-ink)" stroke-opacity="0.35" stroke-width="1.2" />
      </g>
      <!-- ball -->
      <g class="swish-ball">
        <circle cx="30" cy="20" r="7" class="fill-team-primary" />
        <path d="M23 20 H37 M30 13 V27 M25 15 C28 18 28 22 25 25 M35 15 C32 18 32 22 35 25" fill="none" class="stroke-team-secondary" stroke-width="1.1" />
      </g>
      <!-- rim, drawn over the ball so it passes "through" the hoop -->
      <ellipse cx="30" cy="29" rx="12" ry="3" fill="none" class="stroke-team-primary" stroke-width="2.6" />
      <!-- floor shadow -->
      <ellipse cx="30" cy="62" rx="9" ry="2" class="swish-shadow" fill="var(--color-ink)" fill-opacity="0.18" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .swish-ball {
        transform-box: view-box;
        animation: swish-ball 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
      }
      .swish-net {
        transform-box: fill-box;
        transform-origin: 50% 0;
        animation: swish-net 1.6s ease-out infinite;
      }
      .swish-shadow {
        transform-box: fill-box;
        transform-origin: center;
        animation: swish-shadow 1.6s ease-in-out infinite;
      }
      /* Arc in from the left, drop through the rim, bounce off the floor. */
      @keyframes swish-ball {
        0% { transform: translate(-22px, -6px); opacity: 0; }
        12% { opacity: 1; }
        35% { transform: translate(0, -10px); }
        55% { transform: translate(0, 14px); }
        75% { transform: translate(0, 34px); }
        88% { transform: translate(0, 28px); }
        100% { transform: translate(0, 34px); opacity: 0; }
      }
      @keyframes swish-net {
        0%, 45% { transform: scaleY(1) scaleX(1); }
        58% { transform: scaleY(1.22) scaleX(0.9); }
        70% { transform: scaleY(0.94) scaleX(1.04); }
        82%, 100% { transform: scaleY(1) scaleX(1); }
      }
      @keyframes swish-shadow {
        0%, 50% { transform: scale(0.4); opacity: 0.2; }
        75% { transform: scale(1); opacity: 1; }
        88% { transform: scale(0.85); }
        100% { transform: scale(1); opacity: 0.3; }
      }
      @media (prefers-reduced-motion: reduce) {
        .swish-ball, .swish-net, .swish-shadow { animation: none; }
      }
    `,
  ],
})
export class SwishLoaderComponent {
  @Input() size = 56;
}
