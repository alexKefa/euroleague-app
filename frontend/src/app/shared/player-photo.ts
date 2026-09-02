import { Component, Input, computed, signal } from "@angular/core";
import { RetryImgDirective } from "./retry-img.directive";

// Standalone jersey-silhouette placeholder for a player headshot — same
// "fall back instead of a broken image" spirit as TeamBadgeComponent, used
// everywhere player.photoUrl renders (player detail, game-detail top
// performers, player compare). Styled after EuroLeague Fantasy's own player
// tiles (2026-09-02 redesign): a flat, team-colored jersey graphic on a
// neutral tile, jersey number printed on the chest and the team code
// captioned above it, rather than a translucent icon over a soft gradient.
// Falls back through jerseyNumber -> teamCode -> first initial of name, so
// it degrades gracefully even for a roster with neither a synced photo nor
// a jersey number yet (e.g. a freshly imported season before every squad is
// fully synced — see the Besiktas/thin-roster gap noted in CLAUDE.md).
// Colored from the player's own team (primaryColor/secondaryColor) when
// given, otherwise from the app's own --accent-primary/--accent-secondary
// reskin variables, so an unphotographed player still reads as "this app,
// this team" rather than a generic gray box.
@Component({
  selector: "app-player-photo",
  standalone: true,
  imports: [RetryImgDirective],
  template: `
    <span
      class="inline-flex items-center justify-center rounded-xl overflow-hidden shrink-0 relative bg-page"
      [style.width.px]="size"
      [style.height.px]="size"
    >
      @if (photoUrl && !failed()) {
        <img
          [src]="photoUrl"
          [alt]="name"
          loading="lazy"
          decoding="async"
          appRetryImg
          (error)="failed.set(true)"
          class="w-full h-full object-cover"
        />
      } @else {
        <span class="absolute inset-0 flex items-center justify-center">
          <svg viewBox="0 0 64 64" class="absolute w-[82%] h-[82%]" aria-hidden="true">
            <path
              d="M22,6 L32,17 L42,6 L50,14 L54,24 L47,21 L47,58 L17,58 L17,21 L10,24 L14,14 Z"
              [attr.fill]="jerseyColor()"
            />
            <path
              d="M22,6 L32,17 L42,6"
              fill="none"
              [attr.stroke]="trimColor()"
              stroke-width="2.5"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
          <span class="relative flex flex-col items-center leading-none" [style.color]="numberColor()">
            @if (hasNumber() && teamCode) {
              <span class="font-mono font-bold tracking-wide opacity-80" [style.font-size.px]="codeSize()">{{ teamCode }}</span>
            }
            <span class="font-display font-bold tracking-wide" [style.font-size.px]="labelSize()">{{ label() }}</span>
          </span>
        </span>
      }
    </span>
  `,
})
export class PlayerPhotoComponent {
  @Input() photoUrl: string | null = null;
  @Input({ required: true }) name!: string;
  @Input() jerseyNumber: number | null = null;
  @Input() teamCode: string | null = null;
  @Input() primaryColor: string | null = null;
  @Input() secondaryColor: string | null = null;
  @Input() size = 48;

  protected failed = signal(false);

  protected jerseyColor = computed(() => this.primaryColor ?? "var(--accent-primary)");
  protected trimColor = computed(() => this.secondaryColor ?? "rgba(255,255,255,0.65)");

  // White text reads fine on nearly every EuroLeague team color, but a few
  // (e.g. a pale gold/yellow) are too light for it — fall back to a dark
  // ink color for those rather than hardcoding white.
  protected numberColor = computed(() => {
    const hex = this.primaryColor;
    if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "#fff";
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.6 ? "#14161A" : "#fff";
  });

  protected hasNumber = computed(() => this.jerseyNumber !== null && this.jerseyNumber !== undefined);

  protected label = computed(() => {
    if (this.hasNumber()) return String(this.jerseyNumber);
    if (this.teamCode) return this.teamCode;
    return this.name?.trim().charAt(0).toUpperCase() ?? "?";
  });

  protected labelSize = computed(() => Math.round(this.size * (this.hasNumber() ? 0.34 : 0.3)));
  protected codeSize = computed(() => Math.round(this.size * 0.13));
}
