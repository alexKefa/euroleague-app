import { Component, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterOutlet, RouterLink } from "@angular/router";
import { AuthService } from "./core/auth.service";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, CommonModule],
  template: `
    <nav
      class="flex justify-between items-center gap-3 px-4 sm:px-6 py-3 bg-panel border-b border-hairline text-sm"
    >
      <a routerLink="/" class="font-display font-bold text-amber tracking-wide shrink-0 text-sm">
        EuroLeague App
      </a>
      @if (auth.isAuthenticated()) {
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-muted font-mono text-xs truncate max-w-[40vw]">{{
            auth.currentUser()?.email
          }}</span>
          <button
            (click)="logout()"
            class="text-amber hover:text-amber-dim transition-colors shrink-0"
          >
            Log out
          </button>
        </div>
      } @else {
        <div class="flex items-center gap-3 sm:gap-4 shrink-0">
          <a routerLink="/login" class="text-muted hover:text-slate-100 transition-colors"
            >Log in</a
          >
          <a
            routerLink="/register"
            class="px-3 py-1.5 rounded bg-amber text-ink font-medium hover:bg-amber-dim transition-colors"
            >Register</a
          >
        </div>
      }
    </nav>
    <router-outlet></router-outlet>
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