import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, collectibleMoments, duelMoves, duels, userCollectibles } from "../db/schema.js";
import { sendToUser } from "../realtime/hub.js";
import { normalizePlayerName } from "./battles.js";
import { lockUserPoints } from "./points.js";
import { sendPushInBackground, sendPushOnce, type PushBuilder } from "./push.js";
import { INJURY_MULTIPLIER, getCardStatLines } from "./statDuel.js";
import {
  benchSlot,
  divisionFor,
  drawCategories,
  eloDeltas,
  formFor,
  kFactor,
  prizeEligible,
  quarterScore,
  rarityMult,
  seasonKey,
  softReset,
  validateLineup,
  weakestRemaining,
  CHALLENGE_TTL_MS,
  DUEL_WIN_PRIZE,
  LINEUP_SIZE,
  MAX_ACTIVE_DUELS,
  MAX_PAID_WINS_PER_DAY,
  QUARTER_MS,
  START_RATING,
  type DuelCard,
  type DuelCategory,
  type Division,
} from "./duelEngine.js";

// Four Quarters duels, DB layer. The pure rules are in duelEngine.ts; the
// lifecycle (create/accept/commit/finish) is added on top of this.
// Spec: docs/superpowers/specs/2026-10-29-four-quarters-duels-design.md

export class DuelError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

/**
 * Frozen DuelCards for a lineup, in input order. One ownership query plus one
 * getCardStatLines round trip. Throws INVALID_LINEUP if the user doesn't own
 * all five, or the lineup has a coach or two cards of the same player.
 */
