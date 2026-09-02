import { Component, Input, computed, signal } from "@angular/core";
import { RetryImgDirective } from "./retry-img.directive";

// Standalone jersey-silhouette placeholder for a player headshot — same
// "fall back instead of a broken image" spirit as TeamBadgeComponent, used
// everywhere player.photoUrl renders (player detail, game-detail top
// performers, player compare). Falls back through jerseyNumber -> teamCode
// -> first initial of name, so it degrades gracefully even for a roster
// with neither a synced photo nor a jersey number yet (e.g. a freshly
// imported season before every squad is fully synced — see the Besiktas/
// thin-roster gap noted in CLAUDE.md). Colored from the player's own team
// (primaryColor/secondaryColor) when given, otherwise from the app's own
// --accent-primary/--accent-secondary reskin variables, so an unphotographed
// player still reads as "this app, this team" rather than a generic gray box.
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
        <span class="absolute inset-0 flex items-center justify-center" [style.background]="gradient()">
          <svg viewBox="0 0 64 64" class="absolute inset-0 w-full h-full" aria-hidden="true">
            <path
              d="M22,6 L32,17 L42,6 L50,14 L54,24 L47,21 L47,58 L17,58 L17,21 L10,24 L14,14 Z"
              fill="#fff"
              [attr.fill-opacity]="0.22"
            />
          </svg>
          <span
            class="relative font-display font-bold text-white leading-none tracking-wide"
            [style.font-size.px]="labelSize()"
            [style.text-shadow]="'0 1px 2px rgba(0,0,0,0.35)'"
          >
            {{ label() }}
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

  protected gradient = computed(() => {
    const from = this.primaryColor ?? "var(--accent-primary)";
    const to = this.secondaryColor ?? "var(--accent-secondary)";
    return `linear-gradient(155deg, ${from} 0%, ${to} 120%)`;
  });

  protected label = computed(() => {
    if (this.jerseyNumber !== null && this.jerseyNumber !== undefined) return String(this.jerseyNumber);
    if (this.teamCode) return this.teamCode;
    return this.name?.trim().charAt(0).toUpperCase() ?? "?";
  });

  protected labelSize = computed(() => {
    const hasNumber = this.jerseyNumber !== null && this.jerseyNumber !== undefined;
    return Math.round(this.size * (hasNumber ? 0.4 : 0.32));
  });
}
