import { Component, DestroyRef, OnInit, computed, inject, signal } from "@angular/core";
import { DatePipe, NgClass } from "@angular/common";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { DailyQuestionPlayer, DailyQuestionState } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { DialogComponent } from "../../shared/dialog";
import { NavIconComponent } from "../../shared/nav-icon";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { formatPlayerName } from "../../shared/player-name";
import { TeamCodePipe } from "../../shared/team-display-code";
import { newsDateLocale } from "../../shared/news-date-format";

const SHOWN_MS = 10_000;
// The server accepts answers for 12 s and resolves a timeout after that;
// ask for the result just past it.
const RESULT_POLL_DELAY_MS = 2_500;

/**
 * Daily Question (2026-10-13, docs/superpowers/specs/2026-10-13-daily-question-design.md):
 * the dashboard card plus the play overlay. The countdown is display-only;
 * the server's clock decides. Nothing about the question is shown before
 * Play.
 */
@Component({
  selector: "app-daily-question-card",
  standalone: true,
  imports: [DatePipe, NgClass, ButtonDirective, DialogComponent, NavIconComponent, PlayerPhotoComponent, TeamCodePipe],
  template: `
    @if (auth.isAuthenticated() && state(); as s) {
      <section class="bg-card rounded-2xl border border-line shadow-card p-4 mb-4">
        <div class="flex items-center gap-3">
          <span class="card-head-icon"><app-nav-icon name="flame" [size]="18" /></span>
          <div class="min-w-0 flex-1">
            <p class="font-display text-lg leading-tight">{{ i18n.t('dq.title') }}</p>
            <p class="text-xs text-muted mt-0.5">
              @if (s.streak > 0) {
                <span class="font-semibold text-team-primary">{{ fill('dq.streak', s.streak) }}</span>
              }
              @if (s.status === 'ready') {
                @if (s.streak > 0) { · }
                {{ fill('dq.next', s.nextBonus) }}
              }
            </p>
          </div>
          @if (s.status === 'ready') {
            <button type="button" appButton appButtonSize="sm" class="shrink-0" [disabled]="busy()" (click)="play()">{{ i18n.t('dq.play') }}</button>
          } @else if (s.status === 'in_progress') {
            <button type="button" appButton appButtonSize="sm" class="shrink-0" (click)="openOverlay()">{{ i18n.t('dq.resume') }}</button>
          } @else if (s.status === 'done' && s.today?.result; as r) {
            <button type="button" (click)="openOverlay()" class="shrink-0 text-right">
              <span class="block font-display text-lg leading-none" [class.text-emerald-500]="r.correct" [class.text-muted]="!r.correct">+{{ r.points.total }}</span>
              <span class="block text-xs text-muted mt-1">{{ i18n.t(r.choice === null ? 'dq.timeout' : r.correct ? 'dq.correct' : 'dq.wrong') }}</span>
            </button>
          }
        </div>
        @if (s.status === 'ready') {
          <p class="text-xs text-muted mt-2">{{ i18n.t('dq.ready') }}. {{ i18n.t('dq.rules') }}</p>
        } @else if (s.status === 'done') {
          <p class="text-xs text-muted mt-2">{{ i18n.t('dq.tomorrow') }}</p>
        } @else if (s.status === 'unavailable') {
          <p class="text-xs text-muted mt-2">{{ i18n.t('dq.unavailable') }}</p>
        }
        @if (s.lockedUntil) {
          <p class="text-xs text-muted mt-1">{{ i18n.t('dq.locked').replace('{date}', (s.lockedUntil | date: 'd MMM' : undefined : dateLocale()) ?? '') }}</p>
        }
      </section>

      @if (overlayOpen() && s.today; as q) {
        <app-dialog [title]="i18n.t('dq.title')" icon="flame" [closeLabel]="i18n.t('dq.close')" (closed)="closeOverlay()">
          <p class="font-display text-xl leading-tight text-center mb-3">{{ questionText() }}</p>

          @if (!q.result) {
            <div class="h-2 rounded-full bg-page overflow-hidden mb-4" role="progressbar" [attr.aria-valuenow]="secondsLeft()" aria-valuemin="0" aria-valuemax="10">
              <div class="h-full bg-team-primary transition-[width] duration-100 ease-linear" [style.width.%]="(remaining() / SHOWN_MS) * 100"></div>
            </div>
            <p class="text-center font-display text-2xl tabular-nums -mt-2 mb-3" [class.text-red-500]="secondsLeft() <= 3">{{ secondsLeft() }}</p>
          }

          <div class="grid grid-cols-2 gap-3">
            @for (side of sides; track side) {
              @let p = side === 'a' ? q.playerA : q.playerB;
              @let value = q.result ? (side === 'a' ? q.result.valueA : q.result.valueB) : null;
              @let other = q.result ? (side === 'a' ? q.result.valueB : q.result.valueA) : null;
              <button
                type="button"
                (click)="answer(side)"
                [disabled]="!!q.result || busy() || remaining() <= 0"
                class="rounded-2xl border-2 p-3 flex flex-col items-center gap-2 transition-colors disabled:cursor-default"
                [ngClass]="{
                  'border-team-primary': !!q.result && q.result.choice === side,
                  'border-line': !q.result || q.result.choice !== side,
                  'hover:border-team-primary': !q.result,
                  'bg-emerald-500/10': value !== null && other !== null && value > other
                }"
              >
                <app-player-photo [photoUrl]="p.photoUrl" [name]="p.name" [teamCode]="p.teamCode" [size]="72" [centerFace]="true" />
                <span class="text-sm font-semibold text-center leading-tight">{{ name(p) }}</span>
                <span class="text-xs text-muted">{{ p.teamCode | teamCode }}</span>
                @if (value !== null) {
                  <span class="font-display text-3xl tabular-nums leading-none" [class.text-emerald-500]="other !== null && value > other">{{ value }}</span>
                }
              </button>
            }
          </div>

          @if (q.result; as r) {
            <p class="font-display text-xl text-center mt-4" [class.text-emerald-500]="r.correct">
              {{ i18n.t(r.choice === null ? 'dq.timeout' : r.correct ? 'dq.correct' : 'dq.wrong') }}
            </p>
            <dl class="mt-3 rounded-2xl border border-line divide-y divide-line text-sm">
              <div class="flex justify-between px-3 py-2"><dt class="text-muted">{{ i18n.t('dq.pts.streak') }} · {{ fill('dq.streak', s.streak) }}</dt><dd class="tabular-nums">+{{ r.points.streakBonus }}</dd></div>
              @if (r.points.correctBonus > 0) {
                <div class="flex justify-between px-3 py-2"><dt class="text-muted">{{ i18n.t('dq.pts.correct') }}</dt><dd class="tabular-nums">+{{ r.points.correctBonus }}</dd></div>
              }
              @if (r.points.milestone > 0) {
                <div class="flex justify-between px-3 py-2"><dt class="text-muted">{{ i18n.t('dq.pts.milestone') }}</dt><dd class="tabular-nums">+{{ r.points.milestone }}</dd></div>
              }
              <div class="flex justify-between px-3 py-2 font-semibold"><dt>{{ i18n.t('dq.pts.total') }}</dt><dd class="tabular-nums text-team-primary">+{{ r.points.total }}</dd></div>
            </dl>
            <p class="text-xs text-muted text-center mt-3">{{ i18n.t('dq.tomorrow') }}</p>
          }
        </app-dialog>
      }
    }
  `,
})
export class DailyQuestionCardComponent implements OnInit {
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  // Month names in the app language (2026-10-16).
  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }
  private api = inject(ApiService);

  protected readonly SHOWN_MS = SHOWN_MS;
  protected readonly sides = ["a", "b"] as const;

  protected readonly state = signal<DailyQuestionState | null>(null);
  protected readonly overlayOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly remaining = signal(SHOWN_MS);
  protected readonly secondsLeft = computed(() => Math.ceil(this.remaining() / 1000));

  protected readonly questionText = computed(() => {
    const q = this.state()?.today;
    if (!q) return "";
    return this.i18n.t(`dq.q.${q.template}`).replace("{stat}", this.i18n.t(`dq.stat.${q.stat}`));
  });

  // Client-side end of the 10 s, fixed when each state arrives, so Resume
  // counts down from the truth rather than a stale remainingMs.
  private deadline: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopTick();
      this.stopPoll();
    });
  }

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) return;
    this.refresh();
  }

  protected fill(key: string, n: number): string {
    return this.i18n.t(key).replace("{n}", String(n));
  }

  protected name(p: DailyQuestionPlayer): string {
    return formatPlayerName(p.name);
  }

  protected play(): void {
    this.busy.set(true);
    this.api.startDailyQuestion().subscribe({
      next: (s) => {
        this.busy.set(false);
        this.setState(s);
        if (s.today) this.openOverlay();
      },
      error: () => this.busy.set(false),
    });
  }

  protected openOverlay(): void {
    this.overlayOpen.set(true);
    if (this.deadline !== null) this.startTick();
  }

  // Closing never pauses anything: the server's clock keeps running, and so
  // does the poll that fetches the timeout result.
  protected closeOverlay(): void {
    this.overlayOpen.set(false);
    this.stopTick();
  }

  protected answer(choice: "a" | "b"): void {
    if (this.busy() || this.remaining() <= 0) return;
    this.busy.set(true);
    this.api.answerDailyQuestion(choice).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.setState(s);
      },
      error: () => {
        this.busy.set(false);
        this.refresh();
      },
    });
  }

  private setState(s: DailyQuestionState): void {
    this.state.set(s);
    this.stopPoll();
    const open = s.today && !s.today.result ? s.today.remainingMs ?? 0 : null;
    this.deadline = open === null ? null : Date.now() + open;
    if (this.deadline === null) {
      this.stopTick();
      return;
    }
    this.remaining.set(Math.max(0, this.deadline - Date.now()));
    this.poll = setTimeout(() => this.refresh(), Math.max(0, this.deadline - Date.now()) + RESULT_POLL_DELAY_MS);
    if (this.overlayOpen()) this.startTick();
  }

  private startTick(): void {
    this.stopTick();
    const step = () => {
      const left = this.deadline === null ? 0 : Math.max(0, this.deadline - Date.now());
      this.remaining.set(left);
      if (left === 0) this.stopTick();
    };
    step();
    if (this.remaining() > 0) this.tick = setInterval(step, 100);
  }

  private stopTick(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private stopPoll(): void {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }

  private refresh(): void {
    this.api.getDailyQuestion().subscribe({ next: (s) => this.setState(s), error: () => {} });
  }
}