export async function buildSnapshots(
  userId: string,
  collectibleIds: string[],
  opts: { validate?: boolean } = {}
): Promise<DuelCard[]> {
  const validate = opts.validate !== false;
  const ids = [...new Set(collectibleIds)];
  if (validate && ids.length !== LINEUP_SIZE) throw new DuelError("INVALID_LINEUP", 400);

  const rows = await db
    .select({
      id: collectibles.id,
      name: collectibles.name,
      teamId: collectibles.teamId,
      tier: collectibles.tier,
      imageUrl: collectibles.imageUrl,
      finish: userCollectibles.finish,
      momentRole: collectibleMoments.role,
    })
    .from(userCollectibles)
    .innerJoin(collectibles, eq(collectibles.id, userCollectibles.collectibleId))
    .leftJoin(
      collectibleMoments,
      and(eq(collectibleMoments.collectibleId, collectibles.id), eq(collectibleMoments.role, "mvp"))
    )
    .where(and(eq(userCollectibles.userId, userId), inArray(userCollectibles.collectibleId, ids)));

  if (validate && rows.length !== LINEUP_SIZE) throw new DuelError("INVALID_LINEUP", 400);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Preview (validate: false) silently drops ids the user doesn't own.
  const ordered = (validate ? collectibleIds : ids).filter((id) => byId.has(id) || validate).map((id) => byId.get(id)!);
  if (!ordered.length) return [];

  if (validate && validateLineup(ordered.map((r) => ({ playerKey: normalizePlayerName(r.name), tier: r.tier })))) {
    throw new DuelError("INVALID_LINEUP", 400);
  }

  const lines = await getCardStatLines(ordered.map((r) => ({ teamId: r.teamId, name: r.name, tier: r.tier, finish: r.finish })));
  return ordered.map((r, i) => {
    const line = lines[i];
    const isMvp = r.momentRole === "mvp";
    const isFoil = r.finish === "foil";
    const form = formFor(line.seasonPir, line.recentPir, line.recentGames);
    return {
      collectibleId: r.id,
      name: r.name,
      teamId: r.teamId,
      imageUrl: r.imageUrl,
      tier: r.tier,
      isMvp,
      isFoil,
      base: {
        pts: line.season.points,
        reb: line.season.rebounds,
        ast: line.season.assists,
        stl: line.season.steals,
        blk: line.season.blocks,
        pir: line.season.pir,
      },
      rarityMult: rarityMult(r.tier, isMvp, isFoil),
      formMult: form.mult,
      formBadge: form.badge,
      injury: line.injury,
      injuryMult: line.injury ? INJURY_MULTIPLIER[line.injury] : 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Lifecycle: create / accept / decline / cancel / commit / timeouts / finish.
//
// Every change to a running duel goes through withLockedDuel: one
// transaction holding the duels row lock (select ... for update), so two
// commits, a commit and a timeout, or two timeout runs serialize on the row.
// Moves are read in a second statement after the lock is held, because a
// subquery in the locking statement keeps the pre-lock snapshot and would
// miss a move the other side committed while we waited.
//
// Hidden information: buildView is the only thing that turns a row into
// something a client sees. It never shows the opponent's move for the open
// quarter, categories past current + next, or the challenger's lineup
// before accept. SSE payloads carry only { id, status, quarter }, and push
// text never names a card.
// ---------------------------------------------------------------------------

type DuelRow = typeof duels.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface MoveRow {
  quarter: number;
  userId: string;
  slot: number;
  score: number;
  auto: boolean;
}
interface Locked {
  row: DuelRow;
  moves: MoveRow[];
  now: Date;
  challengerName: string;
  opponentName: string | null;
}
interface Ctx {
  /** The user whose request this is; null for timeouts. Gets no SSE/push for their own action. */
  actor: string | null;
  changed: boolean;
  final: DuelRow | null;
  /** `quarter` set = a "your move" push, sent at most once per player per quarter (shared with the deadline warning). */
  pushes: { userIds: string[]; build: PushBuilder; quarter?: number; duelId?: string }[];
  /** Users who get nothing (a deleted account being forfeited). */
  silent: Set<string>;
  /** Thrown after commit, so work done before it (timeouts) is kept. */
  error: DuelError | null;
}

const ACTIVE_STATUSES = sql`('open', 'pending', 'active')`;
const QUARTER_INTERVAL = sql.raw(`interval '${QUARTER_MS / 1000} seconds'`);
const TTL_INTERVAL = sql.raw(`interval '${CHALLENGE_TTL_MS / 1000} seconds'`);
const ATHENS_TODAY = sql`(now() at time zone 'Europe/Athens')::date`;

const round1 = (n: number) => Math.round(n * 10) / 10;
const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
export const DUEL_MOVE_PUSH_KIND = "duel-move";
const duelUrl = (id: string) => `/battles/duel/${id}`;

function newCtx(actor: string | null): Ctx {
  return { actor, changed: false, final: null, pushes: [], silent: new Set(), error: null };
}

function participants(r: DuelRow): string[] {
  return [r.challengerUserId, r.opponentUserId].filter((u): u is string => !!u);
}

/** SSE + push for one duel after its transaction committed. */
function flush(ctx: Ctx): void {
  const r = ctx.final;
  if (!ctx.changed || !r) return;
  for (const u of participants(r)) {
    if (ctx.silent.has(u)) continue;
    if (u === ctx.actor && r.status !== "finished") continue;
    sendToUser(u, "duel", { id: r.id, status: r.status, quarter: r.quarter });
  }
  for (const p of ctx.pushes) {
    const ids = p.userIds.filter((u) => !ctx.silent.has(u) && u !== ctx.actor);
    if (!ids.length) continue;
    if (p.quarter !== undefined && p.duelId) {
      for (const u of ids) {
        void sendPushOnce(DUEL_MOVE_PUSH_KIND, `duel:${p.duelId}:q${p.quarter}:${u}`, [u], p.build).catch(() => {});
      }
    } else sendPushInBackground(ids, p.build);
  }
}

/** For callers that change duels inside their own transaction (account deletion). */
export function notifyDuelUpdate(userIds: string[], d: { id: string; status: string; quarter: number }): void {
  for (const u of new Set(userIds)) sendToUser(u, "duel", { id: d.id, status: d.status, quarter: d.quarter });
}

// Push text, EN/EL. Never names a card.
const pushText = {
  challenged: (id: string, name: string): PushBuilder => (lang) => ({
    title: lang === "el" ? "Νέα πρόκληση μονομαχίας" : "New duel challenge",
    body: lang === "el" ? `Ο/Η ${name} σε προκαλεί σε Four Quarters.` : `${name} challenged you to Four Quarters.`,
    url: duelUrl(id),
    tag: `duel-${id}`,
  }),
  accepted: (id: string): PushBuilder => (lang) => ({
    title: lang === "el" ? "Η πρόκλησή σου έγινε δεκτή" : "Challenge accepted",
    body: lang === "el" ? "Παίζεις εσύ: διάλεξε κάρτα για το 1ο δεκάλεπτο." : "Your move: pick your Q1 card.",
    url: duelUrl(id),
    tag: `duel-${id}`,
  }),
  committed: (id: string, q: number): PushBuilder => (lang) => ({
    title: lang === "el" ? "Σειρά σου" : "Your move",
    body: lang === "el" ? `Ο αντίπαλός σου έπαιξε για το ${q}ο δεκάλεπτο.` : `Your opponent has played their Q${q} card.`,
    url: duelUrl(id),
    tag: `duel-${id}`,
  }),
  revealed: (id: string, q: number): PushBuilder => (lang) => ({
    title: lang === "el" ? `Αποκάλυψη ${q}ου δεκαλέπτου` : `Q${q} revealed`,
    body: lang === "el" ? `Ξεκίνησε το ${q + 1}ο δεκάλεπτο: παίζεις εσύ.` : `Q${q + 1} is open: your move.`,
    url: duelUrl(id),
    tag: `duel-${id}`,
  }),
  finished: (id: string, result: "win" | "loss" | "draw", me: number, them: number, forfeit: boolean): PushBuilder => (lang) => {
    const s = `${me}–${them}`;
    const el = {
      win: forfeit ? "Νίκησες: ο αντίπαλος εγκατέλειψε." : `Νίκησες ${s}.`,
      loss: forfeit ? "Έχασες με εγκατάλειψη." : `Έχασες ${s}.`,
      draw: `Ισοπαλία ${s}.`,
    };
    const en = {
      win: forfeit ? "You won: your opponent forfeited." : `You won ${s}.`,
      loss: forfeit ? "You lost by forfeit." : `You lost ${s}.`,
      draw: `It's a draw, ${s}.`,
    };
    return {
      title: lang === "el" ? "Τέλος αγώνα" : "Full time",
      body: lang === "el" ? el[result] : en[result],
      url: duelUrl(id),
      tag: `duel-${id}`,
    };
  },
};

async function lockDuel(tx: Tx, duelId: string): Promise<Locked> {
  const [r] = await tx
    .select({
      d: duels,
      now: sql<string>`now()`,
      challengerName: sql<string>`(select username from users where id = ${duels.challengerUserId})`,
      opponentName: sql<string | null>`(select username from users where id = ${duels.opponentUserId})`,
    })
    .from(duels)
    .where(eq(duels.id, duelId))
    .for("update");
  if (!r) throw new DuelError("NOT_FOUND", 404);
  const moves = await tx
    .select({ quarter: duelMoves.quarter, userId: duelMoves.userId, slot: duelMoves.slot, score: duelMoves.score, auto: duelMoves.auto })
    .from(duelMoves)
    .where(eq(duelMoves.duelId, duelId));
  return { row: r.d, moves, now: new Date(r.now), challengerName: r.challengerName, opponentName: r.opponentName };
}

/**
 * The single locked path for commits, timeouts, accept and forfeits. With
 * `outerTx` the caller owns the transaction and must send notifications
 * itself (ctx is returned for that).
 */
async function withLockedDuel<T>(
  duelId: string,
  actor: string | null,
  fn: (tx: Tx, st: Locked, ctx: Ctx) => Promise<T>,
  outerTx?: Tx
): Promise<{ result: T; st: Locked; ctx: Ctx }> {
  const ctx = newCtx(actor);
  const run = async (tx: Tx) => {
    const st = await lockDuel(tx, duelId);
    const result = await fn(tx, st, ctx);
    ctx.final = st.row;
    return { result, st, ctx };
  };
  const out = outerTx ? await run(outerTx) : await db.transaction(run);
  if (!outerTx) flush(ctx);
  if (ctx.error) throw ctx.error;
  return out;
}

const moveOf = (st: Locked, userId: string | null, q: number) => st.moves.find((m) => m.userId === userId && m.quarter === q);
const usedSlots = (st: Locked, userId: string) => st.moves.filter((m) => m.userId === userId && m.quarter <= 4).map((m) => m.slot);
const lineupOf = (r: DuelRow, userId: string) => (userId === r.challengerUserId ? r.challengerLineup : r.opponentLineup) as DuelCard[];

async function insertMoves(tx: Tx, st: Locked, rows: MoveRow[]): Promise<MoveRow[]> {
  if (rows.length === 0) return [];
  const inserted = await tx
    .insert(duelMoves)
    .values(rows.map((m) => ({ duelId: st.row.id, ...m })))
    .onConflictDoNothing()
    .returning({ quarter: duelMoves.quarter, userId: duelMoves.userId, slot: duelMoves.slot, score: duelMoves.score, auto: duelMoves.auto });
  st.moves.push(...inserted);
  return inserted;
}

type StreakFields = Partial<Pick<DuelRow, "challengerMissStreak" | "opponentMissStreak">>;

/**
 * After a move: if both sides have played the open quarter, add the scores,
 * then open the next quarter, or (Q4 / a forfeit) play overtime if tied and
 * finish. `pending` carries miss-streak changes so they ride in the same
 * UPDATE.
 */
async function resolveQuarter(tx: Tx, st: Locked, ctx: Ctx, pending: StreakFields): Promise<void> {
  const r = st.row;
  const q = r.quarter;
  const cm = moveOf(st, r.challengerUserId, q);
  const om = moveOf(st, r.opponentUserId, q);
  if (!cm || !om) {
    if (Object.keys(pending).length) {
      [st.row] = await tx.update(duels).set(pending).where(eq(duels.id, r.id)).returning();
      ctx.changed = true;
    }
    return;
  }

  const cs = round1(r.challengerScore + cm.score);
  const os = round1(r.opponentScore + om.score);
  const cForfeit = (pending.challengerMissStreak ?? r.challengerMissStreak) >= 2;
  const oForfeit = (pending.opponentMissStreak ?? r.opponentMissStreak) >= 2;
  const forfeit = cForfeit || oForfeit;
  const set: Record<string, unknown> = { ...pending, challengerScore: cs, opponentScore: os };

  let ot: { c: number; o: number } | null = null;
  if (q < 4 && !forfeit) {
    set.quarter = q + 1;
    set.quarterDeadline = sql`now() + ${QUARTER_INTERVAL}`;
  } else if (q === 4 && !forfeit && cs === os) {
    // Overtime: each side's unused card on efficiency.
    const otRows: MoveRow[] = [r.challengerUserId, r.opponentUserId!].map((u) => {
      const slot = benchSlot(usedSlots(st, u));
      return { quarter: 5, userId: u, slot, score: quarterScore(lineupOf(r, u)[slot], "efficiency"), auto: false };
    });
    await insertMoves(tx, st, otRows);
    ot = { c: otRows[0].score, o: otRows[1].score };
    set.quarter = 5;
  }
  [st.row] = await tx
    .update(duels)
    .set(set as Partial<DuelRow>)
    .where(and(eq(duels.id, r.id), eq(duels.quarter, q)))
    .returning();
  ctx.changed = true;

  if (q < 4 && !forfeit) {
    ctx.pushes.push({ userIds: participants(r), build: pushText.revealed(r.id, q), quarter: q + 1, duelId: r.id });
    return;
  }

  let winner: string | null;
  if (forfeit) winner = cForfeit && oForfeit ? null : cForfeit ? r.opponentUserId : r.challengerUserId;
  else if (cs !== os) winner = cs > os ? r.challengerUserId : r.opponentUserId;
  else if (ot && ot.c !== ot.o) winner = ot.c > ot.o ? r.challengerUserId : r.opponentUserId;
  else winner = null;
  if (await finishDuel(tx, st.row, { winnerUserId: winner, reason: forfeit ? "forfeit" : "normal" }, ctx)) {
    st.row = ctx.final!;
  }
}

/** Auto-commits the weakest card for each side that missed the deadline, repeatedly if several quarters lapsed. */
async function advanceTimeouts(tx: Tx, st: Locked, ctx: Ctx): Promise<boolean> {
  let changed = false;
  for (let guard = 0; guard < 5; guard++) {
    const r = st.row;
    if (r.status !== "active" || !r.quarterDeadline || r.quarterDeadline.getTime() > st.now.getTime()) break;
    const q = r.quarter;
    const cat = r.categories![q - 1];
    const pending: StreakFields = {};
    const autos: MoveRow[] = [];
    for (const u of [r.challengerUserId, r.opponentUserId!]) {
      if (moveOf(st, u, q)) continue;
      const lineup = lineupOf(r, u);
      const slot = weakestRemaining(lineup, usedSlots(st, u), cat);
      autos.push({ quarter: q, userId: u, slot, score: quarterScore(lineup[slot], cat), auto: true });
      if (u === r.challengerUserId) pending.challengerMissStreak = r.challengerMissStreak + 1;
      else pending.opponentMissStreak = r.opponentMissStreak + 1;
    }
    await insertMoves(tx, st, autos);
    await resolveQuarter(tx, st, ctx, pending);
    changed = true;
    if (st.row.quarter === q && st.row.status === "active") break; // didn't advance; never spin
  }
  return changed;
}

/**
 * Finishes a duel inside the caller's locked transaction: claims the finish
 * (status active -> finished, so a second call is a no-op and returns
 * false), applies Elo to this month's duel_ratings rows, and pays the win
 * prize claim-first. `skipRatingFor` leaves that user's rating untouched
 * and their delta null (account deletion). Exported for check-duels.ts;
 * everything else reaches it through the locked commit/timeout path.
 */
export async function finishDuel(
  tx: Tx,
  row: DuelRow,
  o: { winnerUserId: string | null; reason: "normal" | "forfeit"; skipRatingFor?: string },
  ctx: Ctx = newCtx(null)
): Promise<boolean> {
  if (row.status !== "active" || !row.opponentUserId) return false;
  const a = row.challengerUserId;
  const b = row.opponentUserId;
  const w = o.winnerUserId;
  const loser = w === a ? b : w === b ? a : null;
  const season = seasonKey(new Date());

  // The per-user points lock: two duels finishing for the same winner at
  // once can't both read "4 paid wins today" and both pay.
  if (w && w !== o.skipRatingFor) await lockUserPoints(tx, w);

  const ratingCols = (u: string, p: string) => sql`
    (select rating from duel_ratings where user_id = ${u} and season = ${season}) as ${sql.raw(`${p}_cur`)},
    (select rating from duel_ratings where user_id = ${u} and season < ${season} order by season desc limit 1) as ${sql.raw(`${p}_prev`)},
    (select coalesce(sum(games), 0)::int from duel_ratings where user_id = ${u}) as ${sql.raw(`${p}_life`)}`;
  const paidToday = sql`d.winner_user_id = ${w}::uuid and d.prize_paid and (d.finished_at at time zone 'Europe/Athens')::date = ${ATHENS_TODAY}`;
  const [info] = await tx.execute<{
    a_cur: number | null;
    a_prev: number | null;
    a_life: number;
    b_cur: number | null;
    b_prev: number | null;
    b_life: number;
    pair: number;
    paid_today: number;
    paid_vs: number;
  }>(sql`
    select ${ratingCols(a, "a")}, ${ratingCols(b, "b")},
      (select count(*)::int from duels d where d.status = 'finished' and d.finished_at > now() - interval '7 days'
        and ((d.challenger_user_id = ${a} and d.opponent_user_id = ${b}) or (d.challenger_user_id = ${b} and d.opponent_user_id = ${a}))) as pair,
      (select count(*)::int from duels d where ${paidToday}) as paid_today,
      (select count(*)::int from duels d where ${paidToday}
        and (d.challenger_user_id = ${loser}::uuid or d.opponent_user_id = ${loser}::uuid)) as paid_vs
  `);

  const ra = info.a_cur ?? softReset(info.a_prev);
  const rb = info.b_cur ?? softReset(info.b_prev);
  const resultA: 1 | 0.5 | 0 = w === a ? 1 : w === b ? 0 : 0.5;
  const deltas = eloDeltas(ra, rb, resultA, kFactor(info.a_life, info.pair), kFactor(info.b_life, info.pair));
  const da = o.skipRatingFor === a ? null : deltas.a;
  const dbDelta = o.skipRatingFor === b ? null : deltas.b;

  const rated = [
    { u: a, start: ra, delta: da, res: resultA },
    { u: b, start: rb, delta: dbDelta, res: (1 - resultA) as 1 | 0.5 | 0 },
  ].filter((x) => x.delta !== null);
  const values = sql.join(
    rated.map(
      (x) =>
        sql`(${x.u}::uuid, ${x.start}::int, ${x.delta}::int, ${x.res === 1 ? 1 : 0}::int, ${x.res === 0 ? 1 : 0}::int, ${x.res === 0.5 ? 1 : 0}::int)`
    ),
    sql`, `
  );

  // Claim the finish and upsert ratings in one statement. The insert only
  // runs if the claim landed, so a second finish changes nothing.
  const claimed = await tx.execute<{ id: string }>(sql`
    with claimed as (
      update duels set status = 'finished', finish_reason = ${o.reason}, winner_user_id = ${w}::uuid,
        challenger_rating_delta = ${da}::int, opponent_rating_delta = ${dbDelta}::int,
        finished_at = now(), quarter_deadline = null
      where id = ${row.id} and status = 'active'
      returning id
    ), v (user_id, start, delta, w, l, d) as (values ${values}),
    rated as (
      insert into duel_ratings (user_id, season, rating, games, wins, losses, draws)
      select v.user_id, ${season}, v.start + v.delta, 1, v.w, v.l, v.d from v where exists (select 1 from claimed)
      on conflict (user_id, season) do update set
        rating = duel_ratings.rating + (select v.delta from v where v.user_id = excluded.user_id),
        games = duel_ratings.games + 1,
        wins = duel_ratings.wins + excluded.wins,
        losses = duel_ratings.losses + excluded.losses,
        draws = duel_ratings.draws + excluded.draws
      returning 1
    )
    select id from claimed
  `);
  if (claimed.length === 0) return false;

  let prizePaid = false;
  if (w && w !== o.skipRatingFor && prizeEligible({ result: "win", paidWinsToday: info.paid_today, paidVsOpponentToday: info.paid_vs })) {
    const paid = await tx.execute(sql`
      with c as (update duels set prize_paid = true where id = ${row.id} and prize_paid = false returning id)
      insert into point_adjustments (user_id, points, reason, created_by_user_id)
      select ${w}, ${DUEL_WIN_PRIZE}, 'Duel win', ${w} from c
      returning id
    `);
    prizePaid = paid.length > 0;
  }

  ctx.final = {
    ...row,
    status: "finished",
    finishReason: o.reason,
    winnerUserId: w,
    challengerRatingDelta: da,
    opponentRatingDelta: dbDelta,
    prizePaid: row.prizePaid || prizePaid,
    finishedAt: new Date(),
    quarterDeadline: null,
  };
  ctx.changed = true;
  for (const u of [a, b]) {
    const result = w === null ? "draw" : w === u ? "win" : "loss";
    const me = u === a ? row.challengerScore : row.opponentScore;
    const them = u === a ? row.opponentScore : row.challengerScore;
    ctx.pushes.push({ userIds: [u], build: pushText.finished(row.id, result, me, them, o.reason === "forfeit") });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface DuelView {
  id: string;
  status: string;
  finishReason: string | null;
  leagueId: string | null;
  side: "challenger" | "opponent";
  opponent: { id: string; username: string } | null;
  quarter: number;
  quarterDeadline: string | null;
  expiresAt: string | null;
  categories: (DuelCategory | null)[];
  myLineup: DuelCard[];
  theirLineup: DuelCard[] | null;
  quarters: {
    quarter: number;
    mySlot: number | null;
    theirSlot: number | null;
    myScore: number | null;
    theirScore: number | null;
    myAuto: boolean;
    theirAuto: boolean;
  }[];
  iCommitted: boolean;
  theyCommitted: boolean;
  score: { me: number; them: number };
  overtime: { mySlot: number; theirSlot: number; myScore: number; theirScore: number } | null;
  result: "win" | "loss" | "draw" | null;
  ratingDelta: number | null;
  prizePaid: boolean;
}

export interface DuelSummary {
  id: string;
  status: string;
  opponent: { id: string; username: string } | null;
  score: { me: number; them: number };
  quarter: number;
  myMove: boolean;
  deadline: string | null;
  result: "win" | "loss" | "draw" | null;
}

export interface OpenDuel {
  id: string;
  challenger: { id: string; username: string; rating: number; division: Division };
  expiresAt: string;
}

export interface LadderRow {
  userId: string;
  username: string;
  rating: number;
  division: Division;
  wins: number;
  losses: number;
  draws: number;
}

export interface MyRating {
  rating: number;
  division: Division;
  season: string;
  wins: number;
  losses: number;
  draws: number;
  paidWinsLeftToday: number;
  seasonBadges: SeasonBadge[];
}

export type SeasonBadge = { season: string; kind: "top3" | "all_star" };

function resultFor(r: { status: string; winnerUserId: string | null }, me: string): "win" | "loss" | "draw" | null {
  if (r.status !== "finished") return null;
  return r.winnerUserId === null ? "draw" : r.winnerUserId === me ? "win" : "loss";
}

/** The hidden-information rules: the only way a duel row reaches a client. */
function buildView(st: Locked, viewerId: string, preview: DuelCard[] = []): DuelView {
  const r = st.row;
  const isC = r.challengerUserId === viewerId;
  if (!isC && r.opponentUserId !== viewerId) throw new DuelError("NOT_PARTICIPANT", 403);
  const them = isC ? r.opponentUserId : r.challengerUserId;
  const themName = isC ? st.opponentName : st.challengerName;
  const accepted = r.acceptedAt != null && r.opponentLineup != null;
  const active = r.status === "active";
  const finished = r.status === "finished";
  // Quarters whose moves are public: all once finished, earlier ones while active.
  const resolvedThrough = finished ? 5 : active ? r.quarter - 1 : 0;

  const categories: (DuelCategory | null)[] =
    accepted && r.categories ? r.categories.map((c, i) => (finished || i <= r.quarter ? c : null)) : [];
  const quarters = accepted
    ? [1, 2, 3, 4].map((q) => {
        const mine = moveOf(st, viewerId, q);
        const theirs = q <= resolvedThrough ? moveOf(st, them, q) : undefined;
        return {
          quarter: q,
          mySlot: mine?.slot ?? null,
          theirSlot: theirs?.slot ?? null,
          myScore: mine?.score ?? null,
          theirScore: theirs?.score ?? null,
          myAuto: mine?.auto ?? false,
          theirAuto: theirs?.auto ?? false,
        };
      })
    : [];
  const myOt = finished ? moveOf(st, viewerId, 5) : undefined;
  const theirOt = finished ? moveOf(st, them, 5) : undefined;

  return {
    id: r.id,
    status: r.status,
    finishReason: r.finishReason,
    leagueId: r.leagueId,
    side: isC ? "challenger" : "opponent",
    opponent: them && themName ? { id: them, username: themName } : null,
    quarter: r.quarter,
    quarterDeadline: active ? iso(r.quarterDeadline) : null,
    expiresAt: iso(r.expiresAt),
    categories,
    myLineup: accepted ? lineupOf(r, viewerId) : isC ? preview : [],
    theirLineup: accepted && them ? lineupOf(r, them) : null,
    quarters,
    iCommitted: active && !!moveOf(st, viewerId, r.quarter),
    theyCommitted: active && !!moveOf(st, them, r.quarter),
    score: isC ? { me: r.challengerScore, them: r.opponentScore } : { me: r.opponentScore, them: r.challengerScore },
    overtime: myOt && theirOt ? { mySlot: myOt.slot, theirSlot: theirOt.slot, myScore: myOt.score, theirScore: theirOt.score } : null,
    result: resultFor(r, viewerId),
    ratingDelta: isC ? r.challengerRatingDelta : r.opponentRatingDelta,
    prizePaid: r.prizePaid && r.winnerUserId === viewerId,
  };
}

/** Pre-accept, the challenger (only) sees a live preview of their own picks. */
async function previewFor(st: Locked, viewerId: string): Promise<DuelCard[]> {
  const r = st.row;
  if (r.acceptedAt != null || r.challengerUserId !== viewerId || !["open", "pending"].includes(r.status)) return [];
  try {
    return await buildSnapshots(viewerId, r.challengerLineup as string[]);
  } catch {
    return [];
  }
}

/** One unlocked round trip: the row, its moves, both usernames and whether a timeout is due. */
async function loadDuel(duelId: string): Promise<(Locked & { due: boolean }) | null> {
  const [r] = await db
    .select({
      d: duels,
      now: sql<string>`now()`,
      challengerName: sql<string>`(select username from users where id = ${duels.challengerUserId})`,
      opponentName: sql<string | null>`(select username from users where id = ${duels.opponentUserId})`,
      moves: sql<MoveRow[]>`coalesce((select json_agg(json_build_object('quarter', m.quarter, 'userId', m.user_id, 'slot', m.slot, 'score', m.score, 'auto', m.auto)) from duel_moves m where m.duel_id = ${duels.id}), '[]'::json)`,
      due: sql<boolean>`((${duels.status} = 'active' and ${duels.quarterDeadline} <= now()) or (${duels.status} in ('open', 'pending') and ${duels.expiresAt} <= now()))`,
    })
    .from(duels)
    .where(eq(duels.id, duelId));
  if (!r) return null;
  return { row: r.d, moves: r.moves, now: new Date(r.now), challengerName: r.challengerName, opponentName: r.opponentName, due: r.due };
}

export async function getDuelView(duelId: string, viewerId: string): Promise<DuelView> {
  let st = await loadDuel(duelId);
  if (!st) throw new DuelError("NOT_FOUND", 404);
  if (st.row.challengerUserId !== viewerId && st.row.opponentUserId !== viewerId) throw new DuelError("NOT_PARTICIPANT", 403);
  if (st.due) {
    await applyTimeouts(duelId);
    st = (await loadDuel(duelId))!;
  }
  return buildView(st, viewerId, await previewFor(st, viewerId));
}

// ---------------------------------------------------------------------------
// Create / accept / decline / cancel
// ---------------------------------------------------------------------------

function checkLineupShape(lineup: unknown): asserts lineup is string[] {
  if (!Array.isArray(lineup) || lineup.length !== LINEUP_SIZE || !lineup.every((id) => typeof id === "string")) {
    throw new DuelError("INVALID_LINEUP", 400);
  }
}

const activeCount = (userId: string, exceptId?: string) => sql`(
  select count(*) from duels x
  where (x.challenger_user_id = ${userId} or x.opponent_user_id = ${userId}) and x.status in ${ACTIVE_STATUSES}
  ${exceptId ? sql`and x.id <> ${exceptId}` : sql``})`;
const isMember = (leagueId: string, userId: string) =>
  sql`exists (select 1 from league_members m where m.league_id = ${leagueId} and m.user_id = ${userId})`;

export async function createDuel(
  userId: string,
  o: { lineup: string[]; opponentUserId?: string; leagueId?: string }
): Promise<{ id: string }> {
  checkLineupShape(o.lineup);
  const opponent = o.opponentUserId ?? null;
  // Open challenges have no league; a direct one needs a shared league.
  const leagueId = opponent ? (o.leagueId ?? null) : null;
  if (opponent && (!leagueId || opponent === userId)) throw new DuelError("NOT_A_MEMBER", 400);
  await buildSnapshots(userId, o.lineup); // validates; only the ids are stored

  const memberCheck = opponent ? sql`and ${isMember(leagueId!, userId)} and ${isMember(leagueId!, opponent)}` : sql``;
  const [created] = await db.execute<{ id: string; challenger_name: string }>(sql`
    insert into duels (league_id, challenger_user_id, opponent_user_id, status, challenger_lineup, expires_at)
    select ${leagueId}::uuid, ${userId}, ${opponent}::uuid, ${opponent ? "pending" : "open"}, ${JSON.stringify(o.lineup)}::jsonb, now() + ${TTL_INTERVAL}
    where ${activeCount(userId)} < ${MAX_ACTIVE_DUELS} ${memberCheck}
    returning id, (select username from users where id = ${userId}) as challenger_name
  `);
  if (!created) {
    // Failure path only: work out which condition missed.
    const [why] = await db.execute<{ member: boolean }>(sql`
      select ${opponent ? sql`(${isMember(leagueId!, userId)} and ${isMember(leagueId!, opponent)})` : sql`true`} as member`);
    if (!why.member) throw new DuelError("NOT_A_MEMBER", 400);
    throw new DuelError("TOO_MANY_DUELS", 409);
  }
  if (opponent) {
    sendToUser(opponent, "duel", { id: created.id, status: "pending", quarter: 0 });
    sendPushInBackground([opponent], pushText.challenged(created.id, created.challenger_name));
  }
  return { id: created.id };
}

export async function acceptDuel(userId: string, duelId: string, lineup: string[]): Promise<DuelView> {
  checkLineupShape(lineup);
  const pre = await loadDuel(duelId);
  if (!pre) throw new DuelError("NOT_FOUND", 404);
  const p = pre.row;
  if (p.status === "pending" && p.opponentUserId !== userId) throw new DuelError("NOT_PARTICIPANT", 403);
  if (p.challengerUserId === userId) throw new DuelError("NOT_AVAILABLE", 409);
  if ((p.status !== "open" && p.status !== "pending") || pre.due) {
    if (pre.due) await applyTimeouts(duelId);
    throw new DuelError("NOT_AVAILABLE", 409);
  }

  // Snapshots are built before taking the lock (several round trips). The
  // challenger's ids can't change while the duel is open/pending, and the
  // status is rechecked under the lock.
  const mine = await buildSnapshots(userId, lineup);
  let theirs: DuelCard[];
  try {
    theirs = await buildSnapshots(p.challengerUserId, p.challengerLineup as string[]);
  } catch (err) {
    if (!(err instanceof DuelError)) throw err;
    const [cancelled] = await db
      .update(duels)
      .set({ status: "cancelled" })
      .where(and(eq(duels.id, duelId), inArray(duels.status, ["open", "pending"])))
      .returning({ id: duels.id });
    if (cancelled) sendToUser(p.challengerUserId, "duel", { id: duelId, status: "cancelled", quarter: 0 });
    throw new DuelError("NOT_AVAILABLE", 409);
  }

  const { st } = await withLockedDuel(duelId, userId, async (tx, st, ctx) => {
    const r = st.row;
    const stillOpen = r.status === p.status && (r.status === "open" ? r.opponentUserId === null : r.opponentUserId === userId);
    if (!stillOpen || r.expiresAt.getTime() <= st.now.getTime()) throw new DuelError("NOT_AVAILABLE", 409);
    const [updated] = await tx
      .update(duels)
      .set({
        opponentUserId: userId,
        status: "active",
        challengerLineup: theirs,
        opponentLineup: mine,
        categories: drawCategories(),
        quarter: 1,
        quarterDeadline: sql`now() + ${QUARTER_INTERVAL}`,
        acceptedAt: sql`now()`,
      })
      .where(and(eq(duels.id, duelId), sql`${activeCount(userId, duelId)} < ${MAX_ACTIVE_DUELS}`))
      .returning();
    if (!updated) throw new DuelError("TOO_MANY_DUELS", 409);
    st.row = updated;
    if (!st.opponentName) {
      const [u] = await tx.execute<{ username: string }>(sql`select username from users where id = ${userId}`);
      st.opponentName = u?.username ?? null;
    }
    ctx.changed = true;
    ctx.pushes.push({ userIds: [r.challengerUserId], build: pushText.accepted(duelId), quarter: 1, duelId });
  });
  return buildView(st, userId);
}

async function whyNot(duelId: string, userId: string, mustBe: "challenger" | "opponent"): Promise<never> {
  const [r] = await db.select({ c: duels.challengerUserId, o: duels.opponentUserId }).from(duels).where(eq(duels.id, duelId));
  if (!r) throw new DuelError("NOT_FOUND", 404);
  if ((mustBe === "challenger" ? r.c : r.o) !== userId) throw new DuelError("NOT_PARTICIPANT", 403);
  throw new DuelError("NOT_AVAILABLE", 409);
}

export async function declineDuel(userId: string, duelId: string): Promise<void> {
  const [r] = await db
    .update(duels)
    .set({ status: "declined" })
    .where(and(eq(duels.id, duelId), eq(duels.status, "pending"), eq(duels.opponentUserId, userId)))
    .returning({ challenger: duels.challengerUserId });
  if (!r) return whyNot(duelId, userId, "opponent");
  sendToUser(r.challenger, "duel", { id: duelId, status: "declined", quarter: 0 });
}

export async function cancelDuel(userId: string, duelId: string): Promise<void> {
  const [r] = await db
    .update(duels)
    .set({ status: "cancelled" })
    .where(and(eq(duels.id, duelId), inArray(duels.status, ["open", "pending"]), eq(duels.challengerUserId, userId)))
    .returning({ opponent: duels.opponentUserId });
  if (!r) return whyNot(duelId, userId, "challenger");
  if (r.opponent) sendToUser(r.opponent, "duel", { id: duelId, status: "cancelled", quarter: 0 });
}

// ---------------------------------------------------------------------------
// Commit and timeouts
// ---------------------------------------------------------------------------

export async function commitMove(userId: string, duelId: string, quarter: number, slot: number): Promise<DuelView> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= LINEUP_SIZE) throw new DuelError("INVALID_SLOT", 400);
  const { st } = await withLockedDuel(duelId, userId, async (tx, st, ctx) => {
    const r0 = st.row;
    if (r0.challengerUserId !== userId && r0.opponentUserId !== userId) throw new DuelError("NOT_PARTICIPANT", 403);
    // Timeouts first, under the same lock. Errors after this point go
    // through ctx.error so the timeout work still commits.
    await advanceTimeouts(tx, st, ctx);
    const r = st.row;
    if (r.status !== "active" || quarter !== r.quarter || moveOf(st, userId, r.quarter)) {
      ctx.error = new DuelError("QUARTER_CHANGED", 409);
      return;
    }
    if (usedSlots(st, userId).includes(slot)) {
      ctx.error = new DuelError("SLOT_USED", 409);
      return;
    }
    const cat = r.categories![r.quarter - 1];
    const inserted = await insertMoves(tx, st, [
      { quarter: r.quarter, userId, slot, score: quarterScore(lineupOf(r, userId)[slot], cat), auto: false },
    ]);
    if (inserted.length === 0) {
      ctx.error = new DuelError("QUARTER_CHANGED", 409);
      return;
    }
    const isC = userId === r.challengerUserId;
    const pending: StreakFields = {};
    if (isC && r.challengerMissStreak !== 0) pending.challengerMissStreak = 0;
    if (!isC && r.opponentMissStreak !== 0) pending.opponentMissStreak = 0;
    const other = isC ? r.opponentUserId! : r.challengerUserId;
    if (!moveOf(st, other, r.quarter)) ctx.pushes.push({ userIds: [other], build: pushText.committed(r.id, r.quarter), quarter: r.quarter, duelId: r.id });
    ctx.changed = true;
    await resolveQuarter(tx, st, ctx, pending);
  });
  return buildView(st, userId);
}

/**
 * Lazy (one duel) and hourly (all): expires open/pending challenges past
 * expires_at and auto-commits in every active duel past its quarter
 * deadline. Returns the number of duels changed.
 */
export async function applyTimeouts(duelId?: string): Promise<number> {
  const only = duelId ? sql`and id = ${duelId}` : sql``;
  const expired = await db.execute<{ id: string; challenger_user_id: string; opponent_user_id: string | null }>(sql`
    update duels set status = 'expired'
    where status in ('open', 'pending') and expires_at <= now() ${only}
    returning id, challenger_user_id, opponent_user_id`);
  for (const e of expired) {
    notifyDuelUpdate([e.challenger_user_id, e.opponent_user_id].filter((u): u is string => !!u), { id: e.id, status: "expired", quarter: 0 });
  }

  const due = await db.execute<{ id: string }>(sql`
    select id from duels where status = 'active' and quarter_deadline <= now() ${only} order by quarter_deadline limit 500`);
  let changed = expired.length;
  for (const d of due) {
    const { result } = await withLockedDuel(d.id, null, (tx, st, ctx) => advanceTimeouts(tx, st, ctx));
    if (result) changed++;
  }
  return changed;
}

/**
 * Account deletion: cancels the user's open/pending duels, forfeits their
 * active ones (the other side wins; the deleted user's rating is skipped
 * and their delta stays null), and deletes their duel_ratings rows. Pass
 * the caller's transaction to run inside it, then call `notify()` after
 * that transaction commits. Without `tx` it runs and notifies by itself.
 */
export async function forfeitDuelsForDeletedUser(userId: string, tx?: Tx): Promise<{ duelIds: string[]; notify: () => void }> {
  const ctxs: Ctx[] = [];
  const cancelledNotes: { ids: string[]; d: { id: string; status: string; quarter: number } }[] = [];
  const run = async (t: Tx) => {
    const cancelled = await t.execute<{ id: string; challenger_user_id: string; opponent_user_id: string | null }>(sql`
      update duels set status = 'cancelled'
      where status in ('open', 'pending') and (challenger_user_id = ${userId} or opponent_user_id = ${userId})
      returning id, challenger_user_id, opponent_user_id`);
    for (const c of cancelled) {
      const other = c.challenger_user_id === userId ? c.opponent_user_id : c.challenger_user_id;
      if (other) cancelledNotes.push({ ids: [other], d: { id: c.id, status: "cancelled", quarter: 0 } });
    }
    const active = await t.execute<{ id: string }>(sql`
      select id from duels where status = 'active' and (challenger_user_id = ${userId} or opponent_user_id = ${userId}) order by id`);
    for (const a of active) {
      const { ctx } = await withLockedDuel(
        a.id,
        null,
        async (lt, st, c) => {
          c.silent.add(userId);
          const r = st.row;
          if (r.status !== "active") return;
          const winner = r.challengerUserId === userId ? r.opponentUserId : r.challengerUserId;
          await finishDuel(lt, r, { winnerUserId: winner, reason: "forfeit", skipRatingFor: userId }, c);
          if (c.final) st.row = c.final;
        },
        t
      );
      ctxs.push(ctx);
    }
    await t.execute(sql`delete from duel_ratings where user_id = ${userId}`);
    return [...cancelled.map((c) => c.id), ...active.map((a) => a.id)];
  };
  const duelIds = tx ? await run(tx) : await db.transaction(run);
  const notify = () => {
    for (const n of cancelledNotes) notifyDuelUpdate(n.ids, n.d);
    ctxs.forEach(flush);
  };
  if (!tx) notify();
  return { duelIds, notify };
}

// ---------------------------------------------------------------------------
// Lists, ladder, rating
// ---------------------------------------------------------------------------

// Mirrors softReset in duelEngine.ts: keep the two in sync.
/** A user's rating for `season`: that month's row, else the soft reset of their latest earlier one. */
const ratingSql = (userExpr: ReturnType<typeof sql>, season: string) => sql`coalesce(
  (select r.rating from duel_ratings r where r.user_id = ${userExpr} and r.season = ${season}),
  round((coalesce((select r.rating from duel_ratings r where r.user_id = ${userExpr} and r.season < ${season} order by r.season desc limit 1), ${sql.raw(String(START_RATING))}) + ${sql.raw(String(START_RATING))}) / 2.0)::int)`;

export async function listMyDuels(userId: string): Promise<DuelSummary[]> {
  const query = () =>
    db.execute<{
      id: string;
      status: string;
      quarter: number;
      quarter_deadline: string | null;
      expires_at: string;
      challenger_user_id: string;
      opponent_user_id: string | null;
      challenger_score: number;
      opponent_score: number;
      winner_user_id: string | null;
      c_name: string;
      o_name: string | null;
      my_moved: boolean;
      due: boolean;
    }>(sql`
      select d.id, d.status, d.quarter, d.quarter_deadline, d.expires_at, d.challenger_user_id, d.opponent_user_id,
        d.challenger_score, d.opponent_score, d.winner_user_id, cu.username as c_name, ou.username as o_name,
        exists (select 1 from duel_moves m where m.duel_id = d.id and m.quarter = d.quarter and m.user_id = ${userId}) as my_moved,
        ((d.status = 'active' and d.quarter_deadline <= now()) or (d.status in ('open', 'pending') and d.expires_at <= now())) as due
      from duels d
      join users cu on cu.id = d.challenger_user_id
      left join users ou on ou.id = d.opponent_user_id
      where (d.challenger_user_id = ${userId} or d.opponent_user_id = ${userId}) and d.status <> 'cancelled'
      order by greatest(d.created_at, d.accepted_at, d.finished_at) desc
      limit 50`);
  let rows = await query();
  const due = rows.filter((r) => r.due);
  if (due.length) {
    for (const d of due) await applyTimeouts(d.id);
    rows = await query();
  }
  return rows.map((r) => {
    const isC = r.challenger_user_id === userId;
    const them = isC ? r.opponent_user_id : r.challenger_user_id;
    const themName = isC ? r.o_name : r.c_name;
    const status = r.status;
    return {
      id: r.id,
      status,
      opponent: them && themName ? { id: them, username: themName } : null,
      score: isC ? { me: r.challenger_score, them: r.opponent_score } : { me: r.opponent_score, them: r.challenger_score },
      quarter: r.quarter,
      myMove: (status === "active" && !r.my_moved) || (status === "pending" && !isC),
      deadline: status === "active" ? iso(r.quarter_deadline) : status === "open" || status === "pending" ? iso(r.expires_at) : null,
      result: resultFor({ status, winnerUserId: r.winner_user_id }, userId),
    };
  });
}

export async function listOpenDuels(userId: string): Promise<OpenDuel[]> {
  const season = seasonKey(new Date());
  const rows = await db.execute<{ id: string; expires_at: string; challenger_user_id: string; username: string; rating: number }>(sql`
    with me as (select ${ratingSql(sql`${userId}::uuid`, season)} as rating)
    select d.id, d.expires_at, d.challenger_user_id, u.username, x.rating
    from duels d
    join users u on u.id = d.challenger_user_id
    cross join lateral (select ${ratingSql(sql`d.challenger_user_id`, season)} as rating) x
    cross join me
    where d.status = 'open' and d.expires_at > now() and d.challenger_user_id <> ${userId} and u.deleted_at is null
    order by abs(x.rating - me.rating), d.created_at desc
    limit 50`);
  return rows.map((r) => ({
    id: r.id,
    challenger: { id: r.challenger_user_id, username: r.username, rating: r.rating, division: divisionFor(r.rating) },
    expiresAt: iso(r.expires_at)!,
  }));
}

const LADDER_TTL_MS = 60_000;
const ladderCache = new Map<string, { at: number; rows: LadderRow[] }>();

export async function getLadder(leagueId: string | null): Promise<LadderRow[]> {
  const season = seasonKey(new Date());
  const key = `${season}:${leagueId ?? "global"}`;
  const hit = ladderCache.get(key);
  if (hit && Date.now() - hit.at < LADDER_TTL_MS) return hit.rows;
  const rows = await db.execute<{ user_id: string; username: string; rating: number; wins: number; losses: number; draws: number }>(sql`
    select r.user_id, u.username, r.rating, r.wins, r.losses, r.draws
    from duel_ratings r join users u on u.id = r.user_id
    where r.season = ${season} and u.deleted_at is null
      ${leagueId ? sql`and exists (select 1 from league_members m where m.league_id = ${leagueId} and m.user_id = r.user_id)` : sql``}
    order by r.rating desc, r.wins desc, u.username
    limit 100`);
  const out = rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    rating: r.rating,
    division: divisionFor(r.rating),
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
  }));
  ladderCache.set(key, { at: Date.now(), rows: out });
  return out;
}

export async function getMyRating(userId: string): Promise<MyRating> {
  const season = seasonKey(new Date());
  const [r] = await db.execute<{
    rating: number;
    wins: number | null;
    losses: number | null;
    draws: number | null;
    paid_today: number;
    past: { season: string; rk: number; rating: number }[];
  }>(sql`
    select ${ratingSql(sql`${userId}::uuid`, season)} as rating,
      cur.wins, cur.losses, cur.draws,
      (select count(*)::int from duels d where d.winner_user_id = ${userId} and d.prize_paid
        and (d.finished_at at time zone 'Europe/Athens')::date = ${ATHENS_TODAY}) as paid_today,
      (select coalesce(json_agg(json_build_object('season', t.season, 'rk', t.rk, 'rating', t.rating) order by t.season), '[]'::json)
        from (
          select season, user_id, rating, rank() over (partition by season order by rating desc) as rk
          from duel_ratings
          where season < ${season} and season in (select season from duel_ratings where user_id = ${userId})
        ) t where t.user_id = ${userId}) as past
    from (select 1) one
    left join duel_ratings cur on cur.user_id = ${userId} and cur.season = ${season}`);
  return {
    rating: r.rating,
    division: divisionFor(r.rating),
    season,
    wins: r.wins ?? 0,
    losses: r.losses ?? 0,
    draws: r.draws ?? 0,
    paidWinsLeftToday: Math.max(0, MAX_PAID_WINS_PER_DAY - r.paid_today),
    seasonBadges: badgesFrom(r.past),
  };
}

// Season badges from finished months: top 3 by rating among everyone who
// played that month, and a month finished at All-Star rating or better.
function badgesFrom(past: { season: string; rk: number; rating: number }[]): SeasonBadge[] {
  const badges: SeasonBadge[] = [];
  for (const p of past) {
    if (p.rk <= 3) badges.push({ season: p.season, kind: "top3" });
    if (p.rating >= 1200) badges.push({ season: p.season, kind: "all_star" });
  }
  return badges;
}

/** Season badges for several users (league member sheets), in one query. */
export async function getSeasonBadges(userIds: string[]): Promise<Map<string, SeasonBadge[]>> {
  const out = new Map<string, SeasonBadge[]>();
  if (userIds.length === 0) return out;
  const ids = sql.join(
    userIds.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  const rows = await db.execute<{ user_id: string; season: string; rk: number; rating: number }>(sql`
    select user_id, season, rk, rating from (
      select user_id, season, rating, rank() over (partition by season order by rating desc)::int as rk
      from duel_ratings
      where season < ${seasonKey(new Date())} and season in (select season from duel_ratings where user_id in (${ids}))
    ) t where t.user_id in (${ids}) order by season`);
  const byUser = new Map<string, { season: string; rk: number; rating: number }[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  for (const [userId, past] of byUser) {
    const badges = badgesFrom(past);
    if (badges.length > 0) out.set(userId, badges);
  }
  return out;
}
