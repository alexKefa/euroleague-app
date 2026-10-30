import { Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FirstPicksService } from "../core/first-picks.service";
import { I18nService } from "../core/i18n.service";
import { ButtonDirective } from "./button.directive";
import { NavIconComponent } from "./nav-icon";

/**
 * "Pick 3 games, get a free pack" progress card (2026-10-05). Shown until
 * the reward is claimed. `onPicksPage` swaps the button for a how-to line,
 * since picks only count once saved.
 */
@Component({
  selector: "app-first-picks-card",
  standalone: true,
  imports: [RouterLink, ButtonDirective, NavIconComponent],
  template: `
    @if (status(); as s) {
      <div class="relative overflow-hidden rounded-3xl p-4 border border-team-primary/40 bg-card shadow-card">
        <div class="pointer-events-none absolute inset-0" style="background: linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 22%, transparent) 0%, transparent 70%)" aria-hidden="true"></div>
        <div class="relative flex items-center gap-3">
          <span class="w-12 h-12 rounded-2xl bg-team-primary text-team-secondary flex items-center justify-center shrink-0 shadow-card">
            <app-nav-icon name="packs" [size]="24" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="font-display text-base leading-tight">{{ i18n.t('firstPicks.title').replace('{n}', '' + s.target) }}</p>
            <p class="text-[12px] text-muted mt-0.5">{{ subtitle() }}</p>
          </div>
        </div>
        <div class="relative flex items-center gap-2 mt-3">
          @for (i of steps(); track i) {
            <span class="h-2 flex-1 rounded-full transition-colors" [class]="i < s.picks ? 'bg-team-primary' : 'bg-line'"></span>
          }
          <span class="font-mono text-[12px] font-bold tabular-nums shrink-0 ml-1">{{ min(s.picks, s.target) }}/{{ s.target }}</span>
        </div>
        @if (!onPicksPage()) {
          <a routerLink="/predictions" appButton appButtonSize="sm" class="relative w-full mt-3">{{ i18n.t('firstPicks.cta') }}</a>
        }
      </div>
    }
  `,
})
export class FirstPicksCardComponent {
  private firstPicks = inject(FirstPicksService);
  protected i18n = inject(I18nService);

  readonly onPicksPage = input(false);

  readonly status = computed(() => {
    const s = this.firstPicks.status();
    return s && !s.claimed ? s : null;
  });
  readonly steps = computed(() => Array.from({ length: this.status()?.target ?? 0 }, (_, i) => i));
  readonly subtitle = computed(() => {
    const s = this.status();
    if (!s) return "";
    const left = Math.max(s.target - s.picks, 0);
    if (this.onPicksPage()) return this.i18n.t("firstPicks.howTo");
    return this.i18n.t(left === 1 ? "firstPicks.leftOne" : "firstPicks.leftMany").replace("{n}", String(left));
  });

  protected min(a: number, b: number): number {
    return Math.min(a, b);
  }
}
