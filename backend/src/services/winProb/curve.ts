import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { games, pbpEvents, players } from "../../db/schema.js";
import { getLivePoints } from "./live.js";
import { biggestSwings, buildCurve } from "./model.js";
import { PreGame, activeModel, preGameProbs } from "./pregame.js";

export interface WpPoint {
  period: number;
  clock: number;
  s: number;
  homeScore: number;
  awayScore: number;
  homeProb: number;
}

export interface WpSwing {
  period: number;
  clock: number;
  homeProbBefore: number;
  homeProbAfter: number;
  teamId: string | null;
  playerName: string | null;
  playType: string;
}

export interface GameWinProb {
  status: string;
  pre: PreGame | null;
  points: WpPoint[];
  swings: WpSwing[];
  fromPlayByPlay: boolean;
}

const round = (p: number) => Math.round(p * 10000) / 10000;

// A final game's curve never changes once its play-by-play is in.
const finalCache = new Map<string, { points: WpPoint[]; swings: WpSwing[] }>();

async function curveFromPlayByPlay(gameId: string, homeTeamId: string, p0: number, sigma: number) {
  const cached = finalCache.get(gameId);
  if (cached) return cached;
  const rows = await db
    .select({
      orderIdx: pbpEvents.orderIdx,
      period: pbpEvents.period,
      clockSeconds: pbpEvents.clockSeconds,
      homeScoreBefore: pbpEvents.homeScoreBefore,
      awayScoreBefore: pbpEvents.awayScoreBefore,
      points: pbpEvents.points,
      teamId: pbpEvents.teamId,
      playType: pbpEvents.playType,
      playerCode: pbpEvents.playerCode,
    })
    .from(pbpEvents)
    .where(eq(pbpEvents.gameId, gameId))
    .orderBy(asc(pbpEvents.orderIdx));
  if (!rows.length) return null;

  const curve = buildCurve(rows, homeTeamId, p0, sigma);
  const top = biggestSwings(curve, 3);
  const codes = [...new Set(top.map((s) => s.event?.playerCode).filter((c): c is string => !!c))];
  const names = codes.length
    ? new Map((await db.select({ code: players.code, name: players.name }).from(players).where(inArray(players.code, codes))).map((p) => [p.code, p.name]))
    : new Map<string, string>();

  const result = {
    points: curve.map((p) => ({ period: p.period, clock: p.clock, s: p.s, homeScore: p.homeScore, awayScore: p.awayScore, homeProb: round(p.homeProb) })),
    swings: top.map((s) => ({
      period: s.period,
      clock: s.clock,
      homeProbBefore: round(s.homeProbBefore),
      homeProbAfter: round(s.homeProbAfter),
      teamId: s.event?.teamId ?? null,
      playerName: (s.event?.playerCode && names.get(s.event.playerCode)) || null,
      playType: s.event?.playType ?? "",
    })),
  };
  finalCache.set(gameId, result);
  return result;
}

/** Everything the game page's win-probability card needs, for one game. */
export async function gameWinProb(gameId: string): Promise<GameWinProb | null> {
  const [game] = await db
    .select({ id: games.id, season: games.season, status: games.status, homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) return null;
  const model = await activeModel();
  if (!model) return { status: game.status, pre: null, points: [], swings: [], fromPlayByPlay: false };

  const pre = (await preGameProbs([game], model)).get(game.id)!;
  const start: WpPoint = { period: 1, clock: 600, s: 2400, homeScore: 0, awayScore: 0, homeProb: round(pre.homeProb) };

  if (game.status === "final") {
    const fromPbp = await curveFromPlayByPlay(game.id, game.homeTeamId, pre.homeProb, model.sigma);
    if (fromPbp) return { status: game.status, pre, ...fromPbp, fromPlayByPlay: true };
  }
  const livePoints = game.status === "scheduled" ? [] : [start, ...getLivePoints(game.id)];
  return { status: game.status, pre, points: livePoints, swings: [], fromPlayByPlay: false };
}
