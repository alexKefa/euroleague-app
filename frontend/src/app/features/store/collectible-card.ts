import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { CollectibleFinish, CollectibleTier } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { displayTeamCode } from "../../shared/team-display-code";

type HoloVariant = "gold" | "silver" | "violet" | null;

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
  // Color for the no-image fallback's jersey silhouette + collar accent —
  // needs to contrast with photoTint, which varies a lot more per tier
  // than a single fixed white ever could (a pale common-tier tint needs a
  // dark icon, a dark rare/legendary tint needs a light one).
  iconColor: string;
  iconAccent: string;
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
  // Every input here is a primitive the parent @for loop only ever
  // reassigns when the underlying card actually changes — so OnPush lets
  // Angular skip re-checking already-rendered cards on unrelated updates
  // elsewhere in the page (e.g. every keystroke in the Store search box
  // triggers a global change-detection pass by default). Without it, every
  // mounted card recomputed `style` (see below) on every such pass, which
  // was the actual source of the input lag, not the search box itself.
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  // Cosmetic-only, legendary-only — see CollectibleFinish's doc comment.
  @Input() finish: CollectibleFinish = "standard";

  get isFoil(): boolean {
    return this.tier === "legendary" && this.finish === "foil";
  }

  get displayTeamCode(): string {
    return displayTeamCode(this.teamCode);
  }

  // The player photo can take a beat to arrive (pack reveals fire a burst
  // of these at once) — track load state so the template can show the logo
  // spinner over the tint background instead of a blank card until it pops in.
  readonly imageLoaded = signal(false);

  // Computed once per actual input change instead of on every template
  // read — see the OnPush comment above for why a plain getter here was
  // the real cost. ngOnChanges only fires when a bound @Input value
  // actually differs from its previous one, so this is naturally as
  // infrequent as the card's real content changing, not per keystroke.
  style!: TierStyle;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["imageUrl"] && !changes["imageUrl"].firstChange) {
      this.imageLoaded.set(false);
    }
    this.style = this.computeStyle();
  }
  // "042/208" print numbering — only rare/legendary get the corner badge
  // (mirrors the tier badge on the opposite corner); common cards stay as
  // they were. Optional since not every card-shaped API response carries
  // it (see models.ts's Collectible.serialNumber doc comment).
  @Input() serialNumber?: number;
  @Input() serialTotal?: number;

  get showSerial(): boolean {
    return (
      (this.tier === "rare" || this.tier === "legendary" || this.tier === "coach") &&
      this.serialNumber != null &&
      this.serialTotal != null
    );
  }

  private shade(hex: string, factor: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return `rgb(${clamp(r * factor)}, ${clamp(g * factor)}, ${clamp(b * factor)})`;
  }

  // Blends a team color toward white — used for the common tier's photo
  // background, which otherwise (see the fixed getUserPoints... no, see
  // `style` below) used to be a flat neutral gray regardless of team,
  // the main reason "cards have no team color" for the ~half of the
  // catalog that's common tier.
  private tint(hex: string, amount: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    const mix = (c: number) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }

  private computeStyle(): TierStyle {
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
        iconColor: "#fff",
        iconAccent: "#fff",
      };
    }

    // Coach cards (2026-09-03) deliberately don't extend the common/rare/
    // legendary rarity ladder — a coach isn't "rarer" or "less rare" than a
    // player card, it's a different kind of card entirely, so this gets its
    // own violet identity rather than reusing gold/silver at any position.
    // Built around #603FEF — a vivid indigo/violet, distinct from every
    // other tier's hue at a glance. Same 6-stop dark→bright→pale→mid→
    // pale→dark shape as gold/legendary, just walked along this hue instead.
    if (this.tier === "coach") {
      return {
        frameBackground:
          "linear-gradient(135deg, #150c33 0%, #603FEF 22%, #EDE9FF 40%, #4526B0 58%, #DAD3FF 76%, #0D0824 100%)",
        frameShadow:
          "0 0 0 1px rgba(220,210,255,0.5) inset, 0 10px 26px rgba(0,0,0,0.45), 0 0 36px rgba(96,63,239,0.45)",
        faceBackground: `radial-gradient(120% 90% at 50% 0%, ${accentDark} 0%, #05070a 60%)`,
        badgeBackground: "linear-gradient(135deg, #2A1B70 0%, #603FEF 30%, #EDE9FF 50%, #4526B0 70%, #170F42 100%)",
        badgeTextColor: "#140B36",
        badgeLabel: "COACH",
        nameColor: "#EDE9FF",
        metaColor: "rgba(237,233,255,0.75)",
        photoTint: `radial-gradient(120% 100% at 50% 10%, ${accentSoft} 0%, #05070a 70%)`,
        bannerBackground: "rgba(5,7,10,0.55)",
        holoVariant: "violet",
        iconColor: "#fff",
        iconAccent: "#fff",
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
        iconColor: "#fff",
        iconAccent: "#fff",
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
      // Pale team-color wash, not a flat neutral gray — commons are ~half
      // the catalog, so a fixed gray here meant roughly half the Store had
      // no team color on it at all (2026-09-02 fix).
      photoTint: `linear-gradient(160deg, ${this.tint(accent, 0.72)} 0%, ${this.tint(accent, 0.5)} 100%)`,
      bannerBackground: "rgba(255,255,255,0.68)",
      holoVariant: null,
      iconColor: this.shade(accent, 0.55),
      iconAccent: this.shade(accent, 0.3),
    };
  }
}
