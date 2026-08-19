import { Component, Input } from "@angular/core";

export type NavIconName = "home" | "news" | "picks" | "store" | "user";

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
      }
    </svg>
  `,
})
export class NavIconComponent {
  @Input({ required: true }) name!: NavIconName;
}
