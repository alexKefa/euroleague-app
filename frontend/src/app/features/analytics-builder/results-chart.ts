import { Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { PlayerAdvancedStatsRow } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { BuilderStore, ResolvedColumn } from "./builder-store";

interface Bar {
  row: PlayerAdvancedStatsRow;
  value: number | null;
  width: number;
}

/**
 * One bar list per column. Bar length is the league percentile, so a
 * longer bar means better everywhere (turnovers included). Columns that
 * aren't percentiled (games played) scale to the selection's max instead.
 */
@Component({
  selector: "app-results-chart",
  standalone: true,
  imports: [RouterLink, RetryImgDirective],
  template: `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      @for (col of store.columns(); track col.id) {
        <div class="bg-card rounded-2xl border border-line shadow-card p-4">
          <p class="text-xs text-muted font-bold uppercase tracking-wider mb-3">{{ col.label }}</p>
          <div class="space-y-3">
            @for (bar of bars(col); track bar.row.player.id) {
              <div>
                <div class="flex items-center justify-between mb-1 gap-2">
                  <a [routerLink]="['/players', bar.row.player.id]" class="flex items-center gap-1.5 text-xs font-bold truncate hover:text-team-primary transition-colors">
                    @if (bar.row.team.logoUrl) {
                      <img [src]="bar.row.team.logoUrl" [alt]="bar.row.team.name" loading="lazy" decoding="async" appRetryImg class="w-4 h-4 object-contain shrink-0 team-logo" />
                    }
                    <span class="truncate">{{ bar.row.player.name }}</span>
                  </a>
                  <span class="text-xs shrink-0 tabular-nums">{{ col.format(bar.value) }}</span>
                </div>
                <div class="relative h-2 rounded-[3px] bg-line overflow-hidden">
                  <div
                    class="absolute inset-y-0 left-0 rounded-[3px] transition-all duration-500 ease-out"
                    [style.width.%]="bar.width"
                    [style.background]="bar.row.team.primaryColor"
                  ></div>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ResultsChartComponent {
  protected store = inject(BuilderStore);

  protected bars(col: ResolvedColumn): Bar[] {
    const rows = this.store.selectedRows();
    if (col.percentiled) {
      return rows
        .map((row) => ({ row, value: col.get(row), width: this.store.percentile(col.id, row) ?? 0 }))
        .sort((a, b) => (a.value == null ? 1 : b.value == null ? -1 : b.width - a.width));
    }
    const values = rows.map((r) => col.get(r)).filter((v): v is number => v != null);
    const max = values.length ? Math.max(...values) : 0;
    return rows
      .map((row) => {
        const value = col.get(row);
        return { row, value, width: value != null && max > 0 ? (value / max) * 100 : 0 };
      })
      .sort((a, b) => b.width - a.width);
  }
}
