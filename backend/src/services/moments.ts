// Album Series 2 "Moments" (2026-10-27), db side. Turns each finished
// round's best performances into series-2 collectibles. Decision logic
// (ranking, readiness, launch gate) lives in momentsLogic.ts.
// Spec: docs/superpowers/specs/2026-10-27-album-series-2-moments-design.md
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, collectibleMoments, type MomentRole, type MomentBonusReason } from "../db/schema.js";
import { GREAT_ROUND_THRESHOLD } from "./cards.js";
import { computeTopScorerPlayerIdsForGames } from "./topScorerPoints.js";
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

// --- MVP-moment bonus (spec section 3, "B2")

export interface MomentBonusReward {
  collectibleId: string;
  round: number;
  reason: MomentBonusReason;
  name: string;
  imageUrl: string | null;
  teamCode: string;
}

/**
 * Grants each round's MVP moment to a user who had a great round (8+
 * correct winner picks) or correctly picked the MVP as their game's top
 * scorer (ties count). Called lazily, next to checkAndGrantRoundRewards.
 * Claim-first: the moment_bonuses insert is the claim, and a card the user
 * already owns isn't inserted twice. Returns every unseen bonus (new ones
 * included), like checkAndGrantRareMilestones, so the reveal survives a
 * reload until markMomentBonusesSeen.
 */
export async function checkAndGrantMomentBonuses(userId: string): Promise<MomentBonusReward[]> {
  const season = await getCurrentSeason();
  if (!season) return [];

  // One read: every unclaimed MVP moment with this user's correct-pick
  // count for that round and whether they picked the MVP as top scorer.
  const candidates = await db.execute<{
    collectible_id: string;
    game_id: string;
    player_id: string;
    correct: number;
    backed: boolean;
  }>(sql`
    select m.collectible_id, m.game_id, m.player_id,
      (select count(*)::int from predictions pr join games g on g.id = pr.game_id
        where pr.user_id = ${userId} and g.season = m.season and g.round = m.round
          and g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
          and pr.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
      ) as correct,
      exists (select 1 from top_scorer_predictions t
        where t.user_id = ${userId} and t.game_id = m.game_id and t.predicted_player_id = m.player_id) as backed
    from collectible_moments m
    join users u on u.id = ${userId} and u.deleted_at is null
    where m.season = ${season} and m.role = 'mvp'
      and not exists (select 1 from moment_bonuses b where b.user_id = ${userId} and b.collectible_id = m.collectible_id)`);

  const backedGames = candidates.filter((c) => c.backed).map((c) => c.game_id);
  const topScorers = backedGames.length > 0 ? await computeTopScorerPlayerIdsForGames(backedGames) : new Map<string, string[]>();
  const qualifying: { collectibleId: string; reason: MomentBonusReason }[] = [];
  for (const c of candidates) {
    if (c.backed && (topScorers.get(c.game_id) ?? []).includes(c.player_id)) qualifying.push({ collectibleId: c.collectible_id, reason: "backed_mvp" });
    else if (c.correct >= GREAT_ROUND_THRESHOLD) qualifying.push({ collectibleId: c.collectible_id, reason: "great_round" });
  }

  const claimValues =
    qualifying.length > 0
      ? sql.join(qualifying.map((q) => sql`(${q.collectibleId}::uuid, ${q.reason})`), sql`, `)
      : null;
  // One statement: claim, grant the cards not owned yet, and return the
  // newly claimed plus the earlier unseen bonuses.
  const rows = await db.execute<{ collectible_id: string; round: number; reason: MomentBonusReason; name: string; image_url: string | null; team_code: string }>(sql`
    with claimed as (
      ${
        claimValues
          ? sql`insert into moment_bonuses (user_id, collectible_id, reason)
              select ${userId}, x.collectible_id, x.reason from (values ${claimValues}) as x(collectible_id, reason)
              on conflict do nothing returning collectible_id, reason`
          : sql`select null::uuid as collectible_id, null::varchar as reason where false`
      }
    ),
    granted as (
      insert into user_collectibles (user_id, collectible_id)
      select ${userId}, collectible_id from claimed
      on conflict do nothing
    ),
    unseen as (
      select collectible_id, reason from claimed
      union
      select collectible_id, reason from moment_bonuses where user_id = ${userId} and seen_at is null
    )
    select un.collectible_id, m.round, un.reason, c.name, c.image_url, t.code as team_code
    from unseen un
    join collectible_moments m on m.collectible_id = un.collectible_id
    join collectibles c on c.id = un.collectible_id
    join teams t on t.id = c.team_id
    order by m.round`);

  return rows.map((r) => ({
    collectibleId: r.collectible_id,
    round: r.round,
    reason: r.reason,
    name: r.name,
    imageUrl: r.image_url,
    teamCode: r.team_code,
  }));
}

export async function markMomentBonusesSeen(userId: string): Promise<void> {
  await db.execute(sql`update moment_bonuses set seen_at = now() where user_id = ${userId} and seen_at is null`);
}
