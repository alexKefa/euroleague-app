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
  games,
  playerGameStats,
  users,
  playerInjuries,
  collectibles,
} from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { getCurrentSeason } from "../services/season.js";
import {
  getRoundLockTime,
  getDefaultRound,
  getBaselineSquad,
  getFantasyLeaderboardEntries,
  getBudgetCap,
  saveFantasyLineup,
  autoFillFantasySquad,
  SLOT_ROLES,
  SlotRole,
  FANTASY_TOTAL_OUTFIELD,
  FANTASY_BUDGET_CAP,
  FANTASY_MIN_PRICE,
  COACH_MIN_PRICE,
  BENCH_SCORE_MULTIPLIER,
  pointsForCoachResult,
  isUnlimitedTransferRound,
  FANTASY_TRANSFERS_PER_ROUND,
  checkAndGrantFantasyRoundPoints,
  markFantasyRoundPointsSeen,
  computeFantasyGamePoints,
} from "../services/fantasyScoring.js";
import { checkAndGrantFantasyMilestones, markFantasyMilestonesSeen } from "../services/cards.js";

export const fantasyRouter = Router();

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit ?season= wins; otherwise falls back to getCurrentSeason(). */
async function resolveSeason(seasonParam: unknown): Promise<string | null> {
  if (typeof seasonParam === "string") return seasonParam;
  return getCurrentSeason();
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
      .select({
        player: players,
        team: teams,
        price: playerFantasyPrices.price,
        stats: playerSeasonStats,
        injuryStatus: playerInjuries.status,
        injuryNote: playerInjuries.note,
        injuryNoteEl: playerInjuries.noteEl,
      })
      .from(players)
      .innerJoin(teams, eq(players.teamId, teams.id))
      .leftJoin(
        playerFantasyPrices,
        and(eq(playerFantasyPrices.playerId, players.id), eq(playerFantasyPrices.season, season))
      )
      .leftJoin(playerSeasonStats, and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, season)))
      // Same admin-entered table the Injury Report page/roster badge read
      // (see schema.ts's doc comment on playerInjuries) — left join since
      // "healthy" is just "no row", not a status value.
      .leftJoin(playerInjuries, eq(playerInjuries.playerId, players.id))
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
        injury: r.injuryStatus ? { status: r.injuryStatus, note: r.injuryNote, noteEl: r.injuryNoteEl } : null,
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
      .select({ team: teams, price: coachFantasyPrices.price, imageUrl: collectibles.imageUrl })
      .from(coachFantasyPrices)
      .innerJoin(teams, eq(coachFantasyPrices.teamId, teams.id))
      // One coach collectible per team by design (expand-coach-collectibles.ts)
      // — a plain left join can't duplicate rows here, so no need to dedupe.
      .leftJoin(collectibles, and(eq(collectibles.teamId, teams.id), eq(collectibles.tier, "coach")))
      .where(eq(coachFantasyPrices.season, season));

    res.json({
      season,
      rows: rows.map((r) => ({
        team: { id: r.team.id, code: r.team.code, name: r.team.name, primaryColor: r.team.primaryColor, logoUrl: r.team.logoUrl },
        headCoach: r.team.headCoach,
        imageUrl: r.imageUrl,
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
    creditsChange: 0,
    transfersUsed: 0,
    transfersAllowed: null,
    baselinePlayerIds: null,
    budgetCap,
    newFantasyRoundPoints: null,
    newFantasyMilestoneRewards: [],
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

    let lineupRows: { playerId: string; slotRole: string; isCaptain: boolean; priceAtPick: number | null }[] = await db
      .select({
        playerId: fantasyLineups.playerId,
        slotRole: fantasyLineups.slotRole,
        isCaptain: fantasyLineups.isCaptain,
        priceAtPick: fantasyLineups.priceAtPick,
      })
      .from(fantasyLineups)
      .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round)));
    const coachPickRow = (
      await db
        .select({ teamId: fantasyCoachPicks.teamId, priceAtPick: fantasyCoachPicks.priceAtPick })
        .from(fantasyCoachPicks)
        .where(and(eq(fantasyCoachPicks.userId, req.userId!), eq(fantasyCoachPicks.season, season), eq(fantasyCoachPicks.round, round)))
        .limit(1)
    )[0];
    let coachTeamId: string | null = coachPickRow?.teamId ?? null;
    let coachPriceAtPick: number | null = coachPickRow?.priceAtPick ?? null;

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
      // Stamped with *today's* price, not carried over from whatever the
      // previous round's own priceAtPick snapshot was — this auto-seed is
      // itself a fresh "pick" for the new round, same as an explicit save
      // (see fantasy_lineups.priceAtPick's doc comment in schema.ts).
      const baselinePlayerIds = baseline.rows.map((r) => r.playerId);
      const [freshPriceRows, freshCoachPriceRows] = await Promise.all([
        baselinePlayerIds.length
          ? db
              .select({ playerId: playerFantasyPrices.playerId, price: playerFantasyPrices.price })
              .from(playerFantasyPrices)
              .where(and(eq(playerFantasyPrices.season, season), inArray(playerFantasyPrices.playerId, baselinePlayerIds)))
          : Promise.resolve([] as { playerId: string; price: number }[]),
        baseline.coachTeamId
          ? db
              .select({ price: coachFantasyPrices.price })
              .from(coachFantasyPrices)
              .where(and(eq(coachFantasyPrices.teamId, baseline.coachTeamId), eq(coachFantasyPrices.season, season)))
              .limit(1)
          : Promise.resolve([] as { price: number }[]),
      ]);
      const freshPriceByPlayerId = new Map(freshPriceRows.map((r) => [r.playerId, r.price]));
      const freshCoachPrice = freshCoachPriceRows[0]?.price ?? COACH_MIN_PRICE;

      await db.transaction(async (tx) => {
        await tx.insert(fantasyLineups).values(
          baseline.rows.map((r) => ({
            userId: req.userId!,
            season,
            round,
            playerId: r.playerId,
            slotRole: r.slotRole,
            isCaptain: r.isCaptain,
            priceAtPick: freshPriceByPlayerId.get(r.playerId) ?? FANTASY_MIN_PRICE,
          }))
        );
        if (baseline.coachTeamId) {
          await tx.insert(fantasyCoachPicks).values({
            userId: req.userId!,
            season,
            round,
            teamId: baseline.coachTeamId,
            priceAtPick: freshCoachPrice,
          });
        }
      });
      lineupRows = baseline.rows.map((r) => ({ ...r, priceAtPick: freshPriceByPlayerId.get(r.playerId) ?? FANTASY_MIN_PRICE }));
      coachTeamId = baseline.coachTeamId;
      coachPriceAtPick = baseline.coachTeamId ? freshCoachPrice : null;
    }

    const playerIds = lineupRows.map((r) => r.playerId);

    const [lockAt, playerTeamRows, roundGames, budgetCap, currentPriceRows, currentCoachPriceRows] = await Promise.all([
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
      // Current prices, to diff against each row's frozen priceAtPick for
      // the "cr gained/lost this round" recap total below.
      playerIds.length
        ? db
            .select({ playerId: playerFantasyPrices.playerId, price: playerFantasyPrices.price })
            .from(playerFantasyPrices)
            .where(and(eq(playerFantasyPrices.season, season), inArray(playerFantasyPrices.playerId, playerIds)))
        : Promise.resolve([] as { playerId: string; price: number }[]),
      coachTeamId
        ? db
            .select({ price: coachFantasyPrices.price })
            .from(coachFantasyPrices)
            .where(and(eq(coachFantasyPrices.teamId, coachTeamId), eq(coachFantasyPrices.season, season)))
            .limit(1)
        : Promise.resolve([] as { price: number }[]),
    ]);

    const teamIdByPlayer = new Map(playerTeamRows.map((p) => [p.id, p.teamId]));
    const gameByTeamId = new Map<string, (typeof roundGames)[number]>();
    for (const g of roundGames) {
      gameByTeamId.set(g.homeTeamId, g);
      gameByTeamId.set(g.awayTeamId, g);
    }

    // Per-player scoring — same rule and same real per-stat formula as
    // getFantasyLeaderboardEntries's SQL (computeFantasyGamePoints; only a
    // *final* game's real box score counts), just computed in JS here
    // since this endpoint also needs each player's own raw stat line for
    // display, not only the aggregate total that query returns. `valuation`
    // (PIR) is kept separately purely as an informational stat — it's not
    // what actually scores a round any more.
    const finalGameIds = roundGames.filter((g) => g.status === "final").map((g) => g.id);
    const statsRows =
      finalGameIds.length && playerIds.length
        ? await db
            .select({
              playerId: playerGameStats.playerId,
              gameId: playerGameStats.gameId,
              valuation: playerGameStats.valuation,
              points: playerGameStats.points,
              rebounds: playerGameStats.rebounds,
              assists: playerGameStats.assists,
              steals: playerGameStats.steals,
              turnovers: playerGameStats.turnovers,
              blocksFavour: playerGameStats.blocksFavour,
              blocksAgainst: playerGameStats.blocksAgainst,
              foulsCommitted: playerGameStats.foulsCommitted,
              foulsReceived: playerGameStats.foulsReceived,
              fieldGoalsMade2: playerGameStats.fieldGoalsMade2,
              fieldGoalsAttempted2: playerGameStats.fieldGoalsAttempted2,
              fieldGoalsMade3: playerGameStats.fieldGoalsMade3,
              fieldGoalsAttempted3: playerGameStats.fieldGoalsAttempted3,
              freeThrowsMade: playerGameStats.freeThrowsMade,
              freeThrowsAttempted: playerGameStats.freeThrowsAttempted,
            })
            .from(playerGameStats)
            .where(and(inArray(playerGameStats.playerId, playerIds), inArray(playerGameStats.gameId, finalGameIds)))
        : [];
    const statsByPlayerGame = new Map(statsRows.map((r) => [`${r.playerId}:${r.gameId}`, r]));

    const now = Date.now();
    let totalPoints = 0;
    let totalPir = 0;
    const playersOut = lineupRows.map((r) => {
      const teamId = teamIdByPlayer.get(r.playerId);
      const game = teamId ? gameByTeamId.get(teamId) : undefined;
      const tipoff = game ? new Date(game.tipoffAt) : undefined;
      const stats = game && game.status === "final" ? statsByPlayerGame.get(`${r.playerId}:${game.id}`) : undefined;
      const valuation = stats ? stats.valuation ?? 0 : game?.status === "final" ? 0 : null;
      let fantasyPoints = 0;
      if (stats && game && teamId) {
        const teamWon =
          (teamId === game.homeTeamId && (game.homeScore ?? 0) > (game.awayScore ?? 0)) ||
          (teamId === game.awayTeamId && (game.awayScore ?? 0) > (game.homeScore ?? 0));
        fantasyPoints = computeFantasyGamePoints(stats, teamWon);
      }
      const points = fantasyPoints * (r.isCaptain ? 2 : 1) * (r.slotRole === "bench" ? BENCH_SCORE_MULTIPLIER : 1);
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
      const scoreFor = (isHome ? coachGame.homeScore : coachGame.awayScore) ?? 0;
      const scoreAgainst = (isHome ? coachGame.awayScore : coachGame.homeScore) ?? 0;
      coachPoints = pointsForCoachResult(scoreFor, scoreAgainst);
    }
    totalPoints += coachPoints;

    const coachLocked = lockAt !== null && lockAt.getTime() <= now;
    const roundComplete = roundGames.length > 0 && roundGames.every((g) => g.status === "final");
    const transfersUsed = baseline ? playerIds.filter((id) => !baseline.playerIds.has(id)).length : 0;

    // Feeds the shared points economy (2026-09-16) — see
    // checkAndGrantFantasyRoundPoints's own doc comment. Only once the
    // round's actually complete, since totalPoints keeps moving for a live
    // round; safe to call on every read of an already-complete round
    // (claim-first, no-ops after the first grant).
    const newFantasyRoundPoints = roundComplete
      ? await checkAndGrantFantasyRoundPoints(req.userId!, season, round, totalPoints)
      : null;

    // FANTASY_MILESTONE_INTERVAL-completed-rounds milestone (2026-09-21,
    // services/cards.ts) — deliberately not gated on this round's own
    // roundComplete: it counts every fantasy_round_points row this user has
    // ever earned (any round, any season), so a milestone crossed while
    // browsing a different round still surfaces here, same "return every
    // unseen grant" shape as checkAndGrantFantasyRoundPoints's own return.
    const newFantasyMilestoneRewards = await checkAndGrantFantasyMilestones(req.userId!);

    // "cr gained/lost this round" (2026-09-10) — each row's current price
    // minus its own frozen priceAtPick snapshot, summed across the squad +
    // coach. A row written before priceAtPick existed (null) is skipped
    // rather than guessed at, same "missing data isn't a scoring
    // dependency" convention as everywhere else in this economy.
    const currentPriceByPlayerId = new Map(currentPriceRows.map((r) => [r.playerId, r.price]));
    let creditsChange = 0;
    for (const r of lineupRows) {
      if (r.priceAtPick == null) continue;
      creditsChange += (currentPriceByPlayerId.get(r.playerId) ?? FANTASY_MIN_PRICE) - r.priceAtPick;
    }
    if (coachTeamId && coachPriceAtPick != null) {
      creditsChange += (currentCoachPriceRows[0]?.price ?? COACH_MIN_PRICE) - coachPriceAtPick;
    }
    creditsChange = Math.round(creditsChange * 10) / 10;

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
      creditsChange,
      transfersUsed,
      transfersAllowed: baseline && !isUnlimitedTransferRound(round) ? FANTASY_TRANSFERS_PER_ROUND : null,
      budgetCap,
      newFantasyRoundPoints,
      newFantasyMilestoneRewards: newFantasyMilestoneRewards.map((p) => ({ id: p.id, packType: p.packType, tier: p.tier })),
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
    if (typeof coachTeamId !== "string" || !uuidPattern.test(coachTeamId)) {
      res.status(400).json({ error: "coachTeamId is required" });
      return;
    }
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: `Squad must contain exactly ${FANTASY_TOTAL_OUTFIELD} players` });
      return;
    }
    for (const e of entries) {
      if (typeof e?.playerId !== "string" || !uuidPattern.test(e.playerId)) {
        res.status(400).json({ error: "Each squad entry needs a valid playerId" });
        return;
      }
      if (!SLOT_ROLES.includes(e.slotRole)) {
        res.status(400).json({ error: "Each squad entry needs a valid slotRole" });
        return;
      }
    }

    const typedEntries = entries as { playerId: string; slotRole: SlotRole; isCaptain?: boolean }[];
    const result = await saveFantasyLineup(req.userId!, season, round, typedEntries, coachTeamId);
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("POST /api/fantasy/lineup/batch failed:", err);
    res.status(500).json({ error: "Failed to save lineup" });
  }
});

