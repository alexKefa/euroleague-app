import { Component, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { API_BASE_URL } from "../../core/api-config";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";

const MAX_TEXT = 200;

/**
 * Push broadcast (2026-10-05): a notification to every device that turned
 * notifications on (backend routes/push.ts). Both languages required; each
 * device gets the one its app was set to. "Send to me" goes to the admin's
 * own devices first, to check how it looks.
 */
@Component({
  selector: "app-admin-push",
  standalone: true,
  imports: [ReactiveFormsModule, ButtonDirective, ConfirmDialogComponent],
  template: `
    <div class="min-w-0">
      <p class="text-[12px] text-muted mb-1 break-words">{{ i18n.t('admin.pushDescription') }}</p>
      @if (stats(); as s) {
        <p class="text-[12px] font-semibold mb-4">
          @if (s.enabled) {
            {{ i18n.t('admin.pushStats').replace('{devices}', '' + s.devices).replace('{users}', '' + s.users) }}
          } @else {
            <span class="text-red-500">{{ i18n.t('admin.pushDisabled') }}</span>
          }
        </p>
      }

      <form [formGroup]="form" class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          @for (lang of ['En', 'El']; track lang) {
            <div class="space-y-2">
              <p class="text-[11px] font-mono font-bold text-muted">{{ lang === 'En' ? 'English' : 'Ελληνικά' }}</p>
              <input
                type="text"
                [formControlName]="'title' + lang"
                [placeholder]="i18n.t('admin.announceTitlePlaceholder')"
                [maxlength]="maxText"
                class="w-full px-3 py-2 rounded-xl bg-page border-2 border-line text-sm font-semibold focus:border-team-primary outline-none"
              />
              <textarea
                [formControlName]="'body' + lang"
                [placeholder]="i18n.t('admin.announceBodyPlaceholder')"
                [maxlength]="maxText"
                rows="3"
                class="w-full px-3 py-2 rounded-xl bg-page border-2 border-line text-sm focus:border-team-primary outline-none resize-y"
              ></textarea>
            </div>
          }
        </div>
        <input
          type="text"
          formControlName="link"
          [placeholder]="i18n.t('admin.pushLinkPlaceholder')"
          class="w-full px-3 py-2 rounded-xl bg-page border-2 border-line text-sm font-mono focus:border-team-primary outline-none"
        />
        <div class="flex flex-wrap gap-2">
          <button type="button" appButton="outline" appButtonSize="sm" (click)="send(true)" [disabled]="sending() || form.invalid">
            {{ i18n.t('admin.pushSendTest') }}
          </button>
          <button type="button" appButton appButtonSize="sm" (click)="confirming.set(true)" [disabled]="sending() || form.invalid || !stats()?.enabled">
            {{ i18n.t('admin.pushSendAll') }}
          </button>
        </div>
        @if (error()) {
          <p class="text-red-500 text-xs font-semibold">{{ error() }}</p>
        }
        @if (result(); as r) {
          <p class="text-emerald-500 text-xs font-semibold">{{ i18n.t('admin.pushSent').replace('{n}', '' + r.sent) }}</p>
        }
      </form>
    </div>
    @if (confirming()) {
      <app-confirm-dialog
        [message]="i18n.t('admin.pushConfirm').replace('{devices}', '' + (stats()?.devices ?? 0))"
        [confirmLabel]="i18n.t('admin.pushSendAll')"
        [cancelLabel]="i18n.t('admin.announceCancel')"
        [danger]="false"
        (confirmed)="confirming.set(false); send(false)"
        (cancelled)="confirming.set(false)"
      />
    }
  `,
})
export class AdminPushComponent {
  private http = inject(HttpClient);
  protected i18n = inject(I18nService);
  private fb = inject(FormBuilder);

  readonly maxText = MAX_TEXT;
  readonly stats = signal<{ enabled: boolean; devices: number; users: number } | null>(null);
  readonly sending = signal(false);
  readonly confirming = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<{ sent: number } | null>(null);

  readonly form = this.fb.nonNullable.group({
    titleEn: ["", [Validators.required, Validators.maxLength(MAX_TEXT)]],
    titleEl: ["", [Validators.required, Validators.maxLength(MAX_TEXT)]],
    bodyEn: ["", [Validators.required, Validators.maxLength(MAX_TEXT)]],
    bodyEl: ["", [Validators.required, Validators.maxLength(MAX_TEXT)]],
    link: [""],
  });

  constructor() {
    this.loadStats();
  }

  private loadStats(): void {
    this.http.get<{ enabled: boolean; devices: number; users: number }>(`${API_BASE_URL}/push/stats`).subscribe({
      next: (s) => this.stats.set(s),
      error: () => {},
    });
  }

  send(testOnly: boolean): void {
    if (this.sending() || this.form.invalid) return;
    this.sending.set(true);
    this.error.set(null);
    this.result.set(null);
    this.http.post<{ devices: number; sent: number }>(`${API_BASE_URL}/push/broadcast`, { ...this.form.getRawValue(), testOnly }).subscribe({
      next: (r) => {
        this.sending.set(false);
        this.result.set(r);
        this.loadStats();
      },
      error: (err) => {
        this.sending.set(false);
        this.error.set((err as { error?: { error?: string } })?.error?.error ?? this.i18n.t("admin.pushFailed"));
      },
    });
  }
}
