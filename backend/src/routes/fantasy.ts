import { Router } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  fantasyPriceChangeLog,
  fantasyCoachPriceChangeLog,
  fantasyRoundPoints,
  fantasyChips,
} from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { getCurrentSeason } from "../services/season.js";
import {
  getRoundLockTime,
  getDefaultRound,
  isRoundPriced,
  getRoundPricedState,
  getBaselineSquad,
  getFantasyLeaderboardEntries,
  getUserBudget,
  getOwnedPriceMoves,
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
  FULL_TIMEOUT_CHIP,
  getFullTimeoutRound,
  checkAndGrantFantasyRoundPoints,
  markFantasyRoundPointsSeen,
  computeFantasyGamePoints,
} from "../services/fantasyScoring.js";
import { getFantasyPlayerCard } from "../services/fantasyPlayerCard.js";
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
// Player card for the roster builder's player popup (2026-10-01) — see
// services/fantasyPlayerCard.ts.
fantasyRouter.get("/players/:id/card", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season || !uuidPattern.test(req.params.id)) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    const card = await getFantasyPlayerCard(req.params.id, season);
    if (!card) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.json(card);
  } catch (err) {
    console.error("GET /api/fantasy/players/:id/card failed:", err);
    res.status(500).json({ error: "Failed to load player card" });
  }
});

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
      // Only teams actually in this season's competition (2026-09-25, "remove
      // monaco... should not be there on dropdown of fantasy") — same scoping
      // GET /teams already applies. A club that dropped out (AS Monaco for
      // 2026-27) keeps its `teams` row and any still-`active` players (roster
      // sync never gets a fresh fetch for them to deactivate), so without
      // this its players stayed pickable and it showed in the team filter.
      .where(
        and(
          eq(players.active, true),
          sql`exists (select 1 from ${games} where ${games.season} = ${season} and (${games.homeTeamId} = ${teams.id} or ${games.awayTeamId} = ${teams.id}))`
        )
      );

    // Most recent daily reprice delta per player (2026-09-22) — surfaces the
    // same fantasyDailyReprice.ts move the pool/court never showed before,
    // via the standard Postgres DISTINCT ON "latest row per group" idiom
    // (same pattern scripts/reprice-fantasy-players.ts already uses). Scoped
    // to this season's games so a carried-over row from a prior season never
    // gets picked up as "today's" move.
    const trendRows = await db.execute<{ player_id: string; delta: number }>(sql`
      select distinct on (${fantasyPriceChangeLog.playerId}) ${fantasyPriceChangeLog.playerId} as player_id, ${fantasyPriceChangeLog.delta} as delta
      from ${fantasyPriceChangeLog}
      join ${games} on ${games.id} = ${fantasyPriceChangeLog.gameId}
      where ${games.season} = ${season}
      order by ${fantasyPriceChangeLog.playerId}, ${fantasyPriceChangeLog.appliedAt} desc
    `);
    const trendByPlayerId = new Map(trendRows.map((r) => [r.player_id, r.delta]));

    res.json({
      season,
      rows: rows.map((r) => ({
        player: { id: r.player.id, name: r.player.name, position: r.player.position, photoUrl: r.player.photoUrl },
        team: { id: r.team.id, code: r.team.code, name: r.team.name, primaryColor: r.team.primaryColor, logoUrl: r.team.logoUrl },
        price: r.price ?? FANTASY_MIN_PRICE,
        priceTrend: trendByPlayerId.get(r.player.id) ?? null,
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

    // Same latest-delta trend as /players above, keyed on team instead of
    // player (a coach's daily move comes from fantasyCoachPriceChangeLog).
    const trendRows = await db.execute<{ team_id: string; delta: number }>(sql`
      select distinct on (${fantasyCoachPriceChangeLog.teamId}) ${fantasyCoachPriceChangeLog.teamId} as team_id, ${fantasyCoachPriceChangeLog.delta} as delta
      from ${fantasyCoachPriceChangeLog}
      join ${games} on ${games.id} = ${fantasyCoachPriceChangeLog.gameId}
      where ${games.season} = ${season}
      order by ${fantasyCoachPriceChangeLog.teamId}, ${fantasyCoachPriceChangeLog.appliedAt} desc
    `);
    const trendByTeamId = new Map(trendRows.map((r) => [r.team_id, r.delta]));

    res.json({
      season,
      rows: rows.map((r) => ({
        team: { id: r.team.id, code: r.team.code, name: r.team.name, primaryColor: r.team.primaryColor, logoUrl: r.team.logoUrl },
        headCoach: r.team.headCoach,
        imageUrl: r.imageUrl,
        price: r.price ?? COACH_MIN_PRICE,
        priceTrend: trendByTeamId.get(r.team.id) ?? null,
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
    creditsSettled: false,
    budgetPending: false,
    transfersUsed: 0,
    transfersAllowed: null,
    baselinePlayerIds: null,
    baselineSquad: null,
    fullTimeoutRound: null,
    fullTimeoutAvailable: false,
    budgetCap,
    newFantasyRoundPoints: null,
    roundRecap: null,
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
    // Never past the open round: the next one stays hidden until the
    // previous round's credits land (getDefaultRound).
    const requested = req.query.round ? Number(req.query.round) : defaultRound;
    const round = requested !== null && defaultRound !== null && requested > defaultRound ? defaultRound : requested;
    if (round === null || Number.isNaN(round)) {
      res.json(emptyLineupResponse(season, defaultRound));
      return;
    }

    const baseline = await getBaselineSquad(req.userId!, season, round);
    const fullTimeoutRound = await getFullTimeoutRound(req.userId!, season);
    const unlimitedTransfers = isUnlimitedTransferRound(round) || fullTimeoutRound === round;

    let lineupRows: { playerId: string; slotRole: string; isCaptain: boolean; playedAsCaptain: boolean; priceAtPick: number | null }[] = await db
      .select({
        playerId: fantasyLineups.playerId,
        slotRole: fantasyLineups.slotRole,
        isCaptain: fantasyLineups.isCaptain,
        playedAsCaptain: fantasyLineups.playedAsCaptain,
        priceAtPick: fantasyLineups.priceAtPick,
      })
      .from(fantasyLineups)
      .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round)));
    const coachPickRow = (
      await db
        .select({ teamId: fantasyCoachPicks.teamId })
        .from(fantasyCoachPicks)
        .where(and(eq(fantasyCoachPicks.userId, req.userId!), eq(fantasyCoachPicks.season, season), eq(fantasyCoachPicks.round, round)))
        .limit(1)
    )[0];
    let coachTeamId: string | null = coachPickRow?.teamId ?? null;

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
      lineupRows = baseline.rows.map((r) => ({ ...r, playedAsCaptain: false, priceAtPick: freshPriceByPlayerId.get(r.playerId) ?? FANTASY_MIN_PRICE }));
      coachTeamId = baseline.coachTeamId;
    }

    const playerIds = lineupRows.map((r) => r.playerId);

    const [lockAt, playerTeamRows, roundGames, budgetCap, creditsChange, pricedState] = await Promise.all([
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
      getUserBudget(req.userId!, season, round),
      // "cr gained/lost this round" — the same game-driven price moves the
      // budget is built from, so the two can never disagree (was current
      // price minus priceAtPick, which also counted the 2026-09-24 re-pricing).
      getOwnedPriceMoves(req.userId!, season, { round }),
      // Credits move once per round, ~3h after its last game (see
      // fantasyDailyReprice.ts's PRICE_SETTLE_MS); until then the UI says
      // "pending" instead of a misleading 0. The previous round's state
      // marks budgetCap as provisional until its moves land.
      getRoundPricedState(season, round),
    ]);
    const creditsSettled = pricedState.priced;
    const budgetPending = !pricedState.previousPriced;

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
        playedAsCaptain: r.playedAsCaptain,
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

    // One-time recap of the latest finished round the user hasn't seen yet
    // (2026-09-29), whichever round this request is viewing. Grants now land
    // server-side (services/fantasyRoundSweep.ts), so the first visit after
    // a round ends is usually on the *next* round; this is what shows it.
    let roundRecap: { round: number; points: number; fantasyPoints: number; creditsChange: number; creditsSettled: boolean } | null = null;
    if (newFantasyRoundPoints) {
      roundRecap = { round, points: newFantasyRoundPoints.points, fantasyPoints: totalPoints, creditsChange, creditsSettled };
    } else {
      const [unseen] = await db
        .select({ round: fantasyRoundPoints.round, points: fantasyRoundPoints.points })
        .from(fantasyRoundPoints)
        .where(and(eq(fantasyRoundPoints.userId, req.userId!), eq(fantasyRoundPoints.season, season), isNull(fantasyRoundPoints.seenAt)))
        .orderBy(desc(fantasyRoundPoints.round))
        .limit(1);
      if (unseen) {
        const [entries, recapCredits, recapSettled] = await Promise.all([
          getFantasyLeaderboardEntries({ season, round: unseen.round, userIds: [req.userId!], includeAdmins: true }),
          getOwnedPriceMoves(req.userId!, season, { round: unseen.round }),
          isRoundPriced(season, unseen.round),
        ]);
        roundRecap = {
          round: unseen.round,
          points: unseen.points,
          fantasyPoints: entries[0]?.fantasyPoints ?? unseen.points * 2,
          creditsChange: recapCredits,
          creditsSettled: recapSettled,
        };
      }
    }

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
      creditsSettled,
      budgetPending,
      transfersUsed,
      transfersAllowed: baseline && !unlimitedTransfers ? FANTASY_TRANSFERS_PER_ROUND : null,
      // Full Timeout chip: the round it was played on this season (null =
      // unused), and whether it can be played on this round right now —
      // the open round, before lock, with a capped transfer window to lift.
      fullTimeoutRound,
      fullTimeoutAvailable: fullTimeoutRound === null && !!baseline && !unlimitedTransfers && round === defaultRound && !coachLocked,
      budgetCap,
      newFantasyRoundPoints,
      roundRecap,
      newFantasyMilestoneRewards: newFantasyMilestoneRewards.map((p) => ({ id: p.id, packType: p.packType, tier: p.tier })),
      // The client-side mirror of the transfer-limit check above — lets the
      // roster builder disable adding a *new* (non-baseline) player once
      // the limit's already spent, the same pre-emptive-gating pattern the
      // position quota already uses, rather than only discovering the
      // violation from a rejected save.
      baselinePlayerIds: baseline ? [...baseline.playerIds] : null,
      // The squad as the round started (last round's), for the roster
      // builder's "Reset to round start" (2026-10-05).
      baselineSquad: baseline ? { players: baseline.rows, coachTeamId: baseline.coachTeamId } : null,
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
// Exception (2026-09-25): once the round has tipped off, a save is still
// accepted as a *substitution-only* change while any of the round's games
// is still to come — same 10 players and coach, only not-yet-played
// players may change slotRole/captaincy. See saveMidRoundSubstitutions.
fantasyRouter.post("/lineup/batch", requireAuth, async (req, res) => {
  try {
    const { season, round, players: entries, coachTeamId } = req.body ?? {};
    if (typeof season !== "string" || typeof round !== "number" || !Number.isInteger(round)) {
      res.status(400).json({ error: "season and round are required" });
      return;
    }
    const openRound = await getDefaultRound(season);
    if (openRound !== null && round > openRound) {
      res.status(400).json({ error: "This round isn't open yet", code: "ROUND_NOT_OPEN" });
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

// Full Timeout chip (2026-10-07): once a season, lift the transfer cap for
// the open round. Cancellable until the round locks, as long as the saved
// squad is back within FANTASY_TRANSFERS_PER_ROUND changes of the baseline
// (otherwise cancelling would leave an illegal saved squad behind).
async function fullTimeoutRoundCheck(season: unknown, round: unknown): Promise<{ season: string; round: number } | { error: string; code?: string }> {
  if (typeof season !== "string" || typeof round !== "number" || !Number.isInteger(round)) {
    return { error: "season and round are required" };
  }
  if (round !== (await getDefaultRound(season))) {
    return { error: "Full Timeout can only be used on the open round", code: "ROUND_NOT_OPEN" };
  }
  const lockAt = await getRoundLockTime(season, round);
  if (lockAt === null || lockAt.getTime() <= Date.now()) {
    return { error: "This round has already locked", code: "ROUND_LOCKED" };
  }
  return { season, round };
}

fantasyRouter.post("/chips/full-timeout", requireAuth, async (req, res) => {
  try {
    const check = await fullTimeoutRoundCheck(req.body?.season, req.body?.round);
    if ("error" in check) {
      res.status(400).json(check);
      return;
    }
    const { season, round } = check;
    if (isUnlimitedTransferRound(round) || !(await getBaselineSquad(req.userId!, season, round))) {
      res.status(400).json({ error: "Transfers are already unlimited this round", code: "ALREADY_UNLIMITED" });
      return;
    }
    const inserted = await db
      .insert(fantasyChips)
      .values({ userId: req.userId!, season, chip: FULL_TIMEOUT_CHIP, round })
      .onConflictDoNothing()
      .returning({ id: fantasyChips.id });
    if (inserted.length === 0) {
      res.status(409).json({ error: "Full Timeout has already been used this season", code: "CHIP_USED" });
      return;
    }
    res.json({ ok: true, fullTimeoutRound: round });
  } catch (err) {
    console.error("POST /api/fantasy/chips/full-timeout failed:", err);
    res.status(500).json({ error: "Failed to use Full Timeout" });
  }
});

fantasyRouter.post("/chips/full-timeout/cancel", requireAuth, async (req, res) => {
  try {
    const check = await fullTimeoutRoundCheck(req.body?.season, req.body?.round);
    if ("error" in check) {
      res.status(400).json(check);
      return;
    }
    const { season, round } = check;
    const [baseline, savedRows] = await Promise.all([
      getBaselineSquad(req.userId!, season, round),
      db
        .select({ playerId: fantasyLineups.playerId })
        .from(fantasyLineups)
        .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round))),
    ]);
    const transfersUsed = baseline ? savedRows.filter((r) => !baseline.playerIds.has(r.playerId)).length : 0;
    if (transfersUsed > FANTASY_TRANSFERS_PER_ROUND) {
      res.status(400).json({
        error: `Your saved squad has ${transfersUsed} changes — get it back to ${FANTASY_TRANSFERS_PER_ROUND} or fewer before cancelling`,
        code: "CHIP_CANCEL_TOO_MANY",
        transfersUsed,
        transfersAllowed: FANTASY_TRANSFERS_PER_ROUND,
      });
      return;
    }
    const deleted = await db
      .delete(fantasyChips)
      .where(
        and(
          eq(fantasyChips.userId, req.userId!),
          eq(fantasyChips.season, season),
          eq(fantasyChips.chip, FULL_TIMEOUT_CHIP),
          eq(fantasyChips.round, round)
        )
      )
      .returning({ id: fantasyChips.id });
    if (deleted.length === 0) {
      res.status(400).json({ error: "Full Timeout isn't active this round", code: "CHIP_NOT_ACTIVE" });
      return;
    }
    res.json({ ok: true, fullTimeoutRound: null });
  } catch (err) {
    console.error("POST /api/fantasy/chips/full-timeout/cancel failed:", err);
    res.status(500).json({ error: "Failed to cancel Full Timeout" });
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
