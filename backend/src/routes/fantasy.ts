import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  players,
  teams,
  playerSeasonStats,
  playerFantasyPrices,
  fantasyLineups,
  coachFantasyPrices,
  fantasyCoachPicks,
  fantasyPricingState,
  games,
  playerGameStats,
} from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { getCurrentSeason } from "../services/season.js";
import {
  getRoundLockTime,
  getDefaultRound,
  getBaselineSquad,
  getFantasyLeaderboardEntries,
  FANTASY_STARTER_COUNT,
  FANTASY_SIXTH_MAN_COUNT,
  FANTASY_BENCH_COUNT,
  FANTASY_TOTAL_OUTFIELD,
  FANTASY_POSITION_QUOTA,
  FANTASY_BUDGET_CAP,
  FANTASY_PIR_CEILING_FLOOR,
  FANTASY_MIN_PRICE,
  COACH_MIN_PRICE,
  FANTASY_TRANSFERS_PER_ROUND,
  BENCH_SCORE_MULTIPLIER,
  COACH_WIN_POINTS,
  COACH_LOSS_POINTS,
  computeBudgetCap,
} from "../services/fantasyScoring.js";

export const fantasyRouter = Router();

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT_ROLES = ["starter", "sixth_man", "bench"] as const;
type SlotRole = (typeof SLOT_ROLES)[number];

/** Explicit ?season= wins; otherwise falls back to getCurrentSeason(). */
async function resolveSeason(seasonParam: unknown): Promise<string | null> {
  if (typeof seasonParam === "string") return seasonParam;
  return getCurrentSeason();
}

// The effective budget cap for a season — FANTASY_BUDGET_CAP scaled by how
// far scripts/reprice-fantasy-players.ts's dynamic price ceiling has moved
// off its floor (services/fantasyScoring.ts's computeBudgetCap). Falls back
// to the flat FANTASY_BUDGET_CAP (ceiling === floor) if reprice has never
// run for this season yet — same "unpriced player floors at MIN_PRICE"
// spirit as the rest of this router before any pricing data exists.
async function getBudgetCap(season: string): Promise<number> {
  const [row] = await db
    .select({ ceiling: fantasyPricingState.ceiling })
    .from(fantasyPricingState)
    .where(eq(fantasyPricingState.season, season))
    .limit(1);
  return computeBudgetCap(row?.ceiling ?? FANTASY_PIR_CEILING_FLOOR);
}

// The whole player pool + draft price for the roster builder — same
// "small dataset, fetch once, filter/sort client-side" shape as
// GET /players/advanced-stats. Left-joins player_fantasy_prices (rather
// than requiring it) so this still works before fantasy:reprice has ever
// been run — an unpriced player just floors at FANTASY_MIN_PRICE.
fantasyRouter.get("/players", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json({ season: null, rows: [] });
      return;
    }

    const rows = await db
      .select({ player: players, team: teams, price: playerFantasyPrices.price, stats: playerSeasonStats })
      .from(players)
      .innerJoin(teams, eq(players.teamId, teams.id))
      .leftJoin(
        playerFantasyPrices,
        and(eq(playerFantasyPrices.playerId, players.id), eq(playerFantasyPrices.season, season))
      )
      .leftJoin(playerSeasonStats, and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, season)))
      .where(eq(players.active, true));

    res.json({
      season,
      rows: rows.map((r) => ({
        player: { id: r.player.id, name: r.player.name, position: r.player.position, photoUrl: r.player.photoUrl },
        team: { id: r.team.id, code: r.team.code, name: r.team.name, primaryColor: r.team.primaryColor, logoUrl: r.team.logoUrl },
        price: r.price ?? FANTASY_MIN_PRICE,
        pointsPerGame: r.stats?.pointsPerGame ?? null,
        valuation: r.stats?.valuation ?? null,
        gamesPlayed: r.stats?.gamesPlayed ?? null,
      })),
    });
  } catch (err) {
    console.error("GET /api/fantasy/players failed:", err);
    res.status(500).json({ error: "Failed to load fantasy players" });
  }
});

