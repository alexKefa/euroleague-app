// Gold/silver/bronze rank-badge classes for the top 3 of any leaderboard —
// same podium gradient stops as shared/prize-banner.css's
// .prize-podium-bar--1/2/3 (kept as literal Tailwind arbitrary-value
// gradients here rather than a shared CSS class, since this needs to work
// in components with no dedicated stylesheet). `index` is 0-based.
export function rankBadgeClasses(index: number): string {
  switch (index) {
    case 0:
      return "bg-[linear-gradient(135deg,#fff3b0_0%,#ffcd3c_55%,#f0a500_100%)] text-[#4a2e00] shadow-[0_2px_10px_-2px_rgba(240,165,0,0.65)]";
    case 1:
      return "bg-[linear-gradient(135deg,#f2f2f2_0%,#cfcfcf_55%,#a8a8a8_100%)] text-[#2a2a2a] shadow-[0_2px_8px_-2px_rgba(150,150,150,0.5)]";
    case 2:
      return "bg-[linear-gradient(135deg,#e8b487_0%,#cd7f32_55%,#a35d21_100%)] text-[#3a1f00] shadow-[0_2px_8px_-2px_rgba(163,93,33,0.5)]";
    default:
      return "bg-page text-muted border border-line";
  }
}

// Row-level container accent for rank 0 (1st place) — a warm glow + border
// tint, same podium-gold hue as the badge above, so the whole row reads as
// "the leader" at a glance, not just its badge.
export function rankRowClasses(index: number): string {
  return index === 0
    ? "border-[#f0a500]/40 shadow-[0_6px_20px_-8px_rgba(240,165,0,0.4)]"
    : "border-line shadow-card";
}
