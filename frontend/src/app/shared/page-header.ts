import { Component, Input } from "@angular/core";
import { NavIconComponent, NavIconName } from "./nav-icon";

/**
 * Shared page title block (2026-10-01, "titling is simple, too vanilla" —
 * replaces the bare h1 + small grey line on every main page). A team-colour
 * eyebrow with the section's icon, a big display title, a short accent bar,
 * an ink-coloured subtitle, and the page icon as a faint watermark.
 *
 * Slots: [headTitleExtra] sits right after the title (e.g. a stat legend
 * "?"), [headAside] on the right (points badge, a button).
 */
@Component({
  selector: "app-page-header",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    <header class="page-header relative">
      <span class="ph-watermark" aria-hidden="true"><app-nav-icon [name]="icon" [size]="132" /></span>
      <div class="relative flex items-start gap-3">
        <div class="min-w-0 flex-1">
          @if (eyebrow) {
            <p class="ph-eyebrow">
              <span class="ph-eyebrow-icon"><app-nav-icon [name]="icon" [size]="12" /></span>
              {{ eyebrow }}
            </p>
          }
          <div class="flex items-center gap-1.5 min-w-0">
            <h1 class="ph-title font-display">{{ title }}</h1>
            <ng-content select="[headTitleExtra]"></ng-content>
          </div>
          <span class="ph-bar" aria-hidden="true"></span>
          @if (subtitle) {
            <p class="ph-sub">{{ subtitle }}</p>
          }
          <ng-content select="[headBelow]"></ng-content>
        </div>
        <div class="relative shrink-0 flex items-center gap-2 pt-1">
          <ng-content select="[headAside]"></ng-content>
        </div>
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 1.25rem;
    }
    .page-header {
      animation: ph-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .ph-watermark {
      position: absolute;
      right: -0.75rem;
      top: -1.75rem;
      color: var(--accent-primary);
      opacity: 0.07;
      pointer-events: none;
      transform: rotate(-12deg);
    }
    .ph-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.35rem;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent-primary);
    }
    .ph-eyebrow-icon {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
    }
    .ph-title {
      font-size: 1.9rem;
      line-height: 1.05;
      letter-spacing: 0.01em;
      overflow-wrap: anywhere;
    }
    @media (min-width: 640px) {
      .ph-title {
        font-size: 2.25rem;
      }
    }
    .ph-bar {
      display: block;
      width: 44px;
      height: 4px;
      margin: 0.6rem 0 0.55rem;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent-primary), color-mix(in srgb, var(--accent-primary) 25%, transparent));
      transform-origin: left;
      animation: ph-bar 600ms cubic-bezier(0.22, 1, 0.36, 1) 120ms both;
    }
    .ph-sub {
      max-width: 40rem;
      font-size: 15px;
      line-height: 1.5;
      color: color-mix(in srgb, var(--color-ink) 72%, transparent);
    }
    @keyframes ph-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @keyframes ph-bar {
      from {
        transform: scaleX(0);
      }
      to {
        transform: scaleX(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .page-header,
      .ph-bar {
        animation: none;
      }
    }
  `,
})
export class PageHeaderComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle: string | null = null;
  // Section label above the title ("Play", "Cards", "Stats", "You").
  @Input() eyebrow: string | null = null;
  @Input() icon: NavIconName = "home";
}
