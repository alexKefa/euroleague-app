import { Component, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { NavIconComponent } from "../../shared/nav-icon";

// Admin-only "Tools" page (2026-09-18, "before pushing on tools of admin
// add an icon and inside split into an admin-tools component which has
// buttons for tools") — a home for general-purpose admin utilities that
// aren't tied to any one feature page (unlike schedule.html's own
// reset-game/reset-round buttons, which live right next to the games they
// act on). Split out of admin-users.ts specifically because "Sync images"
// had no natural feature-page home of its own. Structured as one card per
// tool (currently just Sync images) so adding a second tool later is a
// copy-paste of a card block in the template plus whatever state/handler
// that tool needs here — not a generic data-driven "tools list", since
// each tool's own state/action shape differs too much to usefully share
// one (sync-images needs syncing/result/error signals; a future tool
// might need something else entirely).
@Component({
  selector: "app-admin-tools",
  standalone: true,
  imports: [RouterLink, ButtonDirective, LogoSpinnerComponent, NavIconComponent],
  templateUrl: "./admin-tools.html",
})
export class AdminToolsComponent {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  // "Sync images" — pulls new real player/coach photos from EuroLeague's
  // live feed, then pushes any that changed into their matching
  // collectible card. See routes/admin.ts's own comment on what this
  // actually runs. syncResult holds the last run's counts until the next
  // click or a page reload; null before ever clicked.
  readonly syncing = signal(false);
  readonly syncResult = signal<{ playersUpdated: number; coachCardsUpdated: number; collectiblesUpdated: number } | null>(null);
  readonly syncError = signal(false);

  syncImages(): void {
    this.syncing.set(true);
    this.syncError.set(false);
    this.api.syncImages().subscribe({
      next: (result) => {
        this.syncResult.set(result);
        this.syncing.set(false);
      },
      error: () => {
        this.syncError.set(true);
        this.syncing.set(false);
      },
    });
  }
}