// The coach pool — one row per team playing this season, priced off real
// standings (services/fantasyScoring.ts's computeCoachPrice).
fantasyRouter.get("/coaches", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json({ season: null, rows: [] });
      return;
    }

    const rows = await db
      .select({ team: teams, price: coachFantasyPrices.price })
      .from(coachFantasyPrices)
      .innerJoin(teams, eq(coachFantasyPrices.teamId, teams.id))
      .where(eq(coachFantasyPrices.season, season));

    res.json({
      season,
      rows: rows.map((r) => ({
        team: { id: r.team.id, code: r.team.code, name: r.team.name, primaryColor: r.team.primaryColor, logoUrl: r.team.logoUrl },
        headCoach: r.team.headCoach,
        price: r.price ?? COACH_MIN_PRICE,
      })),
    });
  } catch (err) {
    console.error("GET /api/fantasy/coaches failed:", err);
    res.status(500).json({ error: "Failed to load fantasy coaches" });
  }
});

function emptyLineupResponse(season: string | null, defaultRound: number | null, budgetCap: number = FANTASY_BUDGET_CAP) {
  return {
    season,
    round: null,
    defaultRound,
    players: [],
    coachTeamId: null,
    coachLocked: false,
    lockAt: null,
    locked: false,
    roundComplete: false,
    coachPoints: 0,
    totalPoints: 0,
    totalPir: 0,
    transfersUsed: 0,
    transfersAllowed: null,
    baselinePlayerIds: null,
    budgetCap,
  };
}

