import { Component, computed, inject, signal } from "@angular/core";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { PushService, isStandalone } from "../core/push.service";
import { TourService } from "../core/tour/tour.service";
import { ButtonDirective } from "./button.directive";
import { DialogComponent } from "./dialog";

const DISMISS_KEY = "clutch-push-prompt-dismissed";
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
  imports: [DialogComponent, ButtonDirective],
  template: `
    @if (shown()) {
      <app-dialog [title]="i18n.t('pushPrompt.title')" icon="bell" [closeLabel]="i18n.t('hint.dismiss')" (closed)="dismiss()">
        <p class="text-sm text-muted mb-4">{{ i18n.t('pushPrompt.text') }}</p>
        <div class="flex flex-col sm:flex-row-reverse gap-2">
          <button type="button" appButton class="w-full sm:w-auto" (click)="enable()" [disabled]="push.busy()">{{ i18n.t('pushPrompt.cta') }}</button>
          <button type="button" appButton="outline" class="w-full sm:w-auto" (click)="dismiss()">{{ i18n.t('pushPrompt.later') }}</button>
        </div>
      </app-dialog>
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
