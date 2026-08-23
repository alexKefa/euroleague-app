import { Component, Input, OnChanges, SimpleChanges, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { CollectibleTier } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";

type HoloVariant = "gold" | "silver" | null;

interface TierStyle {
  frameBackground: string;
  frameShadow: string;
  faceBackground: string;
  badgeBackground: string;
  badgeTextColor: string;
  badgeLabel: string;
  nameColor: string;
  metaColor: string;
  photoTint: string;
  bannerBackground: string;
  holoVariant: HoloVariant;
}

const DEFAULT_TEAM_COLOR = "#3E7CB1";

/**
 * Renders a reward-store card. Tier art (frame foil, animated holo-sweep,
 * banner) is generated from tier + team color rather than sourced per
 * card — the player photo itself is the same across tiers, untouched;
 * differentiation is entirely in the surrounding effects.
 */
@Component({
  selector: "app-collectible-card",
  standalone: true,
  imports: [CommonModule, RetryImgDirective, LogoSpinnerComponent],
  templateUrl: "./collectible-card.html",
  styleUrl: "./collectible-card.css",
})
export class CollectibleCardComponent implements OnChanges {
  @Input({ required: true }) name!: string;
  @Input({ required: true }) tier!: CollectibleTier;
  @Input() teamCode = "";
  @Input() teamColor: string | null = null;
  @Input() imageUrl: string | null = null;
  @Input() unlocked = false;
  @Input() maxWidth = 220;
  @Input() selected = false;

  // The player photo can take a beat to arrive (pack reveals fire a burst
  // of these at once) — track load state so the template can show the logo
  // spinner over the tint background instead of a blank card until it pops in.
  readonly imageLoaded = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["imageUrl"] && !changes["imageUrl"].firstChange) {
      this.imageLoaded.set(false);
    }
  }
  // "042/208" print numbering — only rare/legendary get the corner badge
  // (mirrors the tier badge on the opposite corner); common cards stay as
  // they were. Optional since not every card-shaped API response carries
  // it (see models.ts's Collectible.serialNumber doc comment).
  @Input() serialNumber?: number;
  @Input() serialTotal?: number;

  get showSerial(): boolean {
    return (this.tier === "rare" || this.tier === "legendary") && this.serialNumber != null && this.serialTotal != null;
  }

  private shade(hex: string, factor: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return `rgb(${clamp(r * factor)}, ${clamp(g * factor)}, ${clamp(b * factor)})`;
  }

  get style(): TierStyle {
    const accent = this.teamColor ?? DEFAULT_TEAM_COLOR;
    const accentDark = this.shade(accent, 0.35);
    const accentDeep = this.shade(accent, 0.16);
    const accentSoft = this.shade(accent, 0.55);

    if (this.tier === "rare") {
      return {
        frameBackground:
          "linear-gradient(135deg, #cfd6dc 0%, #f5f7f9 25%, #aab2ba 50%, #f5f7f9 75%, #cfd6dc 100%)",
        frameShadow:
          "0 0 0 1px rgba(255,255,255,0.4) inset, 0 8px 20px rgba(20,26,32,0.3), 0 0 24px rgba(120,170,190,0.2)",
        faceBackground: `linear-gradient(160deg, ${accentDark} 0%, ${accentDeep} 55%, #0b0f0d 100%)`,
        badgeBackground: "linear-gradient(135deg, #b9c1c8 0%, #eef1f3 50%, #9aa3ab 100%)",
        badgeTextColor: "#1c2226",
        badgeLabel: "RARE",
        nameColor: "#F5F7F6",
        metaColor: "rgba(245,247,246,0.72)",
        photoTint: `linear-gradient(160deg, ${accentSoft} 0%, ${accentDeep} 100%)`,
        bannerBackground: "rgba(11,15,13,0.55)",
        holoVariant: "silver",
      };
    }

    if (this.tier === "legendary") {
      return {
        frameBackground:
          "linear-gradient(135deg, #7a5b12 0%, #f4d675 22%, #fff6d8 40%, #caa53a 58%, #fff2c9 76%, #6e4e10 100%)",
        frameShadow:
          "0 0 0 1px rgba(255,235,180,0.5) inset, 0 10px 26px rgba(0,0,0,0.45), 0 0 36px rgba(230,180,60,0.4)",
        faceBackground: `radial-gradient(120% 90% at 50% 0%, ${accentDark} 0%, #05070a 60%)`,
        badgeBackground: "linear-gradient(135deg, #9c7415 0%, #f7dd85 30%, #fffbe8 50%, #e0ac36 70%, #855f10 100%)",
        badgeTextColor: "#241804",
        badgeLabel: "LEGENDARY",
        nameColor: "#FFF7E0",
        metaColor: "rgba(255,247,224,0.75)",
        photoTint: `radial-gradient(120% 100% at 50% 10%, ${accentSoft} 0%, #05070a 70%)`,
        bannerBackground: "rgba(5,7,10,0.55)",
        holoVariant: "gold",
      };
    }

    return {
      frameBackground: accent,
      frameShadow: "0 4px 12px rgba(0,0,0,0.15)",
      faceBackground: "#FBFDFC",
      badgeBackground: "#E7E9EC",
      badgeTextColor: "#5B6169",
      badgeLabel: "COMMON",
      nameColor: "#14161A",
      metaColor: "#5B6169",
      photoTint: "linear-gradient(160deg, #EEF3F0 0%, #E2E9E4 100%)",
      bannerBackground: "rgba(255,255,255,0.68)",
      holoVariant: null,
    };
  }
}
