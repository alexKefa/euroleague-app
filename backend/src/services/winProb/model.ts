/**
 * Win-probability math (2026-10-07,
 * docs/superpowers/specs/2026-10-07-win-probability-design.md). Pure, no DB:
 * checked by src/scripts/check-win-prob.ts.
 *
 * The score margin is modelled as a random walk to the final buzzer:
 *   WP_home = Φ( (m + μ·s/2400) / (σ·√(s/2400)) )
 * m = home − away, s = seconds left, μ = pre-game expected margin
 * (σ·Φ⁻¹(p0)), σ = spread of final margins around expectation.
 */

const REGULATION_SECONDS = 2400;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Keeps a pre-game probability usable for Φ⁻¹ (a bad odds row can say 0 or 1). */
export function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.99, Math.max(0.01, p));
}

export function eloProb(rHome: number, rAway: number, homeEdge: number): number {
  return 1 / (1 + 10 ** (-(rHome + homeEdge - rAway) / 400));
}

export function expectedMargin(p0: number, sigma: number): number {
  return sigma * normInv(clampProb(p0));
}

/** Seconds left in the game: regulation counts all remaining quarters; overtime only its own clock. */
export function secondsLeft(period: number, clock: number): number {
  return period <= 4 ? (4 - period) * 600 + clock : clock;
}

export function winProb(margin: number, sLeft: number, mu: number, sigma: number): number {
  if (sLeft <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const frac = sLeft / REGULATION_SECONDS;
  return normCdf((margin + mu * frac) / (sigma * Math.sqrt(frac)));
}

export interface WpEvent {
  orderIdx: number;
  period: number;
  clockSeconds: number | null;
  homeScoreBefore: number;
  awayScoreBefore: number;
  points: number;
  teamId: string | null;
  playType: string;
  playerCode: string | null;
}

export interface CurvePoint {
  period: number;
  clock: number;
  s: number;
  homeScore: number;
  awayScore: number;
  homeProb: number;
  /** The scoring play that produced this point, when it was one. */
  event: WpEvent | null;
}

/** One point per event with a clock (plus the tip-off point), in game order. */
export function buildCurve(events: WpEvent[], homeTeamId: string, p0: number, sigma: number): CurvePoint[] {
  const mu = expectedMargin(p0, sigma);
  const points: CurvePoint[] = [{ period: 1, clock: 600, s: REGULATION_SECONDS, homeScore: 0, awayScore: 0, homeProb: clampProb(p0), event: null }];
  const sorted = [...events].sort((x, y) => x.orderIdx - y.orderIdx);
  for (const e of sorted) {
    if (e.clockSeconds === null || e.clockSeconds === undefined) continue;
    const home = e.homeScoreBefore + (e.teamId === homeTeamId ? e.points : 0);
    const away = e.awayScoreBefore + (e.teamId !== null && e.teamId !== homeTeamId ? e.points : 0);
    const s = secondsLeft(e.period, e.clockSeconds);
    // Keep time moving forward even if the feed's clock wobbles.
    const prev = points[points.length - 1];
    const sClamped = Math.min(s, prev.s);
    points.push({
      period: e.period,
      clock: e.clockSeconds,
      s: sClamped,
      homeScore: home,
      awayScore: away,
      homeProb: winProb(home - away, sClamped, mu, sigma),
      event: e.points > 0 ? e : null,
    });
  }
  return points;
}

export interface Swing {
  period: number;
  clock: number;
  homeProbBefore: number;
  homeProbAfter: number;
  event: WpEvent | null;
}

/** The n largest changes between consecutive points that came from a scoring play. */
export function biggestSwings(points: CurvePoint[], n: number): Swing[] {
  const swings: Swing[] = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (!p.event) continue;
    swings.push({ period: p.period, clock: p.clock, homeProbBefore: points[i - 1].homeProb, homeProbAfter: p.homeProb, event: p.event });
  }
  return swings.sort((a, b) => Math.abs(b.homeProbAfter - b.homeProbBefore) - Math.abs(a.homeProbAfter - a.homeProbBefore)).slice(0, n);
}
