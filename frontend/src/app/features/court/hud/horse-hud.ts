import { Component, OnDestroy, OnInit, computed, inject, input, output, signal } from "@angular/core";
import { I18nService } from "../../../core/i18n.service";
import { HORSE_WORD } from "../../../../../../shared/court/horse";
import type { HorseView } from "../net/court-net";

export interface HorseHudPlayer {
  id: string;
  name: string;
  letters: string;
  eliminated: boolean;
  connected: boolean;
  isTurn: boolean;
  isMe: boolean;
}

export interface HorseWinner {
  name: string;
  standings: { name: string; letters: string; placement: number }[];
}

/** H-O-R-S-E overlay: start button, scoreboard, turn banner + countdown, winner screen. */
@Component({
  selector: "app-horse-hud",
  standalone: true,
  template: `
    @if (view().phase === "free") {
      @if (isStarter()) {
        <div class="pointer-events-none absolute inset-x-0 bottom-[calc(8.5rem+env(safe-area-inset-bottom))] flex justify-center sm:bottom-20">
          <button
            type="button"
            class="hh-start pointer-events-auto font-display"
            [disabled]="!canStart()"
            (click)="start.emit()"
          >
            {{ i18n.t("court.horse.start") }}
          </button>
        </div>
        @if (!canStart()) {
          <p class="hh-hint absolute inset-x-0 bottom-[calc(7rem+env(safe-area-inset-bottom))] text-center text-xs sm:bottom-14">
            {{ i18n.t("court.horse.needPlayers") }}
          </p>
        }
      }
    } @else {
      <div class="pointer-events-none absolute inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] flex flex-col items-center gap-2 px-16">
        <div class="hh-board">
          @for (p of players(); track p.id) {
            <div class="hh-row" [class.hh-turn]="p.isTurn" [class.hh-out]="p.eliminated" [class.hh-away]="!p.connected">
              <span class="hh-name">{{ p.isMe ? "★ " : "" }}{{ p.name }}</span>
              <span class="hh-letters font-display">
                @for (l of word; track $index) {
                  <span [class.hh-on]="$index < p.letters.length">{{ l }}</span>
                }
              </span>
            </div>
          }
        </div>
        @if (view().phase === "setting" || view().phase === "matching") {
          <div class="hh-banner" [class.hh-mine]="myTurn()">
            <span>{{ banner() }}</span>
            @if (secondsLeft() !== null) {
              <span class="hh-clock font-display" [class.hh-urgent]="(secondsLeft() ?? 99) <= 5">{{ secondsLeft() }}</span>
            }
          </div>
          @if (spectator()) {
            <p class="hh-hint text-xs">{{ i18n.t("court.horse.spectator") }}</p>
          } @else if (!meOut()) {
            <button type="button" class="hh-forfeit pointer-events-auto" (click)="forfeit.emit()">{{ i18n.t("court.horse.forfeit") }}</button>
          }
        }
      </div>
    }

    @if (winner(); as w) {
      <div class="hh-winner-wrap">
        <div class="hh-winner" role="dialog" [attr.aria-label]="i18n.t('court.horse.standings')">
          <p class="font-display text-3xl">{{ i18n.t("court.horse.wins").replace("{name}", w.name) }}</p>
          <p class="mt-3 text-xs uppercase tracking-wider opacity-70">{{ i18n.t("court.horse.standings") }}</p>
          <ol class="mt-2 space-y-1 text-left">
            @for (s of w.standings; track s.placement) {
              <li class="flex items-center justify-between gap-6">
                <span>{{ s.placement }}. {{ s.name }}</span>
                <span class="font-display tracking-widest text-[#ffc93c]">{{ s.letters || "–" }}</span>
              </li>
            }
          </ol>
        </div>
      </div>
    }
  `,
  styles: `
    :host { position: absolute; inset: 0; pointer-events: none; color: #fff; }
    .hh-start {
      border-radius: 9999px; padding: 0.7rem 1.4rem; font-size: 1.15rem; letter-spacing: 0.04em;
      background: #ffc93c; color: #1a1406; border: 2px solid rgba(255, 255, 255, 0.85);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .hh-start:disabled { opacity: 0.55; }
    .hh-hint { color: rgba(255, 255, 255, 0.85); text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7); }
    .hh-board {
      display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35rem;
      max-width: 100%;
    }
    .hh-row {
      display: flex; align-items: center; gap: 0.5rem; border-radius: 9999px; padding: 0.25rem 0.7rem;
      background: rgba(8, 12, 20, 0.6); border: 1px solid rgba(255, 255, 255, 0.14); font-size: 0.8rem;
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    }
    .hh-row.hh-turn { border-color: #ffc93c; box-shadow: 0 0 0 1px #ffc93c, 0 0 12px rgba(255, 201, 60, 0.5); }
    .hh-row.hh-out { opacity: 0.4; text-decoration: line-through; }
    .hh-row.hh-away { opacity: 0.6; }
    .hh-name { max-width: 7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .hh-letters span { margin-left: 1px; color: rgba(255, 255, 255, 0.25); }
    .hh-letters span.hh-on { color: #ff5a4f; }
    .hh-banner {
      display: flex; align-items: center; gap: 0.6rem; border-radius: 9999px; padding: 0.35rem 0.5rem 0.35rem 1rem;
      background: rgba(8, 12, 20, 0.65); font-size: 0.9rem; font-weight: 600; text-align: center;
    }
    .hh-banner.hh-mine { background: rgba(255, 201, 60, 0.92); color: #1a1406; }
    .hh-clock {
      display: inline-flex; align-items: center; justify-content: center; min-width: 2rem; height: 2rem;
      border-radius: 9999px; background: rgba(255, 255, 255, 0.18); font-size: 1.05rem;
    }
    .hh-clock.hh-urgent { background: #ff5a4f; color: #fff; }
    .hh-forfeit { font-size: 0.75rem; opacity: 0.75; text-decoration: underline; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7); }
    .hh-winner-wrap {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.45); pointer-events: auto;
    }
    .hh-winner {
      min-width: 16rem; max-width: 90vw; border-radius: 1.5rem; padding: 1.5rem 1.75rem; text-align: center;
      background: #121722; border: 1px solid rgba(255, 201, 60, 0.6); box-shadow: 0 0 40px rgba(255, 201, 60, 0.25);
    }
  `,
})
export class HorseHudComponent implements OnInit, OnDestroy {
  protected i18n = inject(I18nService);