// The current user's 10-player squad + coach for a round (defaults to the
// current season's default round), each player individually flagged
// `locked` — their own team's game for this round has already tipped off.
// Display-only now (see the doc comment on POST /lineup/batch below): edits
// are gated on the round's own overall lock (`coachLocked`/`lockAt`), not
// on this per-player flag. Also doubles as the read side of round-to-round
// carry-forward and per-round scoring — see the inline comments below.
fantasyRouter.get("/lineup", requireAuth, async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json(emptyLineupResponse(null, null));
      return;
    }
    const defaultRound = await getDefaultRound(season);
    const round = req.query.round ? Number(req.query.round) : defaultRound;
    if (round === null || Number.isNaN(round)) {
      res.json(emptyLineupResponse(season, defaultRound));
      return;
    }

    const baseline = await getBaselineSquad(req.userId!, season, round);

    let lineupRows = await db
      .select({ playerId: fantasyLineups.playerId, slotRole: fantasyLineups.slotRole, isCaptain: fantasyLineups.isCaptain })
      .from(fantasyLineups)
      .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round)));
    let coachTeamId: string | null = (
      await db
        .select({ teamId: fantasyCoachPicks.teamId })
        .from(fantasyCoachPicks)
        .where(and(eq(fantasyCoachPicks.userId, req.userId!), eq(fantasyCoachPicks.season, season), eq(fantasyCoachPicks.round, round)))
        .limit(1)
    )[0]?.teamId ?? null;

    // Carry-forward (2026-09-07) — a round nobody has touched yet, but only
    // the current active round, never a future one someone poked at via a
    // round navigator before it's actually reachable — auto-seeds from the
    // previous round's saved squad/coach (see getBaselineSquad) instead of
    // starting from an empty court every round. Persisted immediately, not
    // just returned, so it's locked in for scoring even if the user never
    // opens this page again before the round locks — same "on read" lazy-
    // write precedent as round rewards/referral grants elsewhere in this
    // app (see CLAUDE.md).
    if (lineupRows.length === 0 && round === defaultRound && baseline) {
      await db.transaction(async (tx) => {
        await tx.insert(fantasyLineups).values(
          baseline.rows.map((r) => ({
            userId: req.userId!,
            season,
            round,
            playerId: r.playerId,
            slotRole: r.slotRole,
            isCaptain: r.isCaptain,
          }))
        );
        if (baseline.coachTeamId) {
          await tx.insert(fantasyCoachPicks).values({ userId: req.userId!, season, round, teamId: baseline.coachTeamId });
        }
      });
      lineupRows = baseline.rows;
      coachTeamId = baseline.coachTeamId;
    }

    const playerIds = lineupRows.map((r) => r.playerId);

    const [lockAt, playerTeamRows, roundGames, budgetCap] = await Promise.all([
      getRoundLockTime(season, round),
      playerIds.length
        ? db.select({ id: players.id, teamId: players.teamId }).from(players).where(inArray(players.id, playerIds))
        : Promise.resolve([] as { id: string; teamId: string }[]),
      db
        .select({
          id: games.id,
          homeTeamId: games.homeTeamId,
          awayTeamId: games.awayTeamId,
          tipoffAt: games.tipoffAt,
          status: games.status,
          homeScore: games.homeScore,
          awayScore: games.awayScore,
        })
        .from(games)
        .where(and(eq(games.season, season), eq(games.round, round))),
      getBudgetCap(season),
    ]);

    const teamIdByPlayer = new Map(playerTeamRows.map((p) => [p.id, p.teamId]));
    const gameByTeamId = new Map<string, (typeof roundGames)[number]>();
    for (const g of roundGames) {
      gameByTeamId.set(g.homeTeamId, g);
      gameByTeamId.set(g.awayTeamId, g);
    }

    // Per-player scoring — same rule as getFantasyLeaderboardEntries's SQL
    // (only a *final* game's real box score counts), just computed in JS
    // here since this endpoint also needs each player's own raw valuation
    // for display, not only the aggregate total that query returns.
    const finalGameIds = roundGames.filter((g) => g.status === "final").map((g) => g.id);
    const statsRows =
      finalGameIds.length && playerIds.length
        ? await db
            .select({ playerId: playerGameStats.playerId, gameId: playerGameStats.gameId, valuation: playerGameStats.valuation })
            .from(playerGameStats)
            .where(and(inArray(playerGameStats.playerId, playerIds), inArray(playerGameStats.gameId, finalGameIds)))
        : [];
    const statsByPlayerGame = new Map(statsRows.map((r) => [`${r.playerId}:${r.gameId}`, r.valuation ?? 0]));

    const now = Date.now();
    let totalPoints = 0;
    let totalPir = 0;
    const playersOut = lineupRows.map((r) => {
      const teamId = teamIdByPlayer.get(r.playerId);
      const game = teamId ? gameByTeamId.get(teamId) : undefined;
      const tipoff = game ? new Date(game.tipoffAt) : undefined;
      const valuation = game && game.status === "final" ? statsByPlayerGame.get(`${r.playerId}:${game.id}`) ?? 0 : null;
      const points = (valuation ?? 0) * (r.isCaptain ? 2 : 1) * (r.slotRole === "bench" ? BENCH_SCORE_MULTIPLIER : 1);
      totalPoints += points;
      totalPir += valuation ?? 0;
      return {
        playerId: r.playerId,
        slotRole: r.slotRole,
        isCaptain: r.isCaptain,
        locked: tipoff ? tipoff.getTime() <= now : false,
        valuation,
        points,
      };
    });

    const coachGame = coachTeamId ? gameByTeamId.get(coachTeamId) : undefined;
    let coachPoints = 0;
    if (coachGame && coachGame.status === "final") {
      const isHome = coachGame.homeTeamId === coachTeamId;
      const won = isHome
        ? (coachGame.homeScore ?? 0) > (coachGame.awayScore ?? 0)
        : (coachGame.awayScore ?? 0) > (coachGame.homeScore ?? 0);
      coachPoints = won ? COACH_WIN_POINTS : COACH_LOSS_POINTS;
    }
    totalPoints += coachPoints;

    const coachLocked = lockAt !== null && lockAt.getTime() <= now;
    const roundComplete = roundGames.length > 0 && roundGames.every((g) => g.status === "final");
    const transfersUsed = baseline ? playerIds.filter((id) => !baseline.playerIds.has(id)).length : 0;

    res.json({
      season,
      round,
      defaultRound,
      players: playersOut,
      coachTeamId,
      coachLocked,
      lockAt,
      locked: coachLocked,
      roundComplete,
      coachPoints,
      totalPoints,
      totalPir,
      transfersUsed,
      transfersAllowed: baseline ? FANTASY_TRANSFERS_PER_ROUND : null,
      budgetCap,
      // The client-side mirror of the transfer-limit check above — lets the
      // roster builder disable adding a *new* (non-baseline) player once
      // the limit's already spent, the same pre-emptive-gating pattern the
      // position quota already uses, rather than only discovering the
      // violation from a rejected save.
      baselinePlayerIds: baseline ? [...baseline.playerIds] : null,
    });
  } catch (err) {
    console.error("GET /api/fantasy/lineup failed:", err);
    res.status(500).json({ error: "Failed to load lineup" });
  }
});