// Instantly drafts a real, valid, budget-respecting squad instead of
// hand-picking one in the roster builder — the whole point being to help
// a brand-new account get started (see CLAUDE.md's Fantasy Five
// simulation-button TODO, flagged 2026-09-17). Originally gated entirely
// behind requireAdmin, which defeated that purpose: a genuinely fresh
// test account (not itself an admin) could never reach this route at all,
// reported live 2026-09-17 as "brand new account can't use the randomize
// squad." Fixed by only requiring admin when the caller asks to auto-fill
// *someone else's* squad (the `userId` override, for an admin setting up
// a test account from their own session) — auto-filling your own squad
// needs nothing beyond being logged in, same as a normal manual save.
// `season`/`round` default to the current season's active round.
// Delegates to autoFillFantasySquad/saveFantasyLineup, so the result is
// never a special-cased shortcut — it's exactly what a real save would
// accept.
fantasyRouter.post("/admin/auto-fill", requireAuth, async (req, res) => {
  try {
    const targetUserId = typeof req.body?.userId === "string" && uuidPattern.test(req.body.userId) ? req.body.userId : req.userId!;
    if (targetUserId !== req.userId!) {
      const [caller] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, req.userId!)).limit(1);
      if (!caller?.isAdmin) {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
    }
    const season = await resolveSeason(req.body?.season);
    if (!season) {
      res.status(400).json({ error: "No current season to auto-fill for" });
      return;
    }
    const round = typeof req.body?.round === "number" ? req.body.round : await getDefaultRound(season);
    if (round === null) {
      res.status(400).json({ error: "No round to auto-fill for" });
      return;
    }
    const result = await autoFillFantasySquad(targetUserId, season, round);
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.json({ ok: true, userId: targetUserId, season, round });
  } catch (err) {
    console.error("POST /api/fantasy/admin/auto-fill failed:", err);
    res.status(500).json({ error: "Failed to auto-fill fantasy squad" });
  }
});

