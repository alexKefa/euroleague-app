import type { Game, Schedule, SpinStatus } from "../../core/models";

/**
 * Pure round logic behind the dashboard's round header + checklist
 * (2026-10-07 redesign, docs/superpowers/specs/2026-10-07-dashboard-round-checklist-design.md).
 * No Angular imports, so frontend/scripts/check-round-status.ts can run it
 * under plain Node.
 */

export type ChecklistRowId = "picks" | "topScorer" | "fantasy" | "spin";

export interface FantasyInput {
  round: number | null;
  hasSquad: boolean;
  lockAt: string | null;
  fullTimeoutAvailable: boolean;
  carriedOver: boolean;
}

export interface RoundStatusInput {
  schedule: Schedule;
  predictedGameIds: Set<string>;
  // null = not loaded or failed: the row is hidden rather than guessed.
  topScorerGameIds: Set<string> | null;
  fantasy: FantasyInput | null;
  spin: SpinStatus | null;
  everPicked: boolean;
}

export interface ChecklistRow {
  id: ChecklistRowId;
  done: boolean;
  link: "/predictions" | "/fantasy" | "/wheel";
  // Only picks and fantasy carry one, and only while open.
  deadline: Date | null;
  count?: { done: number; total: number };
  nextAt?: Date | null;
  carriedFromRound?: number | null;
  fullTimeoutAvailable?: boolean;
  bonus?: boolean;
}

export type RoundPhase = "open" | "allDone" | "between";

export interface RoundStatus {
  round: number;
  phase: RoundPhase;
  rows: ChecklistRow[];
  doneCount: number;
  nextDeadline: { at: Date; kind: "picks" | "fantasy" | "firstGame" } | null;
  firstRun: boolean;
}

const BASE_ORDER: ChecklistRowId[] = ["picks", "topScorer", "fantasy", "spin"];

export function buildRoundStatus(input: RoundStatusInput, now: number): RoundStatus {
  const { schedule } = input;
  const games = schedule.games;
  // Picks lock at tip-off, so a past tip-off counts as started even if the
  // feed hasn't flipped the status yet.
  const started = (game: Game) => game.status !== "scheduled" || Date.parse(game.tipoffAt) <= now;
  const notStarted = games.filter((game) => !started(game));
  const earliest = (list: Game[]) =>
    list.length ? new Date(Math.min(...list.map((game) => Date.parse(game.tipoffAt)))) : null;

  const firstRun = !input.everPicked;
  if (notStarted.length === 0) {
    return { round: schedule.round, phase: "between", rows: [], doneCount: 0, nextDeadline: null, firstRun };
  }

  const rows: ChecklistRow[] = [];

  const openPicks = notStarted.filter((game) => !input.predictedGameIds.has(game.id));
  rows.push({
    id: "picks",
    done: openPicks.length === 0,
    link: "/predictions",
    deadline: earliest(openPicks),
    count: { done: games.filter((game) => input.predictedGameIds.has(game.id)).length, total: games.length },
  });

  if (input.topScorerGameIds) {
    const picked = games.filter((game) => input.topScorerGameIds!.has(game.id)).length;
    rows.push({ id: "topScorer", done: picked > 0, link: "/predictions", deadline: null, count: { done: picked, total: 0 }, bonus: true });
  }

  const f = input.fantasy;
  // No squad and the round already locked: nothing left to do this round,
  // so the row is missed (hidden), not an open job with a past deadline.
  const fantasyMissed = !!f && !f.hasSquad && !!f.lockAt && Date.parse(f.lockAt) <= now;
  if (f && f.round !== null && f.round === schedule.round && !fantasyMissed) {
    rows.push({
      id: "fantasy",
      done: f.hasSquad,
      link: "/fantasy",
      deadline: !f.hasSquad && f.lockAt ? new Date(f.lockAt) : null,
      carriedFromRound: f.carriedOver ? schedule.round - 1 : null,
      fullTimeoutAvailable: f.fullTimeoutAvailable,
    });
  }

  if (input.spin) {
    rows.push({
      id: "spin",
      done: !input.spin.canSpin,
      link: "/wheel",
      deadline: null,
      nextAt: input.spin.nextEligibleAt ? new Date(input.spin.nextEligibleAt) : null,
    });
  }

  const rank = (row: ChecklistRow) => BASE_ORDER.indexOf(row.id);
  const open = rows
    .filter((row) => !row.done)
    .sort((a, b) => {
      const da = a.deadline?.getTime() ?? Infinity;
      const db = b.deadline?.getTime() ?? Infinity;
      return da !== db ? da - db : rank(a) - rank(b);
    });
  const done = rows.filter((row) => row.done).sort((a, b) => rank(a) - rank(b));
  const ordered = [...open, ...done];

  const firstDeadline = open.find((row) => row.deadline);
  let nextDeadline: RoundStatus["nextDeadline"] = null;
  if (firstDeadline?.deadline) {
    nextDeadline = { at: firstDeadline.deadline, kind: firstDeadline.id as "picks" | "fantasy" };
  } else {
    const first = earliest(notStarted);
    if (first) nextDeadline = { at: first, kind: "firstGame" };
  }

  return {
    round: schedule.round,
    phase: open.length === 0 ? "allDone" : "open",
    rows: ordered,
    doneCount: done.length,
    nextDeadline,
    firstRun,
  };
}

export function formatCountdown(ms: number, units: { d: string; h: string }): string {
  if (ms <= 0) return "0:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  if (ms >= 86_400_000) {
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3600);
    return `${days}${units.d} ${hours}${units.h}`;
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function countdownTone(ms: number): "normal" | "soon" | "urgent" {
  if (ms < 600_000) return "urgent";
  if (ms < 3_600_000) return "soon";
  return "normal";
}
