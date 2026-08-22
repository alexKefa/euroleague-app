import { Component, Input, inject, signal } from "@angular/core";
import { I18nService } from "../core/i18n.service";

export interface StatLegendEntry {
  code: string;
  label: string;
}

// A small "what does this mean?" affordance for stat-abbreviation columns
// (roster tables, box scores) — same modal chrome as predictions' badge
// legend (bg-card rounded-2xl border shadow-pop over a dark backdrop) so it
// reads as the same kind of glossary rather than a new pattern per page.
@Component({
  selector: "app-stat-legend",
  standalone: true,
  template: `
    <button
      type="button"
      (click)="open.set(true)"
      class="w-5 h-5 rounded-full flex items-center justify-center text-muted hover:text-highlight hover:bg-highlight/10 transition-colors shrink-0"
      [attr.aria-label]="i18n.t('statLegend.title')"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="16" x2="12" y2="11" />
        <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    </button>
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
        (click)="open.set(false)"
      >
        <button
          type="button"
          (click)="open.set(false)"
          class="absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none font-bold"
          [attr.aria-label]="i18n.t('statLegend.close')"
        >
          &times;
        </button>
        <div class="w-full max-w-sm bg-card rounded-2xl border border-line shadow-pop p-5" (click)="$event.stopPropagation()">
          <p class="font-display text-lg tracking-wide mb-4">{{ i18n.t('statLegend.title') }}</p>
          <div class="space-y-2.5 text-sm">
            @for (entry of entries; track entry.code) {
              <div class="flex items-baseline gap-3">
                <span class="font-mono text-highlight font-bold w-14 shrink-0">{{ entry.code }}</span>
                <span class="text-muted">{{ entry.label }}</span>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class StatLegendComponent {
  protected i18n = inject(I18nService);

  @Input({ required: true }) entries: StatLegendEntry[] = [];

  readonly open = signal(false);
}
