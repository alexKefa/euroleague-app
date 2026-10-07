// Fits the win-probability constants and inserts a new active wp_model row
// (2026-10-07, services/winProb/). Run from backend/:
//   npx tsx src/scripts/fit-win-prob.ts [fitSeason]      (default: the latest season with 300+ finals)
// Elo K and home edge: grid search minimising log loss of game results.
// sigma: maximum likelihood of final margins given the Elo expectation.
// When the fit season has play-by-play, also prints in-game calibration
// (Brier score + 10-bucket reliability) of the formula model.
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, pbpEvents, wpModel } from "../db/schema.js";
import { loadEloGames, replayElo } from "../services/winProb/elo.js";
import { buildCurve, clampProb, normInv } from "../services/winProb/model.js";

async function pickSeason(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;
  const rows = await db
    .select({ season: games.season, n: sql<number>`count(*)::int` })
    .from(games)
    .where(eq(games.status, "final"))
    .groupBy(games.season);
  const full = rows.filter((r) => r.n >= 300).map((r) => r.season).sort();
  if (!full.length) throw new Error("No season with 300+ final games to fit on");
  return full[full.length - 1];
}

const logLoss = (p: number, y: number) => -(y * Math.log(clampProb(p)) + (1 - y) * Math.log(1 - clampProb(p)));

async function main() {
  const season = await pickSeason();
  const rows = await loadEloGames([season]);
  console.log(`fit season ${season}: ${rows.length} final games`);
  const result = (g: (typeof rows)[number]) => (g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5);

  // Skip the first 40 games when scoring: every rating starts at 1500 there.
  const scored = rows.slice(40);
  let best = { k: 20, h: 50, loss: Infinity };
  for (let k = 8; k <= 48; k += 2) {
    for (let h = 0; h <= 120; h += 5) {
      const { preProbByGame } = replayElo(rows, k, h);
      const loss = scored.reduce((t, g) => t + logLoss(preProbByGame.get(g.id)!, result(g)), 0) / scored.length;
      if (loss < best.loss) best = { k, h, loss };
    }
  }
  const { preProbByGame } = replayElo(rows, best.k, best.h);
  const brier = scored.reduce((t, g) => t + (preProbByGame.get(g.id)! - result(g)) ** 2, 0) / scored.length;
  console.log(`Elo: K=${best.k} home=${best.h}  pre-game log loss ${best.loss.toFixed(4)}  Brier ${brier.toFixed(4)}`);

  // sigma: maximise sum log N(margin; sigma*z, sigma) where z = Φ⁻¹(p_elo).
  let bestSigma = { sigma: 12, ll: -Infinity };
  for (let sigma = 6; sigma <= 22; sigma += 0.25) {
    let ll = 0;
    for (const g of scored) {
      const mu = sigma * normInv(clampProb(preProbByGame.get(g.id)!));
      const z = (g.homeScore - g.awayScore - mu) / sigma;
      ll += -0.5 * z * z - Math.log(sigma);
    }
    if (ll > bestSigma.ll) bestSigma = { sigma, ll };
  }
  console.log(`sigma=${bestSigma.sigma}`);

  // In-game calibration when this season has play-by-play.
  const withPbp = await db.selectDistinct({ gameId: pbpEvents.gameId }).from(pbpEvents).where(eq(pbpEvents.season, season));
  if (withPbp.length) {
    const ids = new Set(withPbp.map((r) => r.gameId));
    const buckets = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
    let bsum = 0;
    let bn = 0;
    for (const g of rows.filter((r) => ids.has(r.id))) {
      const ev = await db
        .select({ orderIdx: pbpEvents.orderIdx, period: pbpEvents.period, clockSeconds: pbpEvents.clockSeconds, homeScoreBefore: pbpEvents.homeScoreBefore, awayScoreBefore: pbpEvents.awayScoreBefore, points: pbpEvents.points, teamId: pbpEvents.teamId, playType: pbpEvents.playType, playerCode: pbpEvents.playerCode })
        .from(pbpEvents)
        .where(eq(pbpEvents.gameId, g.id))
        .orderBy(asc(pbpEvents.orderIdx));
      const y = result(g);
      for (const p of buildCurve(ev, g.homeTeamId, preProbByGame.get(g.id)!, bestSigma.sigma)) {
        const b = buckets[Math.min(9, Math.floor(p.homeProb * 10))];
        b.n++;
        b.p += p.homeProb;
        b.y += y;
        bsum += (p.homeProb - y) ** 2;
        bn++;
      }
    }
    console.log(`in-game: ${ids.size} games, ${bn} points, Brier ${(bsum / bn).toFixed(4)}`);
    console.log("bucket  predicted  actual   n");
    buckets.forEach((b, i) => b.n && console.log(`${i * 10}-${i * 10 + 10}%   ${((b.p / b.n) * 100).toFixed(1).padStart(5)}%   ${((b.y / b.n) * 100).toFixed(1).padStart(5)}%  ${b.n}`));
  } else {
    console.log("in-game calibration: no play-by-play for this season yet (run scripts/backfill-pbp.ts)");
  }

  const [last] = await db.select({ version: wpModel.version }).from(wpModel).orderBy(desc(wpModel.version)).limit(1);
  const version = (last?.version ?? 0) + 1;
  await db.transaction(async (tx) => {
    await tx.update(wpModel).set({ active: false }).where(eq(wpModel.active, true));
    await tx.insert(wpModel).values({ version, sigma: bestSigma.sigma, eloK: best.k, eloHome: best.h, active: true, note: `fit on ${season}, ${rows.length} games` });
  });
  console.log(`wp_model v${version} active`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
