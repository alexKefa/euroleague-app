import { Component, computed, inject, signal } from "@angular/core";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { PushService, isStandalone } from "../core/push.service";
import { NavIconComponent } from "./nav-icon";

const DISMISS_KEY = "clutch-push-prompt-dismissed";

function storedDismiss(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One-time "turn on notifications?" toast (2026-10-05), only inside the
 * installed (home-screen) app, where push actually works on every platform.
 * Either answer hides it for good; the Profile toggle stays available.
 */
@Component({
  selector: "app-push-prompt",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    @if (shown()) {
      <div class="toast-pop toast-pill pointer-events-auto mb-2" role="status">
        <div class="flex items-center gap-2.5">
          <span class="toast-pill-icon"><app-nav-icon name="bell" [size]="18" /></span>
          <p class="min-w-0 flex-1 text-[13px] font-semibold leading-snug line-clamp-2">{{ i18n.t('pushPrompt.text') }}</p>
          <button type="button" (click)="enable()" [disabled]="push.busy()" class="toast-action">{{ i18n.t('pushPrompt.cta') }}</button>
          <button type="button" (click)="dismiss()" class="toast-x" [attr.aria-label]="i18n.t('hint.dismiss')">&times;</button>
        </div>
      </div>
    }
  `,
})
export class PushPromptComponent {
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected push = inject(PushService);

  private readonly dismissed = signal(storedDismiss());
  private readonly standalone = isStandalone();

  readonly shown = computed(
    () => this.standalone && !this.dismissed() && this.auth.isAuthenticated() && this.push.status() === "off"
  );

  async enable(): Promise<void> {
    await this.push.enable();
    this.dismiss();
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage disabled: it just shows again next launch.
    }
  }
}
