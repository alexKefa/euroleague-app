import { Component, Input } from "@angular/core";

export type NavIconName = "home" | "news" | "picks" | "store" | "user" | "wheel" | "packs" | "cards" | "trade";

@Component({
  selector: "app-nav-icon",
  standalone: true,
  template: `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      @switch (name) {
        @case ("home") {
          <path
            d="M4 11L12 4l8 7M6 10v9h5v-5h2v5h5v-9"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("news") {
          <rect x="5" y="4" width="14" height="16" rx="1" stroke="currentColor" stroke-width="2" />
          <line x1="8" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="2" />
          <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" />
          <line x1="8" y1="16" x2="13" y2="16" stroke="currentColor" stroke-width="2" />
        }
        @case ("picks") {
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" />
          <path
            d="M8.5 12.5l2.5 2.5 4.5-5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ("store") {
          <rect x="4" y="8" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="2" />
          <path d="M4 8l2-4h12l2 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          <path d="M9 12v-1a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="2" />
        }
        @case ("user") {
          <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        }
        @case ("wheel") {
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" />
          <path
            d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7"
            stroke="currentColor"
            stroke-width="1.3"
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
            stroke-width="1.6"
          />
          <rect x="9.5" y="6" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.6" />
        }
        @case ("cards") {
          <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" stroke-width="2" />
          <circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5" />
          <path d="M8 17c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        }
        @case ("trade") {
          <path
            d="M6 8h11l-3-3M17 8l-3 3"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M18 16H7l3-3M7 16l3 3"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
      }
    </svg>
  `,
})
export class NavIconComponent {
  @Input({ required: true }) name!: NavIconName;
}
