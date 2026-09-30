import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerSeasonStats } from "../db/schema.js";
import { getCurrentSeason } from "./season.js";
import { normalizePlayerName } from "./battles.js";

// ---------------------------------------------------------------------------
// Stat duel (battles v4, 2026-09-30, direct request: "should we change
// concept of coin flip? to something more skill based?"). Replaces the
// weighted coin flip (services/battles.ts's power score) for every new
// battle; that code stays only to display battles resolved under v3.
//
// Each side picks a card and one stat category. The challenger's category
// stays hidden from the opponent until the duel resolves; the opponent picks
// knowing the challenger's card. Best of three categories: both picks plus
// one random tiebreaker (two random ones if both picked the same stat), each
// won by the higher real per-game season stat. Skill is in the pairing: pick
// a card that's strong where the other card is weak, and guess what the
// other side will go for. Rarity and foil still help, as a small multiplier
// rather than a flat power floor, so a well-matched common can beat a
// legendary in the right category.
// ---------------------------------------------------------------------------

export const DUEL_STATS = ["points", "rebounds", "assists", "steals", "blocks", "pir"] as const;
export type DuelStat = (typeof DUEL_STATS)[number];

export function isDuelStat(value: unknown): value is DuelStat {
  return typeof value === "string" && (DUEL_STATS as readonly string[]).includes(value);
}

// Applied to every stat of the card. Foil replaces the legendary multiplier.
const TIER_MULTIPLIER: Record<string, number> = { common: 1, rare: 1.05, legendary: 1.1 };
export const FOIL_MULTIPLIER = 1.15;

export function multiplierFor(tier: string, finish?: string | null): number {
  if (finish === "foil") return FOIL_MULTIPLIER;
  return TIER_MULTIPLIER[tier] ?? 1;
}

export type StatLine = Record<DuelStat, number>;

export interface CardStatLine {
  // Real per-game numbers (current season, else a games-weighted career
  // average) — what the UI shows as the player's stats.
  raw: StatLine;
  multiplier: number;
  // raw * multiplier, one decimal — what the duel actually compares.
  boosted: StatLine;
}

const EMPTY_LINE: StatLine = { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, pir: 0 };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// "2026-27" -> "2025-26".
function previousSeason(season: string): string {
  const start = Number(season.slice(0, 4));
  if (!Number.isFinite(start)) return season;
  return `${start - 1}-${String(start % 100).padStart(2, "0")}`;
}

type StatRow ={ team_id: string; name: string } & Record<DuelStat, number | null>;

/**
 * Stat lines for a batch of cards, in input order, in one round trip. Cards
 * map to players by team + normalized name (collectibles carry no player
 * id), same key as the v3 power lookup. No synced stats means all zeros.
 */
export async function getCardStatLines(
  cards: { teamId: string; name: string; tier: string; finish?: string | null }[]
): Promise<CardStatLine[]> {
  const teamIds = [...new Set(cards.map((c) => c.teamId))];
  const lookup = new Map<string, StatLine>();
  if (teamIds.length > 0) {
    const season = (await getCurrentSeason()) ?? "__none__";
    const teamList = sql.join(
      teamIds.map((id) => sql`${id}`),
      sql`, `
    );
    // This season and last, weighted by games played: two games into a
    // season, most steals/blocks averages are still 0, so last season
    // carries it early and this season takes over as games pile up.
    // Players with neither fall back to a games-weighted career average.
    const recent = sql`s.season in (${season}, ${previousSeason(season)})`;
    const avg = (col: string, onlyRecent: boolean) => {
      const value = sql.raw(`s.${col} * s.games_played`);
      const games = sql.raw("s.games_played");
      return onlyRecent
        ? sql`sum(case when ${recent} then ${value} end) / nullif(sum(case when ${recent} then ${games} end), 0)`
        : sql`sum(${value}) / nullif(sum(${games}), 0)`;
    };
    const rows = await db.execute<StatRow>(sql`
      select p.team_id, p.name,
        coalesce(${avg("points_per_game", true)}, ${avg("points_per_game", false)}) as points,
        coalesce(${avg("rebounds_per_game", true)}, ${avg("rebounds_per_game", false)}) as rebounds,
        coalesce(${avg("assists_per_game", true)}, ${avg("assists_per_game", false)}) as assists,
        coalesce(${avg("steals_per_game", true)}, ${avg("steals_per_game", false)}) as steals,
        coalesce(${avg("blocks_per_game", true)}, ${avg("blocks_per_game", false)}) as blocks,
        coalesce(${avg("valuation", true)}, ${avg("valuation", false)}) as pir
      from ${players} p
      left join ${playerSeasonStats} s on s.player_id = p.id
      where p.team_id in (${teamList})
      group by p.id, p.team_id, p.name
    `);
    for (const r of rows) {
      lookup.set(`${r.team_id}|${normalizePlayerName(r.name)}`, {
        points: round1(Number(r.points ?? 0)),
        rebounds: round1(Number(r.rebounds ?? 0)),
        assists: round1(Number(r.assists ?? 0)),
        steals: round1(Number(r.steals ?? 0)),
        blocks: round1(Number(r.blocks ?? 0)),
        pir: round1(Number(r.pir ?? 0)),
      });
    }
  }
  return cards.map((c) => {
    const raw = lookup.get(`${c.teamId}|${normalizePlayerName(c.name)}`) ?? EMPTY_LINE;
    const multiplier = multiplierFor(c.tier, c.finish);
    const boosted = Object.fromEntries(DUEL_STATS.map((s) => [s, round1(raw[s] * multiplier)])) as StatLine;
    return { raw, multiplier, boosted };
  });
}

