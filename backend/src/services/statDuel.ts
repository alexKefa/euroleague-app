import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerSeasonStats } from "../db/schema.js";
import { getCurrentSeason } from "./season.js";
import { normalizePlayerName } from "./battles.js";
import { computeBattlePower, type BattlePower } from "./battlePower.js";

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

// Current condition (2026-09-30, direct request: "do you consider ... how
// current player's condition is?"). Two parts:
//  - Form: the season line is blended with the player's last few games,
//    so a hot or slumping player plays like it. The recent share grows
//    with how many recent games exist, up to RECENT_WEIGHT at RECENT_GAMES.
//  - Injury: a player on the injury report plays at reduced strength.
// A team's winning streak was considered and deliberately left out: the
// player's own recent games already capture form, and a team streak mostly
// adds noise the card itself doesn't control.
export const RECENT_GAMES = 5;
const RECENT_WEIGHT = 0.4;
export const INJURY_MULTIPLIER: Record<string, number> = { out: 0.75, doubtful: 0.85, questionable: 0.9, probable: 1 };
// Recent PIR this far above/below the season PIR labels the card hot/cold.
const FORM_THRESHOLD = 0.2;

export type InjuryStatus = "out" | "doubtful" | "questionable" | "probable";

export interface CardStatLine {
  // Per-game numbers the duel starts from: season averages blended with
  // recent form. What the UI shows as the player's stats.
  raw: StatLine;
  // Rarity/foil multiplier times the injury multiplier.
  multiplier: number;
  // raw * multiplier, one decimal — what the duel actually compares.
  boosted: StatLine;
  recentGames: number;
  form: "hot" | "cold" | null;
  injury: InjuryStatus | null;
  // Unblended PIR inputs for battles v5 (services/battlePower.ts).
  seasonPir: number;
  recentPir: number | null;
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

type StatRow = { team_id: string; name: string; recent_games: number; injury: string | null } & Record<DuelStat, number | null> &
  Record<`r_${DuelStat}`, number | null>;

interface PlayerCondition {
  raw: StatLine;
  recentGames: number;
  form: "hot" | "cold" | null;
  injury: InjuryStatus | null;
  seasonPir: number;
  recentPir: number | null;
}

const NO_CONDITION: PlayerCondition = { raw: EMPTY_LINE, recentGames: 0, form: null, injury: null, seasonPir: 0, recentPir: null };

/**
 * Stat lines for a batch of cards, in input order, in one round trip. Cards
 * map to players by team + normalized name (collectibles carry no player
 * id), same key as the v3 power lookup. No synced stats means all zeros.
 */
export async function getCardStatLines(
  cards: { teamId: string; name: string; tier: string; finish?: string | null }[]
): Promise<CardStatLine[]> {
  const teamIds = [...new Set(cards.map((c) => c.teamId))];
  const lookup = new Map<string, PlayerCondition>();
  if (teamIds.length > 0) {
    const season = (await getCurrentSeason()) ?? "__none__";
    const teamList = sql.join(
      teamIds.map((id) => sql`${id}`),
      sql`, `
    );
    // Season line: this season and last, weighted by games played (two
    // games in, most steals/blocks averages are still 0, so last season
    // carries it early). Players with neither fall back to career.
    const recent = sql`s.season in (${season}, ${previousSeason(season)})`;
    const avg = (col: string, onlyRecent: boolean) => {
      const value = sql.raw(`s.${col} * s.games_played`);
      const games = sql.raw("s.games_played");
      return onlyRecent
        ? sql`sum(case when ${recent} then ${value} end) / nullif(sum(case when ${recent} then ${games} end), 0)`
        : sql`sum(${value}) / nullif(sum(${games}), 0)`;
    };
    const rows = await db.execute<StatRow>(sql`
      with season_line as (
        select p.id, p.team_id, p.name,
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
      )
      select sl.*,
        coalesce(rec.n, 0)::int as recent_games,
        rec.points as r_points, rec.rebounds as r_rebounds, rec.assists as r_assists,
        rec.steals as r_steals, rec.blocks as r_blocks, rec.pir as r_pir,
        inj.status as injury
      from season_line sl
      left join lateral (
        select count(*) as n, avg(x.points) as points, avg(x.rebounds) as rebounds, avg(x.assists) as assists,
          avg(x.steals) as steals, avg(x.blocks_favour) as blocks, avg(x.valuation) as pir
        from (
          select pgs.points, pgs.rebounds, pgs.assists, pgs.steals, pgs.blocks_favour, pgs.valuation
          from player_game_stats pgs
          join games g on g.id = pgs.game_id
          -- Played: minutes > 0, or null minutes with any stat (live sync
          -- stores no minutes this season, see TODO.md #7).
          where pgs.player_id = sl.id and g.status = 'final'
            and (pgs.minutes > 0 or (pgs.minutes is null and (coalesce(pgs.points, 0) <> 0 or coalesce(pgs.rebounds, 0) <> 0
              or coalesce(pgs.assists, 0) <> 0 or coalesce(pgs.valuation, 0) <> 0)))
          order by g.tipoff_at desc
          limit ${RECENT_GAMES}
        ) x
      ) rec on true
      left join player_injuries inj on inj.player_id = sl.id
    `);
    for (const r of rows) {
      const n = Number(r.recent_games ?? 0);
      const w = RECENT_WEIGHT * Math.min(n, RECENT_GAMES) / RECENT_GAMES;
      const blend = (stat: DuelStat): number => {
        const base = Number(r[stat] ?? 0);
        const recentValue = r[`r_${stat}`];
        return round1(n > 0 && recentValue != null ? base * (1 - w) + Number(recentValue) * w : base);
      };
      const raw = Object.fromEntries(DUEL_STATS.map((s) => [s, blend(s)])) as StatLine;
      const seasonPir = Number(r.pir ?? 0);
      const recentPir = r.r_pir == null ? null : Number(r.r_pir);
      let form: "hot" | "cold" | null = null;
      if (n >= 3 && recentPir != null && seasonPir > 0) {
        if (recentPir >= seasonPir * (1 + FORM_THRESHOLD)) form = "hot";
        else if (recentPir <= seasonPir * (1 - FORM_THRESHOLD)) form = "cold";
      }
      const injury = r.injury && r.injury in INJURY_MULTIPLIER ? (r.injury as InjuryStatus) : null;
      lookup.set(`${r.team_id}|${normalizePlayerName(r.name)}`, { raw, recentGames: n, form, injury, seasonPir, recentPir });
    }
  }
  return cards.map((c) => {
    const cond = lookup.get(`${c.teamId}|${normalizePlayerName(c.name)}`) ?? NO_CONDITION;
    const multiplier = Math.round(multiplierFor(c.tier, c.finish) * (cond.injury ? INJURY_MULTIPLIER[cond.injury] : 1) * 1000) / 1000;
    const boosted = Object.fromEntries(DUEL_STATS.map((s) => [s, round1(cond.raw[s] * multiplier)])) as StatLine;
    return {
      raw: cond.raw,
      multiplier,
      boosted,
      recentGames: cond.recentGames,
      form: cond.form,
      injury: cond.injury,
      seasonPir: cond.seasonPir,
      recentPir: cond.recentPir,
    };
  });
}

/** Battles v5 power for a batch of cards, in input order, in one round trip. */
export async function getCardPowers(
  cards: { teamId: string; name: string; tier: string; finish?: string | null }[]
): Promise<BattlePower[]> {
  const lines = await getCardStatLines(cards);
  return cards.map((c, i) => powerFromLine(c, lines[i]));
}

/** v5 power from a stat line already loaded by getCardStatLines (no query). */
export function powerFromLine(card: { tier: string; finish?: string | null }, line: CardStatLine): BattlePower {
  return computeBattlePower({
    tier: card.tier,
    finish: card.finish,
    seasonPir: line.seasonPir,
    recentPir: line.recentPir,
    recentGames: line.recentGames,
    injury: line.injury,
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
