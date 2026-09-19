import { Component, computed, inject, input } from "@angular/core";
import { InjuryStatus } from "../core/models";
import { I18nService } from "../core/i18n.service";
import { injuryStatusLabel, injuryBadgeBgClass, injuryNoteFor } from "./injury-status";

// Small circular status dot for a player's active injury report — a
// compact companion to injury-status.ts's text-pill styling (Injury
// Report page, roster table), for spots too small for a full pill:
// Fantasy Five's court slots, pool rows, and picker popups. Same
// medical-cross glyph as nav-icon.ts's "injury" icon, inlined here since
// it needs to scale down to ~12-16px and pick up a solid severity color
// nav-icon's single-currentColor glyph doesn't support. Purely a visual
// badge — callers position it (each context's free corner differs, see
// fantasy.html) by wrapping it in their own absolutely-positioned span.
@Component({
  selector: "app-injury-badge",
  standalone: true,
  template: `
    <span
      class="flex items-center justify-center rounded-full border border-page"
      [class]="bgClass()"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [attr.title]="title()"
    >
      <svg viewBox="0 0 24 24" fill="none" [style.width.px]="iconSize()" [style.height.px]="iconSize()">
        <path
          d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
          stroke="white"
          stroke-width="2.4"
          stroke-linejoin="round"
        />
        <path d="M12 8.5v7M8.5 12h7" stroke="white" stroke-width="2.6" stroke-linecap="round" />
      </svg>
    </span>
  `,
})
export class InjuryBadgeComponent {
  private i18n = inject(I18nService);

  readonly status = input.required<InjuryStatus>();
  readonly note = input<string | null>(null);
  readonly noteEl = input<string | null>(null);
  readonly size = input(16);

  protected readonly iconSize = computed(() => Math.round(this.size() * 0.62));
  protected readonly bgClass = computed(() => injuryBadgeBgClass(this.status()));
  protected readonly title = computed(() => {
    const label = injuryStatusLabel(this.i18n, this.status());
    const note = injuryNoteFor(this.i18n, this.note(), this.noteEl());
    return note ? `${label} — ${note}` : label;
  });
}
