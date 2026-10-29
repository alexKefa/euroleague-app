import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, collectibleMoments, userCollectibles } from "../db/schema.js";
import { normalizePlayerName } from "./battles.js";
import { INJURY_MULTIPLIER, getCardStatLines } from "./statDuel.js";
import { formFor, rarityMult, validateLineup, LINEUP_SIZE, type DuelCard } from "./duelEngine.js";

// Four Quarters duels, DB layer. The pure rules are in duelEngine.ts; the
// lifecycle (create/accept/commit/finish) is added on top of this.
// Spec: docs/superpowers/specs/2026-10-29-four-quarters-duels-design.md

export class DuelError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

/**
 * Frozen DuelCards for a lineup, in input order. One ownership query plus one
 * getCardStatLines round trip. Throws INVALID_LINEUP if the user doesn't own
 * all five, or the lineup has a coach or two cards of the same player.
 */
export async function buildSnapshots(userId: string, collectibleIds: string[]): Promise<DuelCard[]> {
  const ids = [...new Set(collectibleIds)];
  if (ids.length !== LINEUP_SIZE) throw new DuelError("INVALID_LINEUP", 400);

  const rows = await db
    .select({
      id: collectibles.id,
      name: collectibles.name,
      teamId: collectibles.teamId,
      tier: collectibles.tier,
      imageUrl: collectibles.imageUrl,
      finish: userCollectibles.finish,
      momentRole: collectibleMoments.role,
    })
    .from(userCollectibles)
    .innerJoin(collectibles, eq(collectibles.id, userCollectibles.collectibleId))
    .leftJoin(
      collectibleMoments,
      and(eq(collectibleMoments.collectibleId, collectibles.id), eq(collectibleMoments.role, "mvp"))
    )
    .where(and(eq(userCollectibles.userId, userId), inArray(userCollectibles.collectibleId, ids)));

  if (rows.length !== LINEUP_SIZE) throw new DuelError("INVALID_LINEUP", 400);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = collectibleIds.map((id) => byId.get(id)!);

  if (validateLineup(ordered.map((r) => ({ playerKey: normalizePlayerName(r.name), tier: r.tier })))) {
    throw new DuelError("INVALID_LINEUP", 400);
  }

  const lines = await getCardStatLines(ordered.map((r) => ({ teamId: r.teamId, name: r.name, tier: r.tier, finish: r.finish })));
  return ordered.map((r, i) => {
    const line = lines[i];
    const isMvp = r.momentRole === "mvp";
    const isFoil = r.finish === "foil";
    const form = formFor(line.seasonPir, line.recentPir, line.recentGames);
    return {
      collectibleId: r.id,
      name: r.name,
      teamId: r.teamId,
      imageUrl: r.imageUrl,
      tier: r.tier,
      isMvp,
      isFoil,
      base: {
        pts: line.season.points,
        reb: line.season.rebounds,
        ast: line.season.assists,
        stl: line.season.steals,
        blk: line.season.blocks,
        pir: line.season.pir,
      },
      rarityMult: rarityMult(r.tier, isMvp, isFoil),
      formMult: form.mult,
      formBadge: form.badge,
      injury: line.injury,
      injuryMult: line.injury ? INJURY_MULTIPLIER[line.injury] : 1,
    };
  });
}
