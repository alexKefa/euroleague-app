import { Component, inject, OnInit, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "../../core/api-config";
import { I18nService } from "../../core/i18n.service";
import { DailyQuestionSuspect } from "../../core/models";

/**
 * Daily Question accounts that answer near-perfectly and very fast
 * (backend GET /admin/daily-question/suspicious). Flags only.
 */
@Component({
  selector: "app-admin-daily-question",
  standalone: true,
  template: `
    <div class="min-w-0">
      <p class="text-[12px] text-muted mb-3 break-words">{{ i18n.t('admin.dqDescription') }}</p>
      @if (loading()) {
        <p class="text-sm text-muted">…</p>
      } @else if (failed()) {
        <p class="text-red-500 text-xs font-semibold">{{ i18n.t('admin.dqLoadFailed') }}</p>
      } @else if (rows().length === 0) {
        <p class="text-sm text-muted">{{ i18n.t('admin.dqNone') }}</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-[11px] text-muted uppercase tracking-wide text-left">
                <th class="py-1.5 pr-2 font-semibold"></th>
                <th class="py-1.5 px-2 font-semibold text-right">{{ i18n.t('admin.dqAnswers') }}</th>
                <th class="py-1.5 px-2 font-semibold text-right">{{ i18n.t('admin.dqCorrect') }}</th>
                <th class="py-1.5 pl-2 font-semibold text-right">{{ i18n.t('admin.dqMedian') }}</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.userId) {
                <tr class="border-t border-line">
                  <td class="py-2 pr-2 font-semibold truncate max-w-[10rem]">{{ r.username }}</td>
                  <td class="py-2 px-2 text-right tabular-nums">{{ r.answers }}</td>
                  <td class="py-2 px-2 text-right tabular-nums">{{ r.correctPct }}%</td>
                  <td class="py-2 pl-2 text-right tabular-nums">{{ (r.medianResponseMs / 1000).toFixed(2) }} s</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class AdminDailyQuestionComponent implements OnInit {
  private http = inject(HttpClient);
  protected i18n = inject(I18nService);

  protected readonly rows = signal<DailyQuestionSuspect[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  ngOnInit(): void {
    this.http.get<{ rows: DailyQuestionSuspect[] }>(`${API_BASE_URL}/admin/daily-question/suspicious`).subscribe({
      next: (res) => {
        this.rows.set(res.rows);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }
}
