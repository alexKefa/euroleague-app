import { Component, inject, OnInit, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "../../core/api-config";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { newsDateLocale } from "../../shared/news-date-format";

interface ErrorGroup {
  fingerprint: string;
  count: number;
  lastAt: string;
  firstAt: string;
  source: string;
  method: string | null;
  path: string | null;
  context: string | null;
  message: string;
  stack: string | null;
}

/**
 * Production errors (2026-10-12, backend services/errorReport.ts): the last
 * week's errors grouped by fingerprint, newest first. Tap one for its stack.
 * "Send a test error" checks the whole path end to end.
 */
@Component({
  selector: "app-admin-errors",
  standalone: true,
  imports: [DatePipe, ButtonDirective],
  template: `
    <div class="min-w-0">
      <p class="text-[12px] text-muted mb-3 break-words">{{ i18n.t('admin.errorsDescription') }}</p>
      <div class="flex flex-wrap gap-2 mb-4">
        @for (d of [1, 7, 30]; track d) {
          <button type="button" appButton="outline" appButtonSize="sm" [class.!border-team-primary]="days() === d" (click)="load(d)">
            {{ i18n.t('admin.errorsDays').replace('{n}', '' + d) }}
          </button>
        }
        <button type="button" appButton="secondary" appButtonSize="sm" class="ml-auto" [disabled]="testing()" (click)="sendTest()">
          {{ i18n.t('admin.errorsTest') }}
        </button>
      </div>

      @if (loading()) {
        <p class="text-sm text-muted">{{ i18n.t('admin.errorsLoading') }}</p>
      } @else if (failed()) {
        <p class="text-red-500 text-xs font-semibold">{{ i18n.t('admin.errorsLoadFailed') }}</p>
      } @else if (groups().length === 0) {
        <p class="text-sm text-muted">{{ i18n.t('admin.errorsNone') }}</p>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (g of groups(); track g.fingerprint) {
            <li class="rounded-xl border border-line bg-page min-w-0">
              <button type="button" class="w-full text-left p-3 min-w-0" (click)="toggle(g.fingerprint)">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="shrink-0 rounded-full bg-red-500/15 text-red-500 text-[11px] font-semibold px-2 py-0.5 tabular-nums">×{{ g.count }}</span>
                  <span class="text-[11px] text-muted uppercase tracking-wide shrink-0">{{ g.source }}</span>
                  <span class="text-[11px] text-muted ml-auto shrink-0">{{ g.lastAt | date: 'd MMM, HH:mm' : undefined : dateLocale() }}</span>
                </div>
                <p class="text-sm font-semibold mt-1.5 break-words">{{ g.message }}</p>
                @if (g.path || g.context) {
                  <p class="text-[12px] text-muted mt-0.5 break-all">{{ g.method ? g.method + ' ' : '' }}{{ g.path ?? g.context }}</p>
                }
              </button>
              @if (open() === g.fingerprint) {
                <div class="px-3 pb-3">
                  @if (g.context && g.path) {
                    <p class="text-[12px] text-muted mb-1 break-words">{{ g.context }}</p>
                  }
                  <p class="text-[11px] text-muted mb-1">{{ i18n.t('admin.errorsFirstSeen') }} {{ g.firstAt | date: 'd MMM, HH:mm' : undefined : dateLocale() }}</p>
                  <pre class="text-[11px] leading-snug bg-card border border-line rounded-lg p-2 overflow-x-auto whitespace-pre">{{ g.stack ?? '—' }}</pre>
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class AdminErrorsComponent implements OnInit {
  private http = inject(HttpClient);
  protected i18n = inject(I18nService);

  // Month names in the app language (2026-10-16).
  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  protected readonly groups = signal<ErrorGroup[]>([]);
  protected readonly days = signal(7);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly testing = signal(false);
  protected readonly open = signal<string | null>(null);

  ngOnInit(): void {
    this.load(7);
  }

  protected load(days: number): void {
    this.days.set(days);
    this.loading.set(true);
    this.failed.set(false);
    this.http.get<ErrorGroup[]>(`${API_BASE_URL}/admin/errors`, { params: { days } }).subscribe({
      next: (rows) => {
        this.groups.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  protected toggle(fingerprint: string): void {
    this.open.set(this.open() === fingerprint ? null : fingerprint);
  }

  // The test route always answers 500; the error is saved in the
  // background, so reload a moment later.
  protected sendTest(): void {
    this.testing.set(true);
    this.http.post(`${API_BASE_URL}/admin/errors/test`, {}).subscribe({
      error: () =>
        setTimeout(() => {
          this.testing.set(false);
          this.load(this.days());
        }, 1200),
      next: () => this.testing.set(false),
    });
  }
}
