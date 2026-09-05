import { Component, Input, computed, signal } from "@angular/core";
import { RetryImgDirective } from "./retry-img.directive";
import { displayTeamCode } from "./team-display-code";

// Standalone jersey-silhouette placeholder for a player headshot — same
// "fall back instead of a broken image" spirit as TeamBadgeComponent, used
// everywhere player.photoUrl renders (player detail, game-detail top
// performers, player compare, Fantasy Five). v5 (2026-09-05): after v4's
// deep-V read as ambiguous to the user, iterated in a design-review
// Artifact (several original front-facing silhouettes + finish treatments,
// shown across real team colorways) rather than guessing blind again —
// landed on "scoop neck, solid + collar trim" (the artifact's option D):
// a shallow, rounded front dip (the dip itself, not a back's straight
// neckline, is what reads as "front"), a solid team-primaryColor body, and
// a single secondaryColor collar trim stroke — no armhole trim, no side
// panel, no pattern (a diagonal-stripe pass was tried and explicitly
// dropped earlier). Same sheen gradient + soft collar shadow as v4 for a
// little real depth. Silhouette viewBox is taller than wide (100x120, a
// torso proportion) rendered with `preserveAspectRatio="slice"` so it fills
// the circular frame like a cropped photo would, rather than being
// squashed to fit a square viewBox. Falls back through jerseyNumber ->
// teamCode -> first initial of name exactly as before, colored from the
// player's own team when given, otherwise the app's own reskin variables.
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
        <span class="absolute inset-0" [style.background]="backdrop()"></span>
        <svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMid slice" class="absolute inset-0 w-full h-full" aria-hidden="true">
          <defs>
            <linearGradient [attr.id]="sheenId" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity="0.38" />
              <stop offset="0.4" stop-color="#fff" stop-opacity="0" />
              <stop offset="1" stop-color="#000" stop-opacity="0.3" />
            </linearGradient>
            <radialGradient [attr.id]="neckId" cx="0.5" cy="0.16" r="0.14">
              <stop offset="0" stop-color="#000" stop-opacity="0.5" />
              <stop offset="1" stop-color="#000" stop-opacity="0" />
            </radialGradient>
            <clipPath [attr.id]="clipId">
              <path [attr.d]="jerseyPath" />
            </clipPath>
          </defs>
          <g [attr.clip-path]="'url(#' + clipId + ')'">
            <rect x="0" y="0" width="100" height="120" [style.fill]="primary()" />
            <rect x="0" y="0" width="100" height="120" [attr.fill]="'url(#' + sheenId + ')'" />
            <ellipse cx="50" cy="16" rx="16" ry="6" [attr.fill]="'url(#' + neckId + ')'" />
          </g>
          <path [attr.d]="jerseyPath" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2" stroke-linejoin="round" />
          <path [attr.d]="collarTrimPath" fill="none" [style.stroke]="secondary()" stroke-width="3" stroke-linecap="round" />
        </svg>
        <span class="relative flex flex-col items-center leading-none" [style.color]="numberColor()">
          @if (hasNumber() && teamCode) {
            <span class="font-mono font-bold tracking-wide opacity-80" [style.font-size.px]="codeSize()" style="text-shadow: 0 1px 2px rgba(0,0,0,0.4)">{{ displayCode() }}</span>
          }
          <span class="font-mono font-extrabold tracking-tight" [style.font-size.px]="labelSize()" style="text-shadow: 0 1px 3px rgba(0,0,0,0.45)">{{
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

  // Original silhouette (not traced from any third-party jersey artwork) —
  // a shallow scoop-neck dip (dips at center, unlike a back neckline),
  // flared shoulder straps, deep concave armholes, straight body sides.
  // Also used as the stroke outline and the SVG clip path, so it's defined
  // once rather than duplicated. Kept in sync by hand with
  // features/store/collectible-card.html's matching fallback.
  protected readonly jerseyPath =
    "M24,6 Q50,17 76,6 Q88,8 87,15 Q74,19 70,44 L74,113 L26,113 L30,44 Q26,19 13,15 Q12,8 24,6 Z";
  protected readonly collarTrimPath = "M24,6 Q50,17 76,6";

  // Unique per instance so two placeholders on the same page don't fight
  // over one <linearGradient>/<radialGradient>/<clipPath> id — same
  // reasoning as shot-chart.ts's photoClipId.
  private readonly instanceId = Math.random().toString(36).slice(2);
  protected readonly sheenId = "player-photo-sheen-" + this.instanceId;
  protected readonly neckId = "player-photo-neck-" + this.instanceId;
  protected readonly clipId = "player-photo-clip-" + this.instanceId;

  protected primary = computed(() => this.primaryColor ?? "var(--accent-primary)");
  protected secondary = computed(() => this.secondaryColor ?? "var(--accent-secondary)");

  // Behind the jersey (visible only at its clipped-away corners/edges
  // inside the circular frame) — same two-color diagonal wash the old
  // gradient fallback used, so an unphotographed player still reads as
  // "this team" even in the gaps around the jersey silhouette.
  protected backdrop = computed(() => `linear-gradient(150deg, ${this.primary()} 0%, ${this.secondary()} 145%)`);

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

  protected labelSize = computed(() => Math.round(this.size * (this.hasNumber() ? 0.34 : 0.28)));
  protected codeSize = computed(() => Math.round(this.size * 0.12));
}
