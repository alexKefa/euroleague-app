import { Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { I18nService } from "../../core/i18n.service";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { BuilderStore } from "./builder-store";
import { topPercent } from "./percentiles";

/**
 * The workspace's table: tap a header to sort, each cell tinted by the
 * player's league percentile for that column (deeper = better).
 */
@Component({
  selector: "app-results-table",
  standalone: true,
  imports: [RouterLink, RetryImgDirective],
  template: `
    <div class="overflow-x-auto rounded-2xl border border-line shadow-card bg-card">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th class="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[11px] text-muted whitespace-nowrap">
              {{ i18n.t("stats.colPlayer") }}
            </th>
            @for (col of store.columns(); track col.id) {
              <th
                (click)="store.setSort(col.id)"
                class="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[11px] whitespace-nowrap cursor-pointer select-none hover:text-ink transition-colors"
                [class.text-muted]="sortId() !== col.id"
                [class.text-team-primary]="sortId() === col.id"
                [attr.aria-sort]="sortId() === col.id ? (store.workspace().sort?.desc ? 'descending' : 'ascending') : null"
              >
                @if (col.error) {
                  <span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1 align-middle"></span>
                }
                {{ col.label }}
                @if (sortId() === col.id) {
                  <span class="inline-block">{{ store.workspace().sort?.desc ? "↓" : "↑" }}</span>
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of store.sortedRows(); track row.player.id) {
            <tr [routerLink]="['/players', row.player.id]" class="border-t border-line hover:bg-page transition-colors cursor-pointer">
              <td class="sticky left-0 z-10 bg-card px-3 py-2 font-bold whitespace-nowrap">
                <span class="flex items-center gap-2">
                  @if (row.team.logoUrl) {
                    <img [src]="row.team.logoUrl" [alt]="row.team.name" loading="lazy" decoding="async" appRetryImg class="w-5 h-5 object-contain shrink-0 team-logo" />
                  } @else {
                    <span class="w-5 h-5 rounded-full shrink-0" [style.background]="row.team.primaryColor"></span>
                  }
                  <span class="truncate">{{ row.player.name }}</span>
                </span>
              </td>
              @for (col of store.columns(); track col.id) {
                @let pct = store.percentile(col.id, row);
                <td class="px-3 py-2 text-right whitespace-nowrap tabular-nums" [style.background]="tint(pct)" [class.font-semibold]="sortId() === col.id">
                  {{ col.format(col.get(row)) }}
                  @if (sortId() === col.id && pct !== null) {
                    <span class="block text-[10px] font-normal text-muted leading-tight">{{ topLabel(pct) }}</span>
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ResultsTableComponent {
  protected store = inject(BuilderStore);
  protected i18n = inject(I18nService);

  protected sortId(): string | null {
    return this.store.workspace().sort?.columnId ?? null;
  }

  protected tint(pct: number | null): string | null {
    return pct === null ? null : `color-mix(in srgb, var(--accent-primary) ${Math.round(pct * 0.35)}%, transparent)`;
  }

  protected topLabel(pct: number): string {
    return this.i18n.t("builder.topPercent").replace("{n}", String(topPercent(pct)));
  }
}

