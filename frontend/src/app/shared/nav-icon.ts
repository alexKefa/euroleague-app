import { Component, Input } from "@angular/core";

export type NavIconName =
  | "home"
  | "news"
  | "picks"
  | "store"
  | "user"
  | "wheel"
  | "packs"
  | "cards"
  | "trade"
  | "schedule"
  | "sun"
  | "moon";

@Component({
  selector: "app-nav-icon",
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none">
      @switch (name) {
        @case ("home") {
          <path
            d="M12 3.2L2.5 11H5v9h5.2v-6.2h3.6V20H19v-9h2.5L12 3.2z"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <path
            d="M4 11L12 4l8 7M6 10v9h5v-5h2v5h5v-9"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("news") {
          <!-- Photo + headline, not generic equal-width lines — reads as
               "article" specifically, not "list" or "menu". -->
          <rect
            x="5"
            y="4"
            width="14"
            height="16"
            rx="1"
            stroke="currentColor"
            stroke-width="2.2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <rect x="7.2" y="6.8" width="4" height="4" rx="0.6" fill="currentColor" />
          <line x1="13" y1="7.5" x2="16.8" y2="7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <line x1="13" y1="10" x2="16.8" y2="10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <line x1="7.2" y1="14" x2="16.8" y2="14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <line x1="7.2" y1="16.5" x2="13.5" y2="16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        }
        @case ("picks") {
          <!-- Bullseye — "aiming for a correct call", not a plain checkmark
               (which reads as "done/verified", the wrong signal here). -->
          <circle
            cx="12"
            cy="12"
            r="8"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <circle cx="12" cy="12" r="4.6" stroke="currentColor" stroke-width="1.8" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        }
        @case ("store") {
          <rect x="4" y="8" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="2.2" />
          <path d="M4 8l2-4h12l2 4" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
          <path d="M9 12v-1a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="2.2" />
        }
        @case ("user") {
          <circle
            cx="12"
            cy="8"
            r="4"
            stroke="currentColor"
            stroke-width="2.2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        }
        @case ("wheel") {
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.2" />
          <path
            d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        }
        @case ("packs") {
          <rect
            x="4.5"
            y="7.5"
            width="10"
            height="13"
            rx="1.5"
            transform="rotate(-8 9.5 14)"
            stroke="currentColor"
            stroke-width="1.9"
          />
          <rect x="9.5" y="6" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.9" />
        }
        @case ("cards") {
          <!-- A fanned hand of two cards — a collection, not a single
               portrait card (too close to the "user" icon's silhouette)
               and fanned outward rather than stacked-behind, so it doesn't
               read as a sealed "packs" icon either. -->
          <rect
            x="3.2"
            y="6.5"
            width="9.5"
            height="13"
            rx="1.4"
            transform="rotate(-13 8 13)"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <rect
            x="11.3"
            y="4.5"
            width="9.5"
            height="13"
            rx="1.4"
            transform="rotate(13 16 11)"
            stroke="currentColor"
            stroke-width="2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <circle cx="16" cy="9.2" r="1.3" fill="currentColor" transform="rotate(13 16 11)" />
        }
        @case ("schedule") {
          <rect
            x="4"
            y="5"
            width="16"
            height="15"
            rx="1.5"
            stroke="currentColor"
            stroke-width="2.2"
            [attr.fill]="active ? 'currentColor' : 'none'"
            [attr.fill-opacity]="active ? 0.18 : null"
          />
          <line x1="4" y1="9" x2="20" y2="9" stroke="currentColor" stroke-width="2.2" />
          <line x1="8" y1="3" x2="8" y2="6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          <line x1="16" y1="3" x2="16" y2="6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        }
        @case ("trade") {
          <path
            d="M6 8h11l-3-3M17 8l-3 3"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M18 16H7l3-3M7 16l3 3"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("sun") {
          <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2.2" />
          <path
            d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          />
        }
        @case ("moon") {
          <path
            d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
        }
      }
    </svg>
  `,
})
export class NavIconComponent {
  @Input({ required: true }) name!: NavIconName;
  // Swaps in a soft duotone fill behind the icon's stroke for the six
  // primary-nav icons (home/news/picks/cards/user/schedule) — the "lit up"
  // look that stands in for the active-tab color change now that nav
  // buttons are icon-only and don't have a label to carry that signal.
  @Input() active = false;
  @Input() size = 20;
}
