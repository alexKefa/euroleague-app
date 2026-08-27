import { Component, EventEmitter, HostBinding, Input, Output, signal } from "@angular/core";

// Shared search field replacing six near-identical bare <input type="search">
// call sites (teams hub, /stats, /compare, analytics-builder, store,
// inventory) that had no icon, no hover state, and no way to clear other than
// deleting text by hand — same "unfinished" look the toolbar's own
// <app-dropdown> (dropdown.ts) had already been fixed for a bordered trigger
// with a hover/focus treatment and its own trailing icon. This mirrors that
// same visual language (rounded-xl, bg-card, border-2 border-line, the same
// hover/focus border colors) rather than inventing a new style, plus a
// leading magnifying-glass icon and a trailing clear button that only
// appears once there's something to clear.
@Component({
  selector: "app-search-input",
  standalone: true,
  template: `
    <svg
      class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition-colors"
      [class.text-highlight]="focused()"
      [class.text-muted]="!focused()"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="10.5" cy="10.5" r="7" stroke="currentColor" stroke-width="2.2" />
      <line x1="15.8" y1="15.8" x2="21" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
    </svg>
    <input
      type="search"
      [value]="value"
      (input)="onInput($any($event.target).value)"
      (focus)="focused.set(true)"
      (blur)="focused.set(false)"
      [placeholder]="placeholder"
      class="search-input-native w-full pl-9 py-2.5 rounded-xl border-2 border-line text-sm font-semibold text-ink placeholder:text-muted placeholder:font-semibold hover:border-[#3a3a3b] focus:border-highlight outline-none transition-colors"
      [class.bg-card]="surface === 'card'"
      [class.bg-page]="surface === 'page'"
      [class.pr-8]="value"
      [class.pr-3]="!value"
    />
    @if (value) {
      <button
        type="button"
        (click)="clear()"
        aria-label="Clear search"
        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
      </button>
    }
  `,
  styles: [
    `
      /* Browser default search-field chrome (WebKit's cancel-x, Edge's clear
         icon) duplicates the custom clear button above and doesn't match its
         styling, so it's suppressed in favor of the one owned by this
         template. */
      .search-input-native::-webkit-search-cancel-button,
      .search-input-native::-webkit-search-decoration {
        -webkit-appearance: none;
        appearance: none;
      }
      .search-input-native::-ms-clear {
        display: none;
      }
    `,
  ],
})
export class SearchInputComponent {
  @Input() value = "";
  @Input() placeholder = "";
  // "page" for a search box sitting inside a bg-card panel (analytics
  // builder) so it still reads as a distinct field against its container.
  @Input() surface: "card" | "page" = "card";
  @Output() valueChange = new EventEmitter<string>();

  // Positions the icon/clear-button relative to this host, same reasoning as
  // DropdownComponent's identical hostClass.
  @HostBinding("class") hostClass = "relative block";

  protected readonly focused = signal(false);

  onInput(value: string): void {
    this.value = value;
    this.valueChange.emit(value);
  }

  clear(): void {
    this.value = "";
    this.valueChange.emit("");
  }
}
