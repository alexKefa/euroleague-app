import { Component, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterOutlet, RouterLink, RouterLinkActive } from "@angular/router";
import { AuthService } from "./core/auth.service";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  template: `
    <nav
      class="flex justify-between items-center gap-3 px-4 sm:px-6 py-4 bg-card border-b border-line"
    >
      <a routerLink="/" class="font-extrabold text-[15px] shrink-0"> EuroLeague App </a>
      @if (auth.isAuthenticated()) {
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-muted font-semibold text-xs truncate max-w-[40vw]">{{
            auth.currentUser()?.email
          }}</span>
          <button
            (click)="logout()"
            class="text-highlight font-bold text-xs hover:text-highlight-dim transition-colors shrink-0"
          >
            Log out
          </button>
        </div>
      } @else {
        <div class="flex items-center gap-3 sm:gap-4 shrink-0">
          <a routerLink="/login" class="text-muted font-semibold text-xs hover:text-ink transition-colors"
            >Log in</a
          >
          <a
            routerLink="/register"
            class="px-4 py-2 rounded-full bg-highlight text-white font-bold text-xs hover:bg-highlight-dim transition-colors"
            >Register</a
          >
        </div>
      }
    </nav>

    <div class="pb-16 sm:pb-0">
      <router-outlet></router-outlet>
    </div>

    <!-- Bottom tab nav — mobile only, primary nav within thumb reach -->
    <nav
      class="sm:hidden fixed bottom-0 inset-x-0 bg-card border-t border-line flex justify-around items-center py-2 z-10"
    >
      <a
        routerLink="/"
        routerLinkActive="text-highlight"
        [routerLinkActiveOptions]="{ exact: true }"
        class="flex flex-col items-center gap-0.5 text-muted text-[10px] font-bold px-3 py-1"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 11L12 4l8 7M6 10v9h5v-5h2v5h5v-9"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Home
      </a>
      <a
        routerLink="/news"
        routerLinkActive="text-highlight"
        class="flex flex-col items-center gap-0.5 text-muted text-[10px] font-bold px-3 py-1"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="5" y="4" width="14" height="16" rx="1" stroke="currentColor" stroke-width="2" />
          <line x1="8" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="2" />
          <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" />
          <line x1="8" y1="16" x2="13" y2="16" stroke="currentColor" stroke-width="2" />
        </svg>
        News
      </a>
      <a
        routerLink="/predictions"
        routerLinkActive="text-highlight"
        class="flex flex-col items-center gap-0.5 text-muted text-[10px] font-bold px-3 py-1"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" />
          <path
            d="M8.5 12.5l2.5 2.5 4.5-5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Picks
      </a>
      <a
        routerLink="/store"
        routerLinkActive="text-highlight"
        class="flex flex-col items-center gap-0.5 text-muted text-[10px] font-bold px-3 py-1"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="8" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="2" />
          <path d="M4 8l2-4h12l2 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          <path d="M9 12v-1a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="2" />
        </svg>
        Store
      </a>
      @if (auth.isAuthenticated()) {
        <button
          (click)="logout()"
          class="flex flex-col items-center gap-0.5 text-muted text-[10px] font-bold px-3 py-1"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2" />
            <path
              d="M4 20c0-4 4-6 8-6s8 2 8 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          Log out
        </button>
      } @else {
        <a
          routerLink="/login"
          routerLinkActive="text-highlight"
          class="flex flex-col items-center gap-0.5 text-muted text-[10px] font-bold px-3 py-1"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2" />
            <path
              d="M4 20c0-4 4-6 8-6s8 2 8 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          Log in
        </a>
      }
    </nav>
  `,
})
export class AppComponent implements OnInit {
  protected auth = inject(AuthService);

  ngOnInit(): void {
    this.auth.restoreSession().subscribe();
  }

  logout(): void {
    this.auth.logout().subscribe();
  }
}