  readonly view = input.required<HorseView>();
  readonly players = input.required<HorseHudPlayer[]>();
  readonly meId = input.required<string>();
  /** performance.now() timestamp when the current turn runs out. */
  readonly turnEndsAt = input<number | null>(null);
  readonly winner = input<HorseWinner | null>(null);
  readonly isStarter = input(false);
  readonly canStart = input(false);

  readonly start = output<void>();
  readonly forfeit = output<void>();

  protected readonly word = HORSE_WORD.split("");
  private readonly now = signal(performance.now());
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly turnPlayer = computed(() => this.players().find((p) => p.isTurn) ?? null);
  protected readonly myTurn = computed(() => this.turnPlayer()?.isMe ?? false);
  protected readonly spectator = computed(() => !this.view().order.includes(this.meId()));
  protected readonly meOut = computed(() => this.players().find((p) => p.isMe)?.eliminated ?? false);
  protected readonly secondsLeft = computed(() => {
    const end = this.turnEndsAt();
    return end === null ? null : Math.max(0, Math.ceil((end - this.now()) / 1000));
  });
  protected readonly banner = computed(() => {
    const phase = this.view().phase;
    const name = this.turnPlayer()?.name ?? "";
    if (this.myTurn()) return this.i18n.t(phase === "setting" ? "court.horse.yourSet" : "court.horse.yourMatch");
    return this.i18n.t(phase === "setting" ? "court.horse.setting" : "court.horse.matching").replace("{name}", name);
  });

  ngOnInit(): void {
    this.timer = setInterval(() => this.now.set(performance.now()), 250);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
