import { Component, computed, inject, input } from "@angular/core";
import { PackType } from "../core/models";
import { I18nService } from "../core/i18n.service";

type PackArtTier = "starter" | "pro" | "elite" | "coach";

const TIER_BY_TYPE: Record<PackType, PackArtTier> = {
  starter: "starter",
  pro: "pro",
  elite: "elite",
  wheelStarter: "starter",
  wheelPro: "pro",
  wheelLegendary: "elite",
  wheelCoach: "coach",
  qrBonus: "elite",
  welcomeBonus: "elite",
  referralBonus: "elite",
};

// Printed name on the pack face. The stage name (Regular Season / Playoffs /
// Final Four) by tier, except the one-off grants, which say what they are.
const NAME_KEY_BY_TYPE: Partial<Record<PackType, string>> = {
  wheelLegendary: "packs.artName.legendary",
  wheelCoach: "packs.artName.coach",
  qrBonus: "packs.artName.bonus",
  referralBonus: "packs.artName.bonus",
  welcomeBonus: "packs.artName.welcome",
};

const SET_CODE: Record<PackArtTier, string> = { starter: "RS", pro: "PO", elite: "F4", coach: "HC" };

// Cards per pack (mirrors backend services/packs.ts's slot counts).
const CARD_COUNT: Record<PackType, number> = {
  starter: 4,
  pro: 4,
  elite: 5,
  wheelStarter: 8,
  wheelPro: 6,
  wheelLegendary: 1,
  wheelCoach: 1,
  qrBonus: 5,
  welcomeBonus: 5,
  referralBonus: 5,
};

/**
 * Foil booster-pack art (2026-09-30 redesign, "packs too plain"): a dark
 * tier-tinted body with crimped heat seals top and bottom, faint half-court
 * lines, a holo sheen, the Clutch mark in a glowing center-circle medallion,
 * and the stage name in the tier's metal. Fills its parent's width; all
 * text scales with it (container query units), so the same art works at
 * 84px in a Packs tile and 140px in the Jump Ball win reveal.
 *
 * One shared component so the Packs page and the wheel stop keeping two
 * copies of the pack CSS.
 */
