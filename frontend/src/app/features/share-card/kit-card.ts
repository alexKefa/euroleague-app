import { Component, ElementRef, ViewChild, computed, input, signal } from "@angular/core";
import { STAT_LABELS, StatKey, StatLine, formatValue, winner } from "./share-card.logic";

export interface KitPlayer {
  first: string;
  last: string;
  jersey: number | null;
  teamCode: string;
  primary: string;
  secondary: string;
  photoUrl: string | null;
  line: StatLine;
}

/** "#rrggbb" + alpha -> rgba(); computed here so the exported PNG never depends on color-mix support. */
function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * The "Kit" share card (2026-10-07): always rendered at the real export size
 * (1080×1350 post, 1080×1920 story) with inline pixel styles, so the PNG
 * looks the same whatever screen made it. The page scales it down for the
 * preview. Player mode = one player's line; h2h = two players split down the
 * middle, the better value on each line underlined.
 */
@Component({
  selector: "app-kit-card",
  standalone: true,
  template: `
    <div
      #card
      [style.width.px]="1080"
      [style.height.px]="height()"
      style="position: relative; overflow: hidden; font-family: 'Sofia Sans', system-ui, sans-serif;"
      [style.background]="mode() === 'player' ? a().primary : 'transparent'"
      [style.color]="a().secondary"
    >
      @if (mode() === "player") {
        <div [style.top.px]="story() ? 60 : -60" style="position: absolute; right: -40px; font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 900; font-size: 756px; line-height: 1; opacity: 0.12;">
          {{ a().jersey ?? a().teamCode }}
        </div>
        @if (a().photoUrl && !photoFailed()[0]) {
          <img
            [src]="a().photoUrl"
            crossorigin="anonymous"
            alt=""
            (error)="markFailed(0)"
            [style.top.px]="story() ? 430 : 86"
            [style.width.px]="story() ? 970 : 690"
            [style.height.px]="story() ? 1080 : 780"
            [style.right.px]="story() ? -100 : 0"
            style="position: absolute; object-fit: cover; object-position: top center; -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent); mask-image: linear-gradient(to bottom, #000 70%, transparent);"
          />
        }
        <div [style.top.px]="story() ? 150 : 76" style="position: absolute; left: 65px; max-width: 620px; display: flex; flex-direction: column; gap: 10px;">
          @if (a().first) {
            <span style="font-size: 48px; font-weight: 600; opacity: 0.85;">{{ a().first }}</span>
          }
          <span style="font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 900; font-size: 140px; line-height: 0.85; text-transform: uppercase; overflow-wrap: anywhere;">{{ a().last }}</span>
          <span [style.background]="tint(a().secondary, 0.16)" style="margin-top: 22px; align-self: flex-start; font-size: 36px; font-weight: 600; border-radius: 999px; padding: 9px 28px;">{{ periodLabel() }}</span>
        </div>
        <div
          [style.bottom.px]="story() ? 195 : 140"
          [style.background]="tint(a().secondary, 0.14)"
          [style.gridTemplateColumns]="'repeat(' + stats().length + ', 1fr)'"
          style="position: absolute; left: 0; right: 0; display: grid; padding: 43px 43px;"
        >
          @for (key of stats(); track key; let first = $first) {
            <div [style.borderLeft]="first ? 'none' : '2px solid ' + tint(a().secondary, 0.25)" style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
              <span [style.fontSize.px]="stats().length > 4 ? 100 : 119" style="font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 850; line-height: 0.9; font-variant-numeric: tabular-nums;">{{ value(a(), key) }}</span>
              <span style="font-size: 35px; font-weight: 600; letter-spacing: 0.04em; opacity: 0.8;">{{ label(key) }}</span>
            </div>
          }
        </div>
        <div style="position: absolute; left: 65px; right: 65px; bottom: 49px; display: flex; justify-content: space-between; align-items: center; font-size: 37px; font-weight: 600;">
          <span style="font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 850; font-size: 54px;">Clutch<span [style.background]="a().secondary" style="display: inline-block; width: 14px; height: 14px; border-radius: 99px; margin-left: 5px;"></span></span>
          <span>getclutchapp.com</span>
        </div>
      } @else {
        <div [style.background]="a().primary" style="position: absolute; top: 0; bottom: 0; left: 0; width: 540px;"></div>
        <div [style.background]="b().primary" style="position: absolute; top: 0; bottom: 0; right: 0; width: 540px;"></div>
        <div style="position: absolute; top: 0; bottom: 0; left: 538px; width: 4px; background: rgba(255,255,255,0.35);"></div>

        <div [style.top.px]="story() ? 150 : 65" style="position: absolute; left: 54px; right: 54px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 22px;">
          <div [style.color]="a().secondary">
            <div style="font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 850; font-size: 80px; line-height: 0.95; overflow-wrap: anywhere;">{{ a().last }}</div>
            <div style="font-size: 35px; font-weight: 600; opacity: 0.8; margin-top: 6px;">{{ a().teamCode }}</div>
          </div>
          <div style="font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 900; font-size: 54px; color: #fff; background: rgba(0,0,0,0.45); border-radius: 999px; padding: 10px 24px;">VS</div>
          <div [style.color]="b().secondary" style="text-align: right;">
            <div style="font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 850; font-size: 80px; line-height: 0.95; overflow-wrap: anywhere;">{{ b().last }}</div>
            <div style="font-size: 35px; font-weight: 600; opacity: 0.8; margin-top: 6px;">{{ b().teamCode }}</div>
          </div>
        </div>

        <div [style.top.px]="story() ? 520 : 330" [style.bottom.px]="story() ? 260 : 170" style="position: absolute; left: 54px; right: 54px; display: flex; flex-direction: column; justify-content: space-evenly;">
          @for (key of stats(); track key) {
            <div style="display: grid; grid-template-columns: 1fr 170px 1fr; align-items: center;">
              <span [style.color]="a().secondary" style="justify-self: start; position: relative; font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 850; font-size: 108px; line-height: 0.9; font-variant-numeric: tabular-nums;">
                {{ value(a(), key) }}
                @if (win(key) === "a") {
                  <span [style.background]="a().secondary" style="position: absolute; left: 0; width: 60%; bottom: -14px; height: 10px; border-radius: 9px;"></span>
                }
              </span>
              <span style="justify-self: center; font-size: 34px; font-weight: 600; letter-spacing: 0.04em; color: #fff; background: rgba(0,0,0,0.45); border-radius: 999px; padding: 6px 18px;">{{ label(key) }}</span>
              <span [style.color]="b().secondary" style="justify-self: end; position: relative; font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 850; font-size: 108px; line-height: 0.9; font-variant-numeric: tabular-nums;">
                {{ value(b(), key) }}
                @if (win(key) === "b") {
                  <span [style.background]="b().secondary" style="position: absolute; right: 0; width: 60%; bottom: -14px; height: 10px; border-radius: 9px;"></span>
                }
              </span>
            </div>
          }
        </div>

        <div style="position: absolute; left: 54px; right: 54px; bottom: 49px; display: flex; justify-content: space-between; align-items: center; font-size: 37px; font-weight: 600;">
          <span [style.color]="a().secondary" style="font-family: 'Sofia Sans Condensed', sans-serif; font-weight: 850; font-size: 54px;">Clutch</span>
          <span [style.color]="b().secondary">{{ periodLabel() }}</span>
        </div>
      }
    </div>
  `,
})
export class KitCardComponent {
  readonly size = input<"post" | "story">("post");
  readonly mode = input<"player" | "h2h">("player");
  readonly players = input.required<KitPlayer[]>();
  readonly stats = input.required<StatKey[]>();
  readonly periodLabel = input<string>("");

  @ViewChild("card", { static: true }) cardEl!: ElementRef<HTMLDivElement>;

  protected readonly story = computed(() => this.size() === "story");
  protected readonly height = computed(() => (this.story() ? 1920 : 1350));
  protected readonly a = computed(() => this.players()[0]);
  protected readonly b = computed(() => this.players()[1] ?? this.players()[0]);
  protected readonly photoFailed = signal<boolean[]>([false, false]);

  protected markFailed(i: number): void {
    this.photoFailed.update((f) => f.map((v, j) => (j === i ? true : v)));
  }

  protected tint(hex: string, alpha: number): string {
    return rgba(hex, alpha);
  }

  protected label(key: StatKey): string {
    return STAT_LABELS[key];
  }

  protected value(p: KitPlayer, key: StatKey): string {
    return formatValue(key, p.line.values[key], p.line.single);
  }

  protected win(key: StatKey): "a" | "b" | null {
    return winner(key, this.a().line.values[key], this.b().line.values[key]);
  }
}