// Wholesale-replaces the user's 10-player squad + coach pick for one round.
// Whole-round lock (2026-09-07, replacing a per-player "Turns" rule): once
// this round's first game has tipped off, the entire lineup — every
// player, the formation-driven slotRole mix, the captain, the coach —
// freezes, not just whichever specific players' own games have started.
// The previous design mirrored real EuroLeague Fantasy's actual per-player
// "Turns" mechanic (swap a not-yet-played player right up until their own
// team's tipoff, even if other round games were already live) — reverted
// by explicit request: "since a game is live no changes can be made at
// all... disable everything". Checked once, up front, against the round's
// own first tipoff (getRoundLockTime) rather than per-player — cheaper
// too: one round trip instead of one per changed player, and no need to
// fetch the old squad/coach pick at all just to diff against it.
// GET /lineup's per-player `locked` flag below is a separate, still-live
// concept — "has this specific player's own game actually tipped off" —
// used only for display (e.g. showing live PIR instead of an upcoming
// opponent), not for gating edits any more.
fantasyRouter.post("/lineup/batch", requireAuth, async (req, res) => {
  try {
    const { season, round, players: entries, coachTeamId } = req.body ?? {};
    if (typeof season !== "string" || typeof round !== "number" || !Number.isInteger(round)) {
      res.status(400).json({ error: "season and round are required" });
      return;
    }
    const roundLockAt = await getRoundLockTime(season, round);
    if (roundLockAt === null) {
      res.status(400).json({ error: "Unknown round", code: "ROUND_NOT_FOUND" });
      return;
    }
    if (roundLockAt.getTime() <= Date.now()) {
      res.status(400).json({ error: "This round has already locked", code: "ROUND_LOCKED" });
      return;
    }
    if (typeof coachTeamId !== "string" || !uuidPattern.test(coachTeamId)) {
      res.status(400).json({ error: "coachTeamId is required" });
      return;
    }
    if (!Array.isArray(entries) || entries.length !== FANTASY_TOTAL_OUTFIELD) {
      res.status(400).json({ error: `Squad must contain exactly ${FANTASY_TOTAL_OUTFIELD} players` });
      return;
    }

    const seenIds = new Set<string>();
    for (const e of entries) {
      if (typeof e?.playerId !== "string" || !uuidPattern.test(e.playerId)) {
        res.status(400).json({ error: "Each squad entry needs a valid playerId" });
        return;
      }
      if (!SLOT_ROLES.includes(e.slotRole)) {
        res.status(400).json({ error: "Each squad entry needs a valid slotRole" });
        return;
      }
      if (seenIds.has(e.playerId)) {
        res.status(400).json({ error: "Duplicate player in squad" });
        return;
      }
      seenIds.add(e.playerId);
    }

    const typedEntries = entries as { playerId: string; slotRole: SlotRole; isCaptain?: boolean }[];
    const starters = typedEntries.filter((e) => e.slotRole === "starter");
    const sixthMen = typedEntries.filter((e) => e.slotRole === "sixth_man");
    const bench = typedEntries.filter((e) => e.slotRole === "bench");
    if (starters.length !== FANTASY_STARTER_COUNT || sixthMen.length !== FANTASY_SIXTH_MAN_COUNT || bench.length !== FANTASY_BENCH_COUNT) {
      res.status(400).json({
        error: `Need exactly ${FANTASY_STARTER_COUNT} starters, ${FANTASY_SIXTH_MAN_COUNT} sixth man, ${FANTASY_BENCH_COUNT} bench`,
      });
      return;
    }
    const captains = starters.filter((e) => e.isCaptain);
    if (captains.length !== 1 || typedEntries.some((e) => e.isCaptain && e.slotRole !== "starter")) {
      res.status(400).json({ error: "Exactly one starter must be captain" });
      return;
    }

    const newIds = typedEntries.map((e) => e.playerId);

    const playerRows = await db
      .select({ id: players.id, teamId: players.teamId, position: players.position })
      .from(players)
      .where(inArray(players.id, newIds));
    const playerById = new Map(playerRows.map((p) => [p.id, p]));

    // Position quota — only over the newly submitted squad.
    const posCounts: Record<string, number> = { Guard: 0, Forward: 0, Center: 0 };
    for (const id of newIds) {
      const p = playerById.get(id);
      if (!p) {
        res.status(400).json({ error: "Unknown player in squad" });
        return;
      }
      if (p.position && p.position in posCounts) posCounts[p.position]++;
    }
    for (const [position, quota] of Object.entries(FANTASY_POSITION_QUOTA)) {
      if (posCounts[position] !== quota) {
        res.status(400).json({ error: `Need exactly ${quota} ${position}s, got ${posCounts[position] ?? 0}`, code: "POSITION_QUOTA" });
        return;
      }
    }

    // Transfer limit (2026-09-07) — see getBaselineSquad's doc comment.
    // Counted against the previous round's squad specifically, not
    // whatever was last saved *this* round, so re-saving within the same
    // still-unlocked round never resets the budget: however many times a
    // user changes their mind before the deadline, at most
    // FANTASY_TRANSFERS_PER_ROUND players may ever differ from what they
    // had last round. No limit at all when there's no baseline (round 1,
    // or a round with no saved squad the round before it).
    const baseline = await getBaselineSquad(req.userId!, season, round);
    if (baseline) {
      const transfersUsed = newIds.filter((id) => !baseline.playerIds.has(id)).length;
      if (transfersUsed > FANTASY_TRANSFERS_PER_ROUND) {
        res.status(400).json({
          error: `Too many changes — up to ${FANTASY_TRANSFERS_PER_ROUND} player changes are allowed per round`,
          code: "TRANSFERS_EXCEEDED",
          transfersUsed,
          transfersAllowed: FANTASY_TRANSFERS_PER_ROUND,
        });
        return;
      }
    }

    const [priceRows, coachPriceRows] = await Promise.all([
      db
        .select({ playerId: playerFantasyPrices.playerId, price: playerFantasyPrices.price })
        .from(playerFantasyPrices)
        .where(and(eq(playerFantasyPrices.season, season), inArray(playerFantasyPrices.playerId, newIds))),
      db
        .select({ price: coachFantasyPrices.price })
        .from(coachFantasyPrices)
        .where(and(eq(coachFantasyPrices.teamId, coachTeamId), eq(coachFantasyPrices.season, season)))
        .limit(1),
    ]);
    const priceByPlayerId = new Map(priceRows.map((r) => [r.playerId, r.price]));
    const playersCost = newIds.reduce((sum, id) => sum + (priceByPlayerId.get(id) ?? FANTASY_MIN_PRICE), 0);
    const coachCost = coachPriceRows[0]?.price ?? COACH_MIN_PRICE;
    // Rounded to the nearest 0.1 before comparing — prices are now tenth-
    // credit floats (see schema.ts), and summing several of them can land
    // a fraction of a cent off the true total (e.g. 27.999999999999996)
    // purely from binary float representation, which would wrongly reject
    // a squad that costs exactly the cap.
    const totalCost = Math.round((playersCost + coachCost) * 10) / 10;
    const budgetCap = await getBudgetCap(season);
    if (totalCost > budgetCap) {
      res.status(400).json({
        error: `Squad costs ${totalCost}, over the ${budgetCap}-credit budget`,
        code: "OVER_BUDGET",
      });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(fantasyLineups)
        .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round)));
      await tx.insert(fantasyLineups).values(
        typedEntries.map((e) => ({
          userId: req.userId!,
          season,
          round,
          playerId: e.playerId,
          slotRole: e.slotRole,
          isCaptain: !!e.isCaptain,
        }))
      );
      await tx
        .insert(fantasyCoachPicks)
        .values({ userId: req.userId!, season, round, teamId: coachTeamId })
        .onConflictDoUpdate({
          target: [fantasyCoachPicks.userId, fantasyCoachPicks.season, fantasyCoachPicks.round],
          set: { teamId: coachTeamId },
        });
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/fantasy/lineup/batch failed:", err);
    res.status(500).json({ error: "Failed to save lineup" });
  }
});

// Global season leaderboard — a league-scoped version lives at
// GET /leagues/:id/fantasy-leaderboard (routes/leagues.ts), sharing
// getFantasyLeaderboardEntries the same way the points leaderboard is
// shared between the global and league-scoped routes.
fantasyRouter.get("/leaderboard", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json([]);
      return;
    }
    const round = req.query.round ? Number(req.query.round) : undefined;
    const entries = await getFantasyLeaderboardEntries({ season, round });
    res.json(entries);
  } catch (err) {
    console.error("GET /api/fantasy/leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load fantasy leaderboard" });
  }
});
