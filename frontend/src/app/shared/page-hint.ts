import { Component, Input, OnInit, inject, signal } from "@angular/core";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent, NavIconName } from "./nav-icon";

// Small, dismissible orientation hints dropped at the top of a page.
// Dismissal is per-hintId, per browser (localStorage, same pattern as
// ThemeService's cached scheme) — once a user clears one it's gone for good
// on that device.
//
// Restyled 2026-09-30 (direct feedback: hints were "too vanilla"): the old
// thin left-accent strip with small muted text read like a footnote. Now a
// rounded card in the same visual language as the rest of the app — a
// team-color gradient wash with a faint court arc (like the dashboard team
// card), the icon in a filled team-color tile (like .card-head-icon), a
// small "How it works" eyebrow, ink-colored body text, and a real "Got it"
// button next to the ×. Still clearly not page content: tinted, not bg-card.
@Component({
  selector: "app-page-hint",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    @if (!dismissed()) {
      <div class="page-hint relative overflow-hidden rounded-3xl border mb-5 p-4 pr-10">
        <div class="page-hint-arc pointer-events-none absolute" aria-hidden="true"></div>
        <div class="relative flex items-start gap-3">
          <span class="w-10 h-10 rounded-xl bg-team-primary text-team-secondary flex items-center justify-center shrink-0 shadow-sm">
            <app-nav-icon [name]="icon" [size]="20" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-bold uppercase tracking-wider text-team-primary mb-0.5">{{ i18n.t('hint.label') }}</p>
            <p class="text-[15px] text-ink leading-relaxed">
              <ng-content></ng-content>
            </p>
            <button
              type="button"
              (click)="dismiss()"
              class="mt-3 h-8 px-3.5 rounded-xl text-[13px] font-bold bg-team-primary/15 text-team-primary hover:bg-team-primary/25 transition-colors"
            >
              {{ i18n.t('hint.gotIt') }}
            </button>
          </div>
        </div>
        <button
          type="button"
          (click)="dismiss()"
          class="tap-target absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-team-primary/10 transition-colors"
          [attr.aria-label]="i18n.t('hint.dismiss')"
        >
          &times;
        </button>
      </div>
    }
  `,
  styles: `
    .page-hint {
      border-color: color-mix(in srgb, var(--accent-primary) 28%, var(--color-line));
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--accent-primary) 16%, var(--color-card)) 0%,
        color-mix(in srgb, var(--accent-primary) 5%, var(--color-card)) 60%,
        var(--color-card) 100%
      );
      animation: page-hint-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    /* Faint three-point-line arc in the corner, same device as the
       dashboard team card's ring. */
    .page-hint-arc {
      right: -3.5rem;
      top: -3.5rem;
      width: 9rem;
      height: 9rem;
      border-radius: 999px;
      border: 12px solid color-mix(in srgb, var(--accent-primary) 10%, transparent);
    }
    @keyframes page-hint-in {
      from {
        opacity: 0;
        transform: translateY(-6px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .page-hint {
        animation: none;
      }
    }
  `,
})
export class PageHintComponent implements OnInit {
  protected i18n = inject(I18nService);

  @Input({ required: true }) hintId!: string;
  @Input() icon: NavIconName = "tip";

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
