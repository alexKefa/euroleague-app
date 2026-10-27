// Album Series 2 "Moments" (2026-10-27), db side. Turns each finished
// round's best performances into series-2 collectibles. Decision logic
// (ranking, readiness, launch gate) lives in momentsLogic.ts.
// Spec: docs/superpowers/specs/2026-10-27-album-series-2-moments-design.md
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, collectibleMoments, type MomentRole } from "../db/schema.js";
import { getCurrentSeason } from "./season.js";
import { invalidate, CACHE_KEYS } from "./responseCache.js";
import {
  MOMENTS_PER_ROUND,
  isMomentsLaunched,
  isRoundReady,
  pickRoundMoments,
  formatPlayerName,
  type PlayerLine,
  type RoundGame,
} from "./momentsLogic.js";

// Same book values as the series-1 catalog (scripts/expand-collectibles.ts).
const POINTS_COST: Record<MomentRole, number> = { mvp: 2500, top: 250 };

export interface PlannedMoment {
  line: PlayerLine;
  role: MomentRole;
  playerName: string;
  photoUrl: string | null;
  opponentTeamId: string | null;
}

/** Rounds of `season` with no moment cards yet that isRoundReady accepts. */
export async function findReadyRounds(season: string, now: Date): Promise<{ round: number; gameIds: string[] }[]> {
  const rows = await db.execute<{ round: number; id: string; tipoff_at: string; status: string; has_stats: boolean }>(sql`
    select g.round, g.id, g.tipoff_at, g.status,
      exists (select 1 from player_game_stats s where s.game_id = g.id) as has_stats
    from games g
    where g.season = ${season} and g.round is not null
      and not exists (select 1 from collectible_moments m where m.season = g.season and m.round = g.round)
    order by g.round`);
  const byRound = new Map<number, RoundGame[]>();
  for (const r of rows) {
    const list = byRound.get(r.round) ?? [];
    list.push({ gameId: r.id, tipoffAt: new Date(r.tipoff_at), status: r.status, hasStats: r.has_stats });
    byRound.set(r.round, list);
  }
  const ready: { round: number; gameIds: string[] }[] = [];
  for (const [round, games] of byRound) {
    const r = isRoundReady(games, now);
    if (r.ready) ready.push({ round, gameIds: r.gameIds });
  }
  return ready;
}

/** The round's six picks with everything needed to insert the cards. */
export async function planRoundMoments(season: string, round: number, gameIds: string[]): Promise<PlannedMoment[]> {
  if (gameIds.length === 0) return [];
  const rows = await db.execute<{
    player_id: string;
    name: string;
    photo_url: string | null;
    current_team_id: string;
    game_id: string;
    home_team_id: string;
    away_team_id: string;
    valuation: number | null;
    points: number | null;
    rebounds: number | null;
    assists: number | null;
    minutes: number | null;
  }>(sql`
    select s.player_id, p.name, p.photo_url, p.team_id as current_team_id, s.game_id,
      g.home_team_id, g.away_team_id, s.valuation, s.points, s.rebounds, s.assists, s.minutes
    from player_game_stats s
    join games g on g.id = s.game_id
    join players p on p.id = s.player_id
    where g.season = ${season} and g.round = ${round}
      and s.game_id in (${sql.join(gameIds.map((id) => sql`${id}`), sql`, `)})`);
  const meta = new Map(rows.map((r) => [`${r.player_id}:${r.game_id}`, r]));
  // player_game_stats has no team column: the player's team in the game is
  // their current team when it played that game (see the ledger ruling).
  const lines: PlayerLine[] = rows.map((r) => ({
    playerId: r.player_id,
    teamId: r.current_team_id,
    gameId: r.game_id,
    pir: r.valuation,
    points: r.points,
    rebounds: r.rebounds,
    assists: r.assists,
    minutes: r.minutes,
  }));
  return pickRoundMoments(lines, MOMENTS_PER_ROUND).map(({ line, role }) => {
    const m = meta.get(`${line.playerId}:${line.gameId}`)!;
    const inGame = line.teamId === m.home_team_id || line.teamId === m.away_team_id;
    return {
      line,
      role,
      playerName: formatPlayerName(m.name),
      photoUrl: m.photo_url,
      opponentTeamId: inGame ? (line.teamId === m.home_team_id ? m.away_team_id : m.home_team_id) : null,
    };
  });
}

class RoundAlreadyGenerated extends Error {}

async function insertRound(season: string, round: number, picks: PlannedMoment[]): Promise<number> {
  return db.transaction(async (tx) => {
    const withIds = picks.map((p) => ({ ...p, id: randomUUID() }));
    await tx.insert(collectibles).values(
      withIds.map((p) => ({
        id: p.id,
        name: p.playerName,
        teamId: p.line.teamId,
        tier: p.role === "mvp" ? "legendary" : "rare",
        pointsCost: POINTS_COST[p.role],
        imageUrl: p.photoUrl,
        series: 2,
      }))
    );
    const inserted = await tx
      .insert(collectibleMoments)
      .values(
        withIds.map((p) => ({
          collectibleId: p.id,
          playerId: p.line.playerId,
          gameId: p.line.gameId,
          season,
          round,
          role: p.role,
          points: p.line.points,
          pir: p.line.pir,
          rebounds: p.line.rebounds,
          assists: p.line.assists,
          minutes: p.line.minutes,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: collectibleMoments.collectibleId });
    // A concurrent run got there first: roll back this run's collectibles.
    if (inserted.length !== withIds.length) throw new RoundAlreadyGenerated();
    return inserted.length;
  });
}

/**
 * Creates the moment cards of every ready round in the current season.
 * Does nothing before MOMENTS_LAUNCH_AT unless `force` (dev only) or
 * `dryRun` (prints, never writes). Safe to call every hour.
 */
export async function generateMomentsForReadyRounds(
  opts: { now?: Date; force?: boolean; dryRun?: boolean } = {}
): Promise<{ round: number; created: number; picks: PlannedMoment[] }[]> {
  const now = opts.now ?? new Date();
  if (!opts.force && !opts.dryRun && !isMomentsLaunched(now)) return [];
  const season = await getCurrentSeason();
  if (!season) return [];

  const results: { round: number; created: number; picks: PlannedMoment[] }[] = [];
  for (const { round, gameIds } of await findReadyRounds(season, now)) {
    try {
      const picks = await planRoundMoments(season, round, gameIds);
      if (picks.length === 0) continue;
      const created = opts.dryRun ? 0 : await insertRound(season, round, picks);
      results.push({ round, created, picks });
    } catch (err) {
      if (err instanceof RoundAlreadyGenerated) continue;
      console.error(`[moments] round ${round} failed:`, err);
    }
  }
  if (results.some((r) => r.created > 0)) invalidate(CACHE_KEYS.collectibles);
  return results;
}
