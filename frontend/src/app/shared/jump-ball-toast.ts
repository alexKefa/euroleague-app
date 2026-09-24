import { Component, effect, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";
import { ButtonDirective } from "./button.directive";

const DISMISS_KEY_PREFIX = "clutch-jumpball-toast-dismissed-";

// "Reset at 00:00 of the day" — the Athens calendar-day boundary
// routes/spin.ts's own nextAthensMidnightUtc resets the wheel on
// (2026-09-24 pass). Scoping the dismiss key to today's date this same way
// means dismissing today's toast doesn't suppress tomorrow's — a fresh
// date is a fresh key, so it just doesn't match on the next visit after
// the wheel has actually reset.
function todayAthensDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
}

/**
 * Global "your daily jump ball is ready" toast (2026-09-25) — replaced an
 * earlier dashboard-only inline banner the same day, per direct follow-up
 * ("do a toast. remove from there") — a toast surfaces regardless of which
 * page the user actually lands on first, same reasoning
 * battle-challenge-toast.ts's own doc comment gives for going global
 * instead of a page-local badge. Mounted in app.component.html next to
 * that component. No SSE push exists for "the wheel just reset" (unlike a
 * real battle challenge), so this checks once per app load via GET
 * /api/spin rather than reacting to a live event.
 */
@Component({
  selector: "app-jump-ball-toast",
  standalone: true,
  imports: [NavIconComponent, ButtonDirective],
  templateUrl: "./jump-ball-toast.html",
  styleUrl: "./jump-ball-toast.css",
})
export class JumpBallToastComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  readonly visible = signal(false);

  // Real bug caught live (2026-09-25): a plain ngOnInit checking
  // auth.isAuthenticated() ran before AuthService.restoreSession() had
  // resolved the access token off the httpOnly refresh cookie (this
  // component mounts at the app root, about as early as anything runs) —
  // same "bootstrap race" CLAUDE.md already documents for the dashboard's
  // team-hero and game-detail.ts's top-scorer pick fetch. A logged-in user
  // reloading the app never saw the toast at all, since the one-shot check
  // gave up before the token was ever set. Fixed by reacting to
  // accessToken() via effect() instead (same pattern EventsService's own
  // constructor uses), guarded by checkedThisSession so a later token
  // refresh doesn't re-fetch/re-show a toast already dismissed this load.
  private checkedThisSession = false;

  constructor() {
    effect(() => {
      const token = this.auth.accessToken();
      if (!token || this.checkedThisSession) return;
      this.checkedThisSession = true;

      this.api.getSpinStatus().subscribe({
        next: (status) => {
          if (!status.canSpin) return;
          try {
            if (localStorage.getItem(DISMISS_KEY_PREFIX + todayAthensDateKey()) === "1") return;
          } catch {
            // Private browsing / storage disabled — toast just shows every load.
          }
          this.visible.set(true);
        },
        error: () => {}, // non-critical — the wheel page itself is still the source of truth
      });
    });
  }

  spin(): void {
    this.dismiss();
    this.router.navigate(["/wheel"]);
  }

  dismiss(): void {
    this.visible.set(false);
    try {
      localStorage.setItem(DISMISS_KEY_PREFIX + todayAthensDateKey(), "1");
    } catch {
      // No persistence available — it'll just show again next load, not worth failing over.
    }
  }
}