export interface DuelRound {
  stat: DuelStat;
  // Who put this category in play: one side's pick, both, or the random draw.
  source: "challenger" | "opponent" | "both" | "random";
  challengerValue: number;
  opponentValue: number;
  winner: "challenger" | "opponent";
}

// A tied category goes to the higher PIR, then to the challenger (who
// committed first, blind).
function roundWinner(stat: DuelStat, c: StatLine, o: StatLine): "challenger" | "opponent" {
  if (c[stat] !== o[stat]) return c[stat] > o[stat] ? "challenger" : "opponent";
  if (c.pir !== o.pir) return c.pir > o.pir ? "challenger" : "opponent";
  return "challenger";
}

function buildRounds(challengerStat: DuelStat, opponentStat: DuelStat, randomStats: DuelStat[], c: StatLine, o: StatLine): DuelRound[] {
  const picked: { stat: DuelStat; source: DuelRound["source"] }[] =
    challengerStat === opponentStat
      ? [{ stat: challengerStat, source: "both" }]
      : [
          { stat: challengerStat, source: "challenger" },
          { stat: opponentStat, source: "opponent" },
        ];
  return [...picked, ...randomStats.map((stat) => ({ stat, source: "random" as const }))].map(({ stat, source }) => ({
    stat,
    source,
    challengerValue: c[stat],
    opponentValue: o[stat],
    winner: roundWinner(stat, c, o),
  }));
}

function duelWinner(rounds: DuelRound[]): "challenger" | "opponent" {
  const challengerWins = rounds.filter((r) => r.winner === "challenger").length;
  return challengerWins * 2 > rounds.length ? "challenger" : "opponent";
}

// Every equally likely set of random categories for these two picks.
function randomDrawOptions(challengerStat: DuelStat, opponentStat: DuelStat): DuelStat[][] {
  const remaining = DUEL_STATS.filter((s) => s !== challengerStat && s !== opponentStat);
  if (challengerStat !== opponentStat) return remaining.map((s) => [s]);
  const pairs: DuelStat[][] = [];
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) pairs.push([remaining[i], remaining[j]]);
  }
  return pairs;
}

export interface StatDuelResult {
  rounds: DuelRound[];
  winner: "challenger" | "opponent";
  // Exact, over every possible random draw — feeds the upset-scaled stake
  // (computeStakeForWinProb) the way the coin flip's power ratio used to.
  challengerWinProb: number;
}

export function resolveStatDuel(challengerStat: DuelStat, opponentStat: DuelStat, c: StatLine, o: StatLine): StatDuelResult {
  const options = randomDrawOptions(challengerStat, opponentStat);
  const challengerWinning = options.filter(
    (draw) => duelWinner(buildRounds(challengerStat, opponentStat, draw, c, o)) === "challenger"
  ).length;
  const draw = options[Math.floor(Math.random() * options.length)];
  const rounds = buildRounds(challengerStat, opponentStat, draw, c, o);
  return { rounds, winner: duelWinner(rounds), challengerWinProb: challengerWinning / options.length };
}
