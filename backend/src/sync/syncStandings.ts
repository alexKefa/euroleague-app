import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, teamSeasonStats } from "../db/schema.js";

/**
 * Standings sync (rewritten 2026-10-08). The old live.euroleague.net
 * /api/Standings endpoint now 404s, and nothing scheduled this anyway, so
 * production standings sat at round 1 while real teams had played 3-4
 * games. Now reads the v3 feed (the same one euroleaguebasketball.net
 * uses) and runs on the hourly tick in index.ts.
 *
 * v3 needs a round; asking for the latest round that has tipped off
 * returns the table with every game played so far, mid-round included.
 * Only wins/losses/position/ppg/papg are written — the radar columns
 * (off/def rating etc.) come from sync-py/standings_sync.py and are left
 * untouched. Teams are matched by code; unknown codes are skipped.
 */
const V3_BASE = process.env.EUROLEAGUE_V3_BASE_URL ?? "https://api-live.euroleague.net/v3";

interface V3StandingRow {
  position: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  pointsFor: number;
  pointsAgainst: number;
  club: { code: string };
}

/** `season` is the stored label, e.g. "2026-27". */
export async function syncStandings(season: string) {
  const [{ round } = { round: null }] = await db.execute<{ round: number | null }>(sql`
    select max(round)::int as round from games where season = ${season} and tipoff_at <= now()
  `);
  if (!round) return { round: null, updated: 0, unknownCodes: [] as string[] };

  const seasonCode = `E${season.slice(0, 4)}`;
  const res = await fetch(`${V3_BASE}/competitions/E/seasons/${seasonCode}/rounds/${round}/basicstandings`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`standings feed ${res.status}`);
  const rows = ((await res.json()) as { teams?: V3StandingRow[] }).teams ?? [];

  const teamIdByCode = new Map((await db.select({ id: teams.id, code: teams.code }).from(teams)).map((t) => [t.code, t.id]));
  const unknownCodes: string[] = [];
  const values = rows.flatMap((r) => {
    const teamId = teamIdByCode.get(r.club.code);
    if (!teamId) {
      unknownCodes.push(r.club.code);
      return [];
    }
    const gp = r.gamesPlayed;
    return [{
      teamId,
      season,
      position: r.position,
      wins: r.gamesWon,
      losses: r.gamesLost,
      ppg: gp > 0 ? r.pointsFor / gp : null,
      papg: gp > 0 ? r.pointsAgainst / gp : null,
    }];
  });
  if (values.length === 0) return { round, updated: 0, unknownCodes };

  // One multi-row upsert (DB round trips, not query count, are the cost here).
  await db
    .insert(teamSeasonStats)
    .values(values)
    .onConflictDoUpdate({
      target: [teamSeasonStats.teamId, teamSeasonStats.season],
      set: {
        position: sql`excluded.position`,
        wins: sql`excluded.wins`,
        losses: sql`excluded.losses`,
        ppg: sql`excluded.ppg`,
        papg: sql`excluded.papg`,
      },
    });
  return { round, updated: values.length, unknownCodes };
}
