import { PackType } from "../core/models";

// Pack art: a physical-foil-pack silhouette per tier, reusing the exact
// same rare/legendary gradients as the card frames themselves
// (features/store/collectible-card.ts) so the pack you see always matches
// what's inside it. Shared between the Packs page (features/packs, where
// the actual .pack-visual/.pack-dots/.pack-wordmark CSS lives, duplicated
// into features/wheel/wheel.css too — component styles don't cross feature
// boundaries in this app, same pattern already used for the burst/reveal
// animations both features independently keep) and the wheel's win reveal,
// so every pack visual across the app is the same art rather than each
// screen inventing its own.
export const PACK_VISUAL_CLASSES: Record<PackType, string> = {
  starter: "pack-visual-starter",
  pro: "pack-visual-pro",
  elite: "pack-visual-elite",
  wheelStarter: "pack-visual-starter",
  wheelPro: "pack-visual-pro",
  wheelLegendary: "pack-visual-elite",
  wheelCoach: "pack-visual-coach",
};
