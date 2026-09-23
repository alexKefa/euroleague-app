import { Component, inject, signal } from "@angular/core";
import { I18nService } from "../../core/i18n.service";

// "Somewhere on the battles describe how they work" (2026-09-23) — same
// info-circle-button + modal chrome as shared/stat-legend.ts (bg-card
// rounded-2xl border shadow-pop over a dark backdrop) so this reads as the
// same kind of glossary affordance rather than a new pattern, just with
// explanatory prose instead of a code/label list. Placed in the card
// picker (battle-detail.html), which is shown both composing a new
// challenge and accepting one — the two moments someone actually needs
// this before committing a card and risking points.
@Component({
  selector: "app-battles-info",
  standalone: true,
  template: `
    <button
      type="button"
      (click)="open.set(true)"
      class="w-5 h-5 rounded-full flex items-center justify-center text-muted hover:text-team-primary hover:bg-team-primary/10 transition-colors shrink-0"
      [attr.aria-label]="i18n.t('battles.howItWorksTitle')"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="16" x2="12" y2="11" />
        <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    </button>
    @if (open()) {
      <div class="info-backdrop fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" (click)="open.set(false)">
        <button
          type="button"
          (click)="open.set(false)"
          class="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none font-bold"
          [attr.aria-label]="i18n.t('statLegend.close')"
        >
          &times;
        </button>
        <div class="info-panel w-full max-w-sm bg-card rounded-2xl border border-line shadow-pop p-5" (click)="$event.stopPropagation()">
          <p class="font-display text-lg tracking-wide mb-4">{{ i18n.t('battles.howItWorksTitle') }}</p>
          <div class="space-y-3 text-sm text-muted">
            <p>{{ i18n.t('battles.howItWorksStep1') }}</p>
            <p>{{ i18n.t('battles.howItWorksStep2') }}</p>
            <p>{{ i18n.t('battles.howItWorksStep3') }}</p>
            <p>{{ i18n.t('battles.howItWorksStep4') }}</p>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .info-backdrop {
        animation: info-fade-in 200ms ease;
      }
      .info-panel {
        animation: info-pop-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes info-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes info-pop-in {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(8px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
    `,
  ],
})
export class BattlesInfoComponent {
  protected i18n = inject(I18nService);
  readonly open = signal(false);
}
