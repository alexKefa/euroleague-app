import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject, signal } from "@angular/core";
import { ApiService } from "../core/api.service";
import { SearchInputComponent } from "./search-input";

export interface UserSearchResult {
  id: string;
  username: string;
  email: string;
}

// Admin username/email typeahead (2026-09-18, "autofill usernames instead
// of me typing whole email") — replaces the Profile admin forms' plain
// `type="email"` inputs (grant points, grant card), which required an
// admin to already know and correctly type a user's exact email address.
// Server-searched (GET /admin/users/search), not client-side filtered
// like this app's other search inputs (teams hub, /stats, store, etc.) —
// the user list isn't otherwise loaded on this page, and fetching every
// user just to filter locally would mean paying admin.ts's heavier
// GET /users query (joined across predictions/collectibles/point_
// adjustments for the Users-page KPIs) just to power a search box that
// never shows any of that. Same setTimeout-debounce + requestToken-guard
// pattern store.ts's own search already established, not a new one.
@Component({
  selector: "app-user-search",
  standalone: true,
  imports: [SearchInputComponent],
  template: `
    <div class="relative">
      <app-search-input [value]="query()" (valueChange)="onQueryChange($event)" [placeholder]="placeholder" />
      @if (open() && results().length > 0) {
        <div class="absolute z-30 mt-1 w-full bg-card border-2 border-line rounded-xl shadow-pop overflow-hidden max-h-56 overflow-y-auto">
          @for (u of results(); track u.id) {
            <button
              type="button"
              (click)="select(u)"
              class="w-full text-left px-3 py-2 hover:bg-page transition-colors"
            >
              <span class="block text-sm font-semibold truncate">{{ u.username }}</span>
              <span class="block text-[11px] text-muted font-mono truncate">{{ u.email }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class UserSearchComponent {
  private api = inject(ApiService);
  private host = inject(ElementRef<HTMLElement>);

  @Input() placeholder = "";
  @Output() userSelected = new EventEmitter<UserSearchResult>();

  readonly query = signal("");
  readonly results = signal<UserSearchResult[]>([]);
  readonly open = signal(false);

  private debounceHandle?: ReturnType<typeof setTimeout>;
  private requestToken = 0;

  onQueryChange(value: string): void {
    this.query.set(value);
    this.open.set(true);
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      this.results.set([]);
      return;
    }
    this.debounceHandle = setTimeout(() => this.search(trimmed), 250);
  }

  private search(q: string): void {
    const token = ++this.requestToken;
    this.api.searchUsers(q).subscribe((res) => {
      if (token !== this.requestToken) return;
      this.results.set(res.users);
    });
  }

  select(user: UserSearchResult): void {
    this.query.set(user.username);
    this.results.set([]);
    this.open.set(false);
    this.userSelected.emit(user);
  }

  /** Called by the parent after a successful grant, same "clear the form" role email inputs used to play. */
  reset(): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.query.set("");
    this.results.set([]);
    this.open.set(false);
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
