import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "../../core/api-config";
import { I18nService } from "../../core/i18n.service";

interface SignupStats {
  visits: number;
  signups: number;
  bySource: { source: string; visits: number; signups: number }[];
  weekly: { week: string; signups: number }[];
}

/**
 * Signups (2026-10-16): where the last 30 days' visits and signups came from
 * (backend routes/visits.ts). Tag posted links with ?utm_source=tiktok&
 * utm_campaign=round6 to see which posts bring people in.
 */
@Component({
  selector: "app-admin-signups",
  standalone: true,
  template: `
    <div class="min-w-0">
      <p class="text-xs text-muted mb-4 break-words">{{ i18n.t('admin.signupsDescription') }}</p>
      @if (error()) {
        <p class="text-sm text-red-500">{{ i18n.t('admin.signupsFailed') }}</p>
      } @else if (stats(); as s) {
        <div class="grid grid-cols-3 gap-2 mb-5">
          @for (tile of tiles(); track tile.label) {
            <div class="rounded-lg border border-line bg-page p-3 text-center min-w-0">
              <p class="font-display text-2xl tabular-nums">{{ tile.value }}</p>
              <p class="text-xs text-muted font-semibold uppercase tracking-wide break-words">{{ i18n.t(tile.label) }}</p>
            </div>
          }
        </div>

        <p class="text-xs text-muted font-bold uppercase tracking-wider mb-2">{{ i18n.t('admin.signupsBySource') }}</p>
        @if (s.bySource.length === 0) {
          <p class="text-sm text-muted mb-5">{{ i18n.t('admin.signupsEmpty') }}</p>
        } @else {
          <div class="overflow-x-auto mb-5">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-xs text-muted uppercase tracking-wide">
                  <th class="text-left font-semibold py-1.5">{{ i18n.t('admin.signupsSource') }}</th>
                  <th class="text-right font-semibold py-1.5">{{ i18n.t('admin.signupsVisits') }}</th>
                  <th class="text-right font-semibold py-1.5">{{ i18n.t('admin.signupsSignups') }}</th>
                  <th class="text-right font-semibold py-1.5">%</th>
                </tr>
              </thead>
              <tbody>
                @for (row of s.bySource; track row.source) {
                  <tr class="border-t border-line">
                    <td class="py-1.5 font-semibold break-all">{{ row.source === 'untracked' ? i18n.t('admin.signupsUntracked') : row.source }}</td>
                    <td class="py-1.5 text-right tabular-nums">{{ row.visits }}</td>
                    <td class="py-1.5 text-right tabular-nums">{{ row.signups }}</td>
                    <td class="py-1.5 text-right tabular-nums text-muted">{{ rate(row.signups, row.visits) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <p class="text-xs text-muted font-bold uppercase tracking-wider mb-2">{{ i18n.t('admin.signupsWeekly') }}</p>
        <div class="space-y-1">
          @for (w of s.weekly; track w.week) {
            <div class="flex items-center gap-2 text-xs">
              <span class="font-mono text-muted w-20 shrink-0">{{ w.week }}</span>
              <div class="flex-1 h-2 rounded-full bg-line overflow-hidden">
                <div class="h-full bg-team-primary" [style.width.%]="(w.signups / maxWeekly()) * 100"></div>
              </div>
              <span class="tabular-nums w-6 text-right shrink-0">{{ w.signups }}</span>
            </div>
          }
        </div>
      } @else {
        <p class="text-sm text-muted">{{ i18n.t('admin.signupsLoading') }}</p>
      }
    </div>
  `,
})
export class AdminSignupsComponent implements OnInit {
  private http = inject(HttpClient);
  protected i18n = inject(I18nService);

  readonly stats = signal<SignupStats | null>(null);
  readonly error = signal(false);

  readonly tiles = computed(() => {
    const s = this.stats();
    if (!s) return [];
    return [
      { label: "admin.signupsVisits", value: s.visits },
      { label: "admin.signupsSignups", value: s.signups },
      { label: "admin.signupsConversion", value: this.rate(s.signups, s.visits) },
    ];
  });

  readonly maxWeekly = computed(() => Math.max(1, ...(this.stats()?.weekly.map((w) => w.signups) ?? [])));

  ngOnInit(): void {
    this.http.get<SignupStats>(`${API_BASE_URL}/visits/stats`).subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.error.set(true),
    });
  }

  /** Signups per 100 visits; "–" without visits (e.g. signups from before tracking). */
  rate(signups: number, visits: number): string {
    return visits > 0 ? `${((signups / visits) * 100).toFixed(1)}%` : "–";
  }
}