@Component({
  selector: "app-pack-art",
  standalone: true,
  template: `
    <div class="pa" [class]="'pa--' + tier()" [class.pa--interactive]="interactive()">
      <div class="pa-body">
        <div class="pa-holo"></div>
        <svg class="pa-court" viewBox="0 0 100 160" fill="none" aria-hidden="true">
          <circle cx="50" cy="72" r="19" />
          <circle cx="50" cy="72" r="6" />
          <path d="M0 72 H100" />
          <path d="M8 160 V132 A42 42 0 0 1 92 132 V160" />
          <path d="M34 160 V128 H66 V160" />
        </svg>
        <div class="pa-crimp pa-crimp--top"></div>
        <div class="pa-crimp pa-crimp--bottom"></div>

        <div class="pa-head">
          <span>CLUTCH</span>
          <span>{{ setCode() }}</span>
        </div>
        <div class="pa-medal">
          <img src="/clutch-icon-dark.png" alt="" />
        </div>
        <div class="pa-name">{{ name() }}</div>
        <div class="pa-count">{{ cardCount() }} {{ i18n.t(cardCount() === 1 ? 'packs.artCard' : 'packs.artCards') }}</div>

        @if (tier() === 'elite' || tier() === 'coach') {
          <span class="pa-spark" style="top: 20%; left: 14%"></span>
          <span class="pa-spark" style="top: 34%; right: 12%; animation-delay: 0.7s"></span>
          <span class="pa-spark" style="top: 58%; left: 10%; animation-delay: 1.3s"></span>
        }
        <div class="pa-shine"></div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }

    /* Tier palette: --body is the dark pack film, --metal the tier's foil
       (same metals as the card frames), --glow its accent light. */
    .pa--starter {
      --body: linear-gradient(160deg, #3b2414 0%, #1e120a 55%, #4a2d17 100%);
      --metal: linear-gradient(135deg, #8a5a34 0%, #f0b67a 30%, #6b3f22 60%, #e2a468 100%);
      --glow: #e59a52;
    }
    .pa--pro {
      --body: linear-gradient(160deg, #26313d 0%, #121921 55%, #2f3c4a 100%);
      --metal: linear-gradient(135deg, #aab2ba 0%, #ffffff 28%, #8d98a3 55%, #eef2f5 80%, #b9c1c8 100%);
      --glow: #bcd6ee;
    }
    .pa--elite {
      --body: linear-gradient(160deg, #3a2a06 0%, #150f02 55%, #4a3608 100%);
      --metal: linear-gradient(135deg, #a07818 0%, #fff0b0 25%, #d4a936 50%, #fff6d8 72%, #b88a1e 100%);
      --glow: #f5c043;
    }
    .pa--coach {
      --body: linear-gradient(160deg, #24145a 0%, #0d0824 55%, #34208a 100%);
      --metal: linear-gradient(135deg, #7b5cff 0%, #ede9ff 30%, #603fef 55%, #dad3ff 80%, #8f76ff 100%);
      --glow: #9b86ff;
    }

    .pa {
      aspect-ratio: 2 / 3.2;
      transform: perspective(900px) rotateY(-9deg) rotateX(3deg);
      filter: drop-shadow(6px 14px 14px rgba(0, 0, 0, 0.45)) drop-shadow(0 0 18px color-mix(in srgb, var(--glow) 22%, transparent));
      transition: transform 0.25s ease, filter 0.25s ease;
    }
    .pa--interactive:hover {
      transform: perspective(900px) rotateY(-3deg) rotateX(1deg) scale(1.04);
      filter: drop-shadow(4px 10px 12px rgba(0, 0, 0, 0.5)) drop-shadow(0 0 24px color-mix(in srgb, var(--glow) 40%, transparent));
    }
    .pa--interactive:active {
      transform: perspective(900px) rotateY(-5deg) rotateX(2deg) scale(0.97);
    }

    /* Crimped (zigzag) top and bottom edges, like a heat-sealed foil pack. */
    .pa-body {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--body);
      border-radius: 3px;
      --zz: 4cqw;
      -webkit-mask:
        conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) top / calc(2 * var(--zz)) 51% repeat-x,
        conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) bottom / calc(2 * var(--zz)) 51% repeat-x;
      mask:
        conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) top / calc(2 * var(--zz)) 51% repeat-x,
        conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) bottom / calc(2 * var(--zz)) 51% repeat-x;
      box-shadow:
        inset 0 0 0 1.5px color-mix(in srgb, var(--glow) 45%, transparent),
        inset 0 0 22px rgba(0, 0, 0, 0.6);
    }

    .pa-crimp {
      position: absolute;
      left: 0;
      right: 0;
      height: 9%;
      background:
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.28) 0 1px, transparent 1px 3px),
        var(--metal);
    }
    .pa-crimp--top { top: 0; }
    .pa-crimp--bottom { bottom: 0; }

    /* Holographic sheen: a soft rainbow band that drifts slowly. */
    .pa-holo {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        115deg,
        transparent 20%,
        rgba(255, 120, 200, 0.16) 32%,
        rgba(120, 220, 255, 0.18) 42%,
        rgba(180, 255, 150, 0.14) 52%,
        rgba(255, 230, 120, 0.16) 62%,
        transparent 75%
      );
      background-size: 250% 250%;
      mix-blend-mode: screen;
      animation: pa-holo 7s ease-in-out infinite alternate;
    }
    @keyframes pa-holo {
      from { background-position: 0% 0%; }
      to { background-position: 100% 100%; }
    }

    .pa-court {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      stroke: color-mix(in srgb, var(--glow) 32%, transparent);
      stroke-width: 0.9;
    }

    .pa-head {
      position: absolute;
      top: 12%;
      left: 9%;
      right: 9%;
      display: flex;
      justify-content: space-between;
      font-size: 6.5cqw;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: color-mix(in srgb, var(--glow) 80%, white);
      opacity: 0.8;
    }

    .pa-medal {
      position: absolute;
      top: 27%;
      left: 50%;
      width: 44%;
      aspect-ratio: 1;
      transform: translateX(-50%);
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.14), rgba(0, 0, 0, 0.35) 70%);
      box-shadow:
        0 0 0 2.2cqw rgba(0, 0, 0, 0.25),
        0 0 0 3cqw color-mix(in srgb, var(--glow) 70%, transparent),
        0 0 18px 2px color-mix(in srgb, var(--glow) 45%, transparent);
    }
    .pa-medal img {
      width: 72%;
      height: auto;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
    }

    /* Stage name printed in the tier's metal. */
    .pa-name {
      position: absolute;
      top: 64%;
      left: 6%;
      right: 6%;
      text-align: center;
      font-weight: 800;
      font-size: 10.5cqw;
      line-height: 1.02;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      background: var(--metal);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.6));
    }

    .pa-count {
      position: absolute;
      bottom: 13%;
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      font-size: 6cqw;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #fff;
      opacity: 0.75;
      padding: 0.6cqw 3.5cqw;
      border-radius: 9999px;
      border: 1px solid color-mix(in srgb, var(--glow) 55%, transparent);
    }

    .pa-spark {
      position: absolute;
      width: 5cqw;
      height: 5cqw;
      background: #fff6d8;
      clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
      filter: drop-shadow(0 0 3px var(--glow));
      animation: pa-spark 2.2s ease-in-out infinite;
    }
    @keyframes pa-spark {
      0%, 100% { opacity: 0; transform: scale(0.4) rotate(0deg); }
      50% { opacity: 1; transform: scale(1) rotate(30deg); }
    }

    /* Occasional glint across the pack. */
    .pa-shine {
      position: absolute;
      top: -40%;
      left: -70%;
      width: 34%;
      height: 220%;
      background: linear-gradient(rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.28) 50%, rgba(255, 255, 255, 0) 100%);
      transform: rotate(18deg);
      mix-blend-mode: overlay;
      animation: pa-shine 4.8s ease-in-out infinite;
    }
    @keyframes pa-shine {
      0%, 8% { left: -70%; }
      40%, 100% { left: 140%; }
    }

    @media (prefers-reduced-motion: reduce) {
      .pa-holo, .pa-spark, .pa-shine { animation: none; }
    }
  `,
})
export class PackArtComponent {
  protected i18n = inject(I18nService);

  readonly type = input.required<PackType>();
  // Hover lift / press dip, for when the art sits inside a buy button.
  readonly interactive = input(false);

  readonly tier = computed(() => TIER_BY_TYPE[this.type()] ?? "elite");
  readonly setCode = computed(() => SET_CODE[this.tier()]);
  readonly cardCount = computed(() => CARD_COUNT[this.type()] ?? 5);
  readonly name = computed(() => this.i18n.t(NAME_KEY_BY_TYPE[this.type()] ?? `packs.artName.${this.tier()}`));
}
