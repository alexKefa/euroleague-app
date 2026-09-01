import { Component, OnInit, inject, signal } from "@angular/core";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";
import { isInAppBrowser } from "./in-app-browser";

const SEEN_KEY = "clutch-open-in-browser-banner-seen";

/**
 * Nudges a visitor who arrived via a shared link (referral/promo) but is
 * viewing it inside Messenger's/Instagram's in-app WebView, where "Add to
 * Home Screen" isn't offered at all (see in-app-browser.ts) — instructs
 * them to reopen the link in their real browser instead. Shown at most
 * once ever per device (first visit only, tracked the moment it renders,
 * not just on dismiss) rather than "every visit until dismissed" like
 * PageHintComponent — by a second visit the visitor has either already
 * acted on it or isn't going to, so repeating it is just noise.
 *
 * Left for the page embedding this to decide *when* to mount it (e.g. only
 * with a referral/promo code present) — this component only owns the
 * in-app-browser + seen-once logic, not the "is this a shareable-link
 * flow" judgment call, which is page-specific.
 */
@Component({
  selector: "app-open-in-browser-banner",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    @if (visible()) {
      <div class="relative flex items-start gap-2.5 pl-3.5 pr-9 py-3 mb-4 rounded-r-lg bg-highlight/[0.06] border-l-2 border-highlight">
        <app-nav-icon name="share" [size]="18" class="text-highlight shrink-0 mt-0.5" />
        <p class="text-sm text-muted leading-relaxed">{{ i18n.t('openInBrowser.message') }}</p>
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
export class OpenInBrowserBannerComponent implements OnInit {
  protected i18n = inject(I18nService);

  readonly visible = signal(false);

  ngOnInit(): void {
    if (!isInAppBrowser()) return;
    try {
      if (localStorage.getItem(SEEN_KEY) === "1") return;
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private browsing / storage disabled — no memory of past visits, so
      // it shows every time rather than not at all.
    }
    this.visible.set(true);
  }

  dismiss(): void {
    this.visible.set(false);
  }
}
