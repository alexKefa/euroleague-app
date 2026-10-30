import { Component, effect, inject, untracked } from "@angular/core";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";

/**
 * One-off notice after a user deletes their account (2026-10-12, profile
 * "Your data"). Shown while AuthService.accountDeleted is set; hides itself
 * after 6 s. Positioned by the shared toast stack in app.component.html.
 */
@Component({
  selector: "app-account-deleted-toast",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    @if (auth.accountDeleted()) {
      <div class="toast-pop toast-pill pointer-events-auto mb-2" role="status">
        <div class="flex items-center gap-2.5">
          <span class="toast-pill-icon"><app-nav-icon name="user" [size]="18" /></span>
          <p class="min-w-0 flex-1 text-sm font-semibold leading-snug line-clamp-2">{{ i18n.t('toast.accountDeleted') }}</p>
          <button type="button" (click)="auth.accountDeleted.set(false)" class="toast-x" [attr.aria-label]="i18n.t('hint.dismiss')">&times;</button>
        </div>
      </div>
    }
  `,
})
export class AccountDeletedToastComponent {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);

  constructor() {
    effect((onCleanup) => {
      if (!this.auth.accountDeleted()) return;
      const timer = setTimeout(() => untracked(() => this.auth.accountDeleted.set(false)), 6000);
      onCleanup(() => clearTimeout(timer));
    });
  }
}
