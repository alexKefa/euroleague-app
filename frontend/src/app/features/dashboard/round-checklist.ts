import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ChecklistRow, formatCountdown } from "./round-status.logic";
import { RoundStatusService } from "./round-status.service";

interface RowView {
  row: ChecklistRow;
  title: string;
  detail: string | null;
  button: string;
  bonus: boolean;
}

/**
 * Round checklist (2026-10-07 dashboard redesign): what is still open this
 * round, one tap each. Open rows first (soonest deadline on top), done rows
 * tick off and sink. Guests get a 3-step "how it works" instead.
 */
@Component({
  selector: "app-round-checklist",
  standalone: true,
  imports: [RouterLink, ButtonDirective, SkeletonComponent],
  template: `
    @if (!auth.isAuthenticated()) {
      @if (!rs.loading()) {
        <section class="rounded-3xl p-4 mb-4 bg-card border border-line shadow-card">
          <ol class="grid gap-3">
            @for (key of guestSteps; track key; let i = $index) {
              <li class="grid grid-cols-[26px_1fr] gap-3 items-center">
                <span class="w-[26px] h-[26px] rounded-full bg-team-primary/15 text-team-primary text-xs font-bold flex items-center justify-center tabular-nums">{{ i + 1 }}</span>
                <span class="text-sm">{{ i18n.t(key) }}</span>
              </li>
            }
          </ol>
          <a routerLink="/register" appButton appButtonSize="sm" class="mt-4 w-full">{{ i18n.t("dashboard.checklist.guestCta") }}</a>
        </section>
      }
    } @else if (rs.loading()) {
      <!-- Same height as three rows, so nothing below shifts when it lands. -->
      <app-skeleton class="block rounded-3xl h-[188px] mb-4" />
    } @else if (status(); as s) {
      @if (s.phase !== "between" && views().length) {
        <section class="rounded-3xl px-4 py-1 mb-4 bg-card border border-line shadow-card">
          @if (s.phase === "allDone" && !expanded()) {
            <button type="button" (click)="expanded.set(true)" class="w-full flex items-center gap-3 py-3 text-left">
              <span class="w-[26px] h-[26px] rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <span class="flex-1 text-sm font-semibold">{{ fill("dashboard.checklist.allSet", { n: s.round }) }}</span>
              <span class="text-muted" aria-hidden="true">&rsaquo;</span>
            </button>
          } @else {
            @for (v of views(); track v.row.id; let first = $first) {
              <div
                class="grid grid-cols-[26px_1fr_auto] gap-3 items-center py-3"
                [class.border-t]="!first"
                [class.border-line]="!first"
                [class.opacity-60]="s.firstRun && !v.row.done && v.row.id !== 'picks'"
              >
                @if (v.row.done) {
                  <span class="tick-pop w-[26px] h-[26px] rounded-full bg-emerald-500 border-2 border-emerald-500 text-white flex items-center justify-center">
                    <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </span>
                } @else {
                  <span class="w-[26px] h-[26px] rounded-full border-2 border-line" aria-hidden="true"></span>
                }
                <div class="min-w-0">
                  <p class="text-sm font-semibold leading-tight flex items-center gap-2 flex-wrap" [class.text-muted]="v.row.done">
                    {{ v.title }}
                    @if (v.bonus && !v.row.done) {
                      <span class="text-[11px] font-semibold text-team-primary bg-team-primary/10 rounded-full px-2 py-0.5">{{ i18n.t("dashboard.checklist.bonus") }}</span>
                    }
                  </p>
                  @if (v.detail) {
                    <p class="text-xs text-muted mt-0.5 tabular-nums">{{ v.detail }}</p>
                  }
                  @if (v.row.fullTimeoutAvailable) {
                    <p class="text-xs text-amber-500 mt-0.5">{{ i18n.t("dashboard.checklist.fullTimeout") }}</p>
                  }
                </div>
                @if (!v.row.done) {
                  <a [routerLink]="v.row.link" [appButton]="v.row.id === firstOpenId() ? 'primary' : 'outline'" appButtonSize="sm">{{ v.button }}</a>
                } @else if (v.row.id === "fantasy") {
                  <a [routerLink]="v.row.link" class="text-xs font-semibold text-muted hover:text-ink">&rsaquo;</a>
                } @else {
                  <span></span>
                }
              </div>
            }
          }
        </section>
      }
    }
  `,
})
export class RoundChecklistComponent {
  protected rs = inject(RoundStatusService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  protected readonly status = this.rs.status;
  protected readonly expanded = signal(false);
  protected readonly guestSteps = ["dashboard.checklist.guestStep1", "dashboard.checklist.guestStep2", "dashboard.checklist.guestStep3"];

  protected readonly firstOpenId = computed(() => this.status()?.rows.find((r) => !r.done)?.id ?? null);

  protected readonly views = computed<RowView[]>(() => (this.status()?.rows ?? []).map((row) => this.view(row)));

  private view(row: ChecklistRow): RowView {
    const t = (key: string, values: Record<string, string | number> = {}) => this.fill(key, values);
    switch (row.id) {
      case "picks": {
        const { done, total } = row.count!;
        const left = total - done;
        return {
          row,
          title: row.done ? t("dashboard.checklist.picksDone") : t(left === 1 ? "dashboard.checklist.pickOne" : "dashboard.checklist.pickMany", { n: left }),
          detail: t("dashboard.checklist.pickedOf", { done, total }),
          button: t("dashboard.checklist.btnPick"),
          bonus: false,
        };
      }
      case "topScorer":
        return {
          row,
          title: t(row.done ? "dashboard.checklist.topScorerDone" : "dashboard.checklist.topScorer"),
          detail: t("dashboard.checklist.topScorerCount", { n: row.count!.done }),
          button: t("dashboard.checklist.btnChoose"),
          bonus: true,
        };
      case "fantasy":
        return {
          row,
          title: t(row.done ? "dashboard.checklist.fantasyDone" : "dashboard.checklist.fantasy"),
          detail: !row.done
            ? t("dashboard.checklist.fantasyDetail")
            : row.carriedFromRound
              ? t("dashboard.checklist.fantasyCarried", { n: row.carriedFromRound })
              : null,
          button: t("dashboard.checklist.btnOpen"),
          bonus: false,
        };
      case "spin": {
        const next = row.nextAt
          ? formatCountdown(row.nextAt.getTime() - this.rs.now(), { d: this.i18n.t("dashboard.roundHeader.unitD"), h: this.i18n.t("dashboard.roundHeader.unitH") })
          : null;
        return {
          row,
          title: t(row.done ? "dashboard.checklist.spinDone" : "dashboard.checklist.spin"),
          detail: row.done ? (next ? t("dashboard.checklist.spinNext", { t: next }) : null) : t("dashboard.checklist.spinDetail"),
          button: t("dashboard.checklist.btnSpin"),
          bonus: false,
        };
      }
    }
  }

  protected fill(key: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), this.i18n.t(key));
  }
}
