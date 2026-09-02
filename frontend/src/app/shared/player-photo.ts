import { Component, Input, computed, signal } from "@angular/core";
import { RetryImgDirective } from "./retry-img.directive";
import { displayTeamCode } from "./team-display-code";

// Standalone jersey-silhouette placeholder for a player headshot — same
// "fall back instead of a broken image" spirit as TeamBadgeComponent, used
// everywhere player.photoUrl renders (player detail, game-detail top
// performers, player compare). v3 (2026-09-02, after user feedback on a
// flat full-bleed square v2 modeled directly on EuroLeague Fantasy's own
// tiles — disliked for being flat/plain, wrong corners, and off font/size):
// back to a circular badge with real depth (a two-color diagonal gradient
// plus a soft radial sheen, not a single flat fill), a translucent jersey
// watermark for texture, and the number in a mono font (matches real
// jersey numbering better than a display face). Falls back through
// jerseyNumber -> teamCode -> first initial of name, so it degrades
// gracefully even for a roster with neither a synced photo nor a jersey
// number yet (e.g. a freshly imported season before every squad is fully
// synced — see the Besiktas/thin-roster gap noted in CLAUDE.md). Colored
// from the player's own team (primaryColor/secondaryColor) when given,
// otherwise from the app's own --accent-primary/--accent-secondary reskin
// variables, so an unphotographed player still reads as "this app, this
// team" rather than a generic gray box.
@Component({
  selector: "app-player-photo",
  standalone: true,
  imports: [RetryImgDirective],
  template: `
    <span
      class="inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 relative"
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
        <span class="absolute inset-0" [style.background]="gradient()"></span>
        <span class="absolute inset-0" style="background: radial-gradient(circle at 32% 22%, rgba(255,255,255,0.32), transparent 58%)"></span>
        <svg viewBox="0 0 64 64" class="absolute w-[68%] h-[68%]" aria-hidden="true">
          <path
            d="M24,6 L32,15 L40,6 L48,8 L53,22 L43,22 L43,58 L21,58 L21,22 L11,22 L16,8 Z"
            fill="#fff"
            fill-opacity="0.16"
          />
        </svg>
        <span class="relative flex flex-col items-center leading-none" [style.color]="numberColor()">
          @if (hasNumber() && teamCode) {
            <span class="font-mono font-bold tracking-wide opacity-75" [style.font-size.px]="codeSize()">{{ displayCode() }}</span>
          }
          <span class="font-mono font-extrabold tracking-tight" [style.font-size.px]="labelSize()" style="text-shadow: 0 1px 2px rgba(0,0,0,0.3)">{{
            label()
          }}</span>
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

  protected gradient = computed(() => {
    const from = this.primaryColor ?? "var(--accent-primary)";
    const to = this.secondaryColor ?? "var(--accent-secondary)";
    return `linear-gradient(150deg, ${from} 0%, ${to} 145%)`;
  });

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
  protected displayCode = computed(() => displayTeamCode(this.teamCode));

  protected label = computed(() => {
    if (this.hasNumber()) return String(this.jerseyNumber);
    if (this.teamCode) return this.displayCode();
    return this.name?.trim().charAt(0).toUpperCase() ?? "?";
  });

  protected labelSize = computed(() => Math.round(this.size * (this.hasNumber() ? 0.36 : 0.3)));
  protected codeSize = computed(() => Math.round(this.size * 0.13));
}
