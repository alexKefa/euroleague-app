import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerSeasonStats } from "../db/schema.js";
import { getCurrentSeason } from "./season.js";

// A real stake, not a minted reward (2026-09-22 fix) — the winner's points
// come out of the loser's own balance via two point_adjustments rows (+N
// winner, -N loser), not a flat grant from nothing. The original flat-grant
// version was a real, live-caught infinite-farming exploit: with zero cost
// to challenge and a guaranteed mint on every resolution, two colluding
// (or even just two genuinely competitive) users could duel back and forth
// forever, each netting free points roughly half the time for no cost at
// all.
//
// The stake itself is variable, not flat (2026-09-23) — direct ask: "lower
// tier cards should get more points when competing against higher ones".
// Reuses the exact same shape as services/points.ts's odds-weighted
// pointsForCorrectPick (predictions): the *winning* side's own pre-duel win
// probability sets the payout, `min(CAP, max(BASE, round(BASE /
// winProb)))` — a heavy favorite winning (high winProb) pays close to
// BASE, a real underdog pulling off the upset (low winProb) pays up to
// CAP. No favorite/underdog branch needed, same reasoning as the
// predictions formula's own doc comment: one continuous formula covers
// both directions.
export const BATTLE_STAKE_BASE = 25;
export const BATTLE_STAKE_CAP = 100;

export function computeStakeForWinProb(winProb: number): number {
  return Math.min(BATTLE_STAKE_CAP, Math.max(BATTLE_STAKE_BASE, Math.round(BATTLE_STAKE_BASE / winProb)));
}

// Mirrors routes/collectibles.ts's normalizePlayerName exactly — kept as its
// own small copy rather than importing a helper out of a routes file into a
// service, same "small self-contained duplication is fine" convention
// analytics-builder.ts's own column-list copy already sets in this app.
function normalizePlayerName(name: string): string {
  const commaIdx = name.indexOf(",");
  const reordered = commaIdx === -1 ? name : `${name.slice(commaIdx + 1)} ${name.slice(0, commaIdx)}`;
  return reordered.toLowerCase().replace(/\s+/g, " ").trim();
}

// A weighted-coin-flip duel (2026-09-22 v3) — every card has some chance to
// win, but a much stronger one is heavily favored, never a guaranteed
// outcome either way. Tier sets a floor, real current-season-or-career PIR
// (same fallback chain used everywhere else this app derives a card stat
// from player data) adds on top — same "missing data isn't a scoring
// dependency" convention as odds/fantasy pricing/top-scorer points for a
// player with no synced stats at all.
const TIER_BASE: Record<string, number> = { common: 20, rare: 35, legendary: 55 };

async function buildPirLookup(): Promise<Map<string, number>> {
  const season = (await getCurrentSeason()) ?? "__none__";
  const rows = await db.execute<{ team_id: string; name: string; pir: number | null }>(sql`
    select
      p.team_id as team_id,
      p.name as name,
      coalesce(
        (select pss.valuation from ${playerSeasonStats} pss where pss.player_id = p.id and pss.season = ${season} limit 1),
        (select sum(pss2.valuation * pss2.games_played) / nullif(sum(pss2.games_played), 0)
         from ${playerSeasonStats} pss2 where pss2.player_id = p.id)
      ) as pir
    from ${players} p
  `);
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.pir == null) continue;
    map.set(`${row.team_id}|${normalizePlayerName(row.name)}`, row.pir);
  }
  return map;
}

export async function computeCardPowers(
  cards: { teamId: string; name: string; tier: string }[]
): Promise<number[]> {
  const lookup = await buildPirLookup();
  return cards.map((c) => {
    const base = TIER_BASE[c.tier] ?? TIER_BASE.common;
    const pir = lookup.get(`${c.teamId}|${normalizePlayerName(c.name)}`) ?? 0;
    return Math.max(1, Math.round(base + pir));
  });
}

// Proportional win probability (powerA / (powerA + powerB)), same shape as
// a simple Elo-style expected-score formula — resolved once, server-side,
// at accept time, never re-rolled.
export function resolveDuel(challengerPower: number, opponentPower: number): "challenger" | "opponent" {
  const pChallenger = challengerPower / (challengerPower + opponentPower);
  return Math.random() < pChallenger ? "challenger" : "opponent";
}