// Global season leaderboard — a league-scoped version lives at
// GET /leagues/:id/fantasy-leaderboard (routes/leagues.ts), sharing
// getFantasyLeaderboardEntries the same way the points leaderboard is
// Same pattern as predictions.ts's round-rewards/ack — marks any
// currently-unseen fantasy-round-points grant as seen once the frontend's
// shown its "+N points" banner for it.
fantasyRouter.post("/round-points/ack", requireAuth, async (req, res) => {
  try {
    await markFantasyRoundPointsSeen(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/fantasy/round-points/ack failed:", err);
    res.status(500).json({ error: "Failed to acknowledge fantasy round points" });
  }
});

// Same pattern again, for the Fantasy Five completed-rounds milestone track
// — see checkAndGrantFantasyMilestones (services/cards.ts).
fantasyRouter.post("/milestone-rewards/ack", requireAuth, async (req, res) => {
  try {
    await markFantasyMilestonesSeen(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/fantasy/milestone-rewards/ack failed:", err);
    res.status(500).json({ error: "Failed to acknowledge fantasy milestone rewards" });
  }
});

// shared between the global and league-scoped routes.
fantasyRouter.get("/leaderboard", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json([]);
      return;
    }
    const round = req.query.round ? Number(req.query.round) : undefined;
    const pirRound = await getDefaultRound(season);
    const roundLockAt = pirRound != null ? await getRoundLockTime(season, pirRound) : null;
    const revealSquads = roundLockAt !== null && roundLockAt.getTime() <= Date.now();
    const entries = await getFantasyLeaderboardEntries({ season, round, pirRound, revealSquads });
    res.json(entries);
  } catch (err) {
    console.error("GET /api/fantasy/leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load fantasy leaderboard" });
  }
});
