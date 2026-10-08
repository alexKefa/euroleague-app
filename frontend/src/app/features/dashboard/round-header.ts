import { Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { CountUpComponent } from "../../shared/count-up";
import { countdownTone, formatCountdown } from "./round-status.logic";
import { RoundStatusService } from "./round-status.service";

/**
 * Round header (2026-10-07 dashboard redesign): the one bold, team-colour
 * element on the home screen. Round number, "N of M done" + progress, and a
 * countdown to the next deadline; per-phase variants for guests, all done
 * and between rounds. The round recap stays a one-time popup owned by the
 * dashboard, so it isn't projected here.
 */
@Component({
  selector: "app-round-header",
  standalone: true,
  imports: [RouterLink, ButtonDirective, SkeletonComponent, CountUpComponent],
  template: `
    @if (rs.loading()) {
      <app-skeleton class="block rounded-3xl h-[124px] mb-4" />
    } @else if (rs.scheduleError()) {
      <div class="rounded-3xl p-4 mb-4 bg-card border border-line shadow-card flex items-center justify-between gap-3">
        <p class="text-sm text-muted">{{ i18n.t("dashboard.roundHeader.error") }}</p>
        <button type="button" appButton="outline" appButtonSize="sm" (click)="rs.refresh()">{{ i18n.t("dashboard.roundHeader.retry") }}</button>
      </div>
    } @else if (status(); as s) {
      <section class="rounded-3xl p-4 mb-4 bg-team-primary text-team-secondary shadow-card" [attr.aria-label]="roundLabel()">
        <div class="flex items-end justify-between gap-4">
          <div class="min-w-0">
            @if (auth.isAuthenticated()) {
              <p class="text-sm font-semibold opacity-80">{{ roundLabel() }}</p>
            }
            <p class="font-display text-3xl leading-none mt-1 text-balance">
              @if (!auth.isAuthenticated()) {
                {{ roundLabel() }}
              } @else if (s.phase === "between") {
                {{ fill("dashboard.roundHeader.complete", { n: s.round }) }}
              } @else if (s.phase === "allDone") {
                {{ fill("dashboard.roundHeader.ready", { n: s.round }) }} ✓
              } @else {
                @let prog = around("dashboard.roundHeader.progress", "done", { total: s.rows.length });
                {{ prog[0] }}<app-count-up [value]="s.doneCount" [duration]="0.5" />{{ prog[1] }}
              }
            </p>
            @if (auth.isAuthenticated() && s.phase !== "open" && scoreLine(); as line) {
              <p class="text-sm font-semibold mt-1.5 opacity-90 tabular-nums">
                @if (line.points !== null) {
                  {{ line.pointsText[0] }}<app-count-up [value]="line.points" />{{ line.pointsText[1] }}
                }
                @if (line.points !== null && line.rank !== null) {
                  ·
                }
                @if (line.rank !== null) {
                  #<app-count-up [value]="line.rank" [from]="line.rank + 20" />
                }
              </p>
            }
          </div>
          @if (countdown(); as c) {
            <div class="text-right shrink-0">
              <p class="text-xs font-semibold opacity-80">{{ c.label }}</p>
              <!-- Soon/urgent use a pill with its own fill: tinted text alone
                   disappears on a near-white team colour (Real Madrid). -->
              <p
                class="font-display text-3xl leading-none mt-1 tabular-nums inline-block rounded-xl"
                [class.px-2]="c.tone !== 'normal'"
                [class.py-0.5]="c.tone !== 'normal'"
                [class.bg-amber-400]="c.tone === 'soon'"
                [class.text-neutral-950]="c.tone === 'soon'"
                [class.bg-red-600]="c.tone === 'urgent'"
                [class.text-white]="c.tone === 'urgent'"
                [class.animate-pulse]="c.tone === 'urgent'"
                [class.motion-reduce:animate-none]="c.tone === 'urgent'"
              >{{ c.text }}</p>
            </div>
          }
        </div>
        @if (auth.isAuthenticated() && s.phase === "open" && s.rows.length) {
          <div class="mt-3 h-1.5 rounded-full bg-team-secondary/25 overflow-hidden" role="progressbar" [attr.aria-valuenow]="s.doneCount" [attr.aria-valuemax]="s.rows.length">
            <div class="h-full rounded-full bg-team-secondary transition-[width] duration-500" [style.width.%]="(s.doneCount / s.rows.length) * 100"></div>
          </div>
        }
        @if (!auth.isAuthenticated()) {
          <!-- appButton's primary fill is the team colour itself, which would vanish on this card. -->
          <a routerLink="/register" class="mt-3 flex items-center justify-center h-11 rounded-2xl bg-team-secondary text-team-primary text-sm font-semibold">
            {{ i18n.t("dashboard.roundHeader.signUp") }}
          </a>
        }
      </section>
    }
  `,
})
export class RoundHeaderComponent {
  protected rs = inject(RoundStatusService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly rank = input<number | null>(null);

  protected readonly status = this.rs.status;

  protected readonly roundLabel = computed(() => {
    const s = this.status();
    return s ? this.fill("dashboard.roundHeader.round", { n: s.round }) : "";
  });

  // Points + rank, with the text around each number split out so the
  // numbers themselves can roll (app-count-up, 2026-10-08).
  protected readonly scoreLine = computed(() => {
    const s = this.status();
    const points = this.rs.roundPoints();
    const rank = this.rank();
    if (points === null && rank === null) return null;
    const pointsKey = s?.phase === "allDone" ? "dashboard.roundHeader.pointsSoFar" : "dashboard.roundHeader.points";
    return { points, pointsText: this.around(pointsKey, "n", {}), rank };
  });

  // [before, after] the {slot} placeholder of a translated string.
  protected around(key: string, slot: string, values: Record<string, string | number>): [string, string] {
    const text = this.fill(key, values);
    const i = text.indexOf(`{${slot}}`);
    return i === -1 ? [text, ""] : [text.slice(0, i), text.slice(i + slot.length + 2)];
  }

  protected readonly countdown = computed(() => {
    const s = this.status();
    if (!s?.nextDeadline || s.phase === "between") return null;
    const ms = s.nextDeadline.at.getTime() - this.rs.now();
    // Guests have no picks of their own, so their countdown is simply to the first game.
    const labelKey = !this.auth.isAuthenticated()
      ? "dashboard.roundHeader.firstGameIn"
      : s.nextDeadline.kind === "picks"
        ? "dashboard.roundHeader.picksLockIn"
        : s.nextDeadline.kind === "fantasy"
          ? "dashboard.roundHeader.fantasyLocksIn"
          : "dashboard.roundHeader.firstGameIn";
    return {
      label: this.i18n.t(labelKey),
      text: formatCountdown(ms, { d: this.i18n.t("dashboard.roundHeader.unitD"), h: this.i18n.t("dashboard.roundHeader.unitH") }),
      tone: countdownTone(ms),
    };
  });

  protected fill(key: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), this.i18n.t(key));
  }
}
