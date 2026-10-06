import { Component, computed, inject, signal } from "@angular/core";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { PushService, isStandalone } from "../core/push.service";
import { TourService } from "../core/tour/tour.service";
import { ButtonDirective } from "./button.directive";
import { NavIconComponent } from "./nav-icon";

// v2: the first version was an easy-to-miss toast; everyone gets the modal once.
const DISMISS_KEY = "clutch-push-prompt-dismissed-v2";
// Let the splash screen (app.component.ts, ~3s) finish first.
const SHOW_DELAY_MS = 3500;

function storedDismiss(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One-time "turn on notifications?" pop-up (2026-10-05), only inside the
 * installed (home-screen) app, where push works on every platform, and only
 * while notifications are off (not blocked). Either answer hides it for
 * good; the Profile toggle stays available. Rendered outside the toast
 * stack, since that container is pointer-events-none.
 */
@Component({
  selector: "app-push-prompt",
  standalone: true,
  imports: [NavIconComponent, ButtonDirective],
  template: `
    @if (shown()) {
      <!-- Centred modal, not a bottom sheet or toast, so it can't be missed.
           No backdrop-tap or Escape close: the user picks one of the two. -->
      <div data-sheet-static class="sheet-backdrop fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
        <div
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="i18n.t('pushPrompt.title')"
          class="sheet-panel bg-card rounded-3xl border border-line shadow-pop p-6 max-w-sm w-full text-center"
        >
          <span class="mx-auto mb-4 w-16 h-16 rounded-2xl bg-team-primary text-team-secondary flex items-center justify-center shadow-card">
            <app-nav-icon name="bell" [size]="32" />
          </span>
          <p class="font-display text-xl mb-2">{{ i18n.t('pushPrompt.title') }}</p>
          <p class="text-sm text-muted mb-5">{{ i18n.t('pushPrompt.text') }}</p>
          <div class="flex flex-col gap-2">
            <button type="button" appButton class="w-full" (click)="enable()" [disabled]="push.busy()">{{ i18n.t('pushPrompt.cta') }}</button>
            <button type="button" appButton="outline" class="w-full" (click)="dismiss()" [disabled]="push.busy()">{{ i18n.t('pushPrompt.later') }}</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class PushPromptComponent {
  private auth = inject(AuthService);
  private tour = inject(TourService);
  protected i18n = inject(I18nService);
  protected push = inject(PushService);

  private readonly dismissed = signal(storedDismiss());
  private readonly delayPassed = signal(false);
  private readonly standalone = isStandalone();

  readonly shown = computed(
    () =>
      this.standalone &&
      this.delayPassed() &&
      !this.dismissed() &&
      !this.tour.active() &&
      this.auth.isAuthenticated() &&
      this.push.status() === "off"
  );

  constructor() {
    setTimeout(() => this.delayPassed.set(true), SHOW_DELAY_MS);
  }

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
