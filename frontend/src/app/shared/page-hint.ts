import { Component, Input, OnInit, inject, signal } from "@angular/core";
import { I18nService } from "../core/i18n.service";

// Small, dismissible orientation hints dropped at the top of a page —
// distinct from the app's `bg-card` content sections on purpose (a tinted
// left-accent strip, not another card) so it visually reads as "a tip about
// this page" rather than "more page content". Dismissal is per-hintId, per
// browser (localStorage, same pattern as ThemeService's cached scheme) —
// once a user clears one it's gone for good on that device, it doesn't come
// back next visit or nag them again.
@Component({
  selector: "app-page-hint",
  standalone: true,
  template: `
    @if (!dismissed()) {
      <div
        class="relative flex items-start gap-2.5 pl-3.5 pr-9 py-3 mb-5 rounded-r-lg bg-highlight/[0.06] border-l-2 border-highlight"
      >
        <span class="text-base leading-tight shrink-0" aria-hidden="true">{{ icon }}</span>
        <p class="text-sm text-muted leading-relaxed">
          <ng-content></ng-content>
        </p>
        <button
          type="button"
          (click)="dismiss()"
          class="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-highlight/10 transition-colors"
          [attr.aria-label]="i18n.t('hint.dismiss')"
        >
          &times;
        </button>
      </div>
    }
  `,
})
export class PageHintComponent implements OnInit {
  protected i18n = inject(I18nService);

  @Input({ required: true }) hintId!: string;
  @Input() icon = "💡";

  readonly dismissed = signal(false);

  private get storageKey(): string {
    return `clutch-hint-dismissed-${this.hintId}`;
  }

  ngOnInit(): void {
    try {
      this.dismissed.set(localStorage.getItem(this.storageKey) === "1");
    } catch {
      // Private browsing / storage disabled — hint just stays visible every visit.
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(this.storageKey, "1");
    } catch {
      // No persistence available — it'll reappear next visit, not worth failing over.
    }
  }
}
