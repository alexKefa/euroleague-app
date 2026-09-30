import { PackType } from "../core/models";

// Tier color classes for the small pack badges (.pack-visual-mini in the
// Packs lists, the wheel's wedge icons). The full-size pack art is
// shared/pack-art.ts.
export const PACK_VISUAL_CLASSES: Record<PackType, string> = {
  starter: "pack-visual-starter",
  pro: "pack-visual-pro",
  elite: "pack-visual-elite",
  wheelStarter: "pack-visual-starter",
  wheelPro: "pack-visual-pro",
  wheelLegendary: "pack-visual-elite",
  wheelCoach: "pack-visual-coach",
  // Reuses the Elite art rather than a new skin — a QR promo pack is
  // structured as a free "Elite"-tier pull (services/packs.ts) and is a
  // one-off, not a recurring reward channel, so it doesn't warrant its own
  // dedicated art the way a real recurring pack type does.
  qrBonus: "pack-visual-elite",
  // Same reasoning as qrBonus above — a free Elite-shaped one-off grant,
  // not a recurring pack type, so it reuses the Elite art too.
  welcomeBonus: "pack-visual-elite",
  // Referral reward (2026-09-28 hotfix, packs not points) — same Elite-
  // shaped one-off grant as qrBonus/welcomeBonus above, reuses their art.
  referralBonus: "pack-visual-elite",
};
