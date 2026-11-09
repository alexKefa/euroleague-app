// H-O-R-S-E rules (docs/superpowers/specs/2026-11-09-horse-design.md).
// A pure reducer: reduce(state, input, now) -> { state, effects }. No timers,
// no I/O; the room passes `now`, executes the effects and mirrors the state.
import { insideThreePoint } from "./geometry.js";
import type { HoopId } from "./types.js";

export const HORSE_TURN_MS = 20000;
export const HORSE_DISCONNECT_MS = 30000;
export const HORSE_SPOT_RADIUS = 1.0;
export const HORSE_RETURN_MS = 10000;
export const HORSE_WORD = "HORSE";

export type HorsePhase = "free" | "setting" | "matching" | "over";
export type ShotRejectReason = "notYourTurn" | "outsideArc" | "offSpot" | "busy";
export type HorseEventKind = "set" | "matched" | "letter" | "eliminated" | "winner" | "turn";

export interface HorsePlayer {
  id: string;
  letters: number;
  eliminated: boolean;
  eliminatedAt: number | null;
  disconnectedAt: number | null;
}

export interface HorseState {
  phase: HorsePhase;
  /** Participant ids in join order, fixed at start. */
  order: string[];
  /** Only game participants. */
  players: Record<string, HorsePlayer>;
  setterId: string | null;
  turnId: string | null;
  spot: { x: number; z: number; hoop: HoopId } | null;
  matchQueue: string[];
  /** ms; null while a shot is resolving or nobody can take a turn. */
  deadline: number | null;
  resolving: { playerId: string; remainingMs: number } | null;
  winnerId: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface HorseResult {
  winnerId: string | null;
  startedAt: number;
  endedAt: number;
  players: { id: string; letters: number; placement: number }[];
}

export type HorseInput =
  | { type: "start"; by: string; ownerId: string; players: { id: string; joinOrder: number; connected: boolean }[] }
  | { type: "shotFired"; playerId: string }
  | { type: "shotResult"; playerId: string; made: boolean; x: number; z: number }
  | { type: "tick" }
  | { type: "disconnect"; playerId: string }
  | { type: "reconnect"; playerId: string }
  | { type: "leave"; playerId: string };

export type HorseEffect =
  | { type: "event"; kind: HorseEventKind; playerId: string | null; letters?: string; remainingMs?: number }
  | { type: "save"; result: HorseResult }
  | { type: "returnToFree"; afterMs: number };

export function initialHorseState(): HorseState {
  return {
    phase: "free",
    order: [],
    players: {},
    setterId: null,
    turnId: null,
    spot: null,
    matchQueue: [],
    deadline: null,
    resolving: null,
    winnerId: null,
    startedAt: null,
    endedAt: null,
  };
}

export function lettersOf(n: number): string {
  return HORSE_WORD.slice(0, Math.max(0, Math.min(HORSE_WORD.length, n)));
}

type StartPlayer = { id: string; joinOrder: number; connected: boolean };

/** At least 2 connected; the owner starts, or the earliest-joined connected player if the owner is away. */
export function canStart(players: StartPlayer[], ownerId: string, by: string): boolean {
  const connected = players.filter((p) => p.connected);
  if (connected.length < 2) return false;
  if (connected.some((p) => p.id === ownerId)) return by === ownerId;
  const earliest = [...connected].sort((a, b) => a.joinOrder - b.joinOrder)[0]!;
  return by === earliest.id;
}

/** Whether `playerId` may shoot from (x, z) right now; null = allowed. Shared by server and client. */
export function shotGate(
  view: { phase: HorsePhase; turnId: string | null; spot: { x: number; z: number } | null; resolving: boolean },
  playerId: string,
  x: number,
  z: number
): ShotRejectReason | null {
  if (view.phase === "free" || view.phase === "over") return null;
  if (view.resolving) return "busy";
  if (playerId !== view.turnId) return "notYourTurn";
  if (view.phase === "setting" && !insideThreePoint("A", x, z)) return "outsideArc";
  if (view.phase === "matching" && view.spot && Math.hypot(x - view.spot.x, z - view.spot.z) > HORSE_SPOT_RADIUS) return "offSpot";
  return null;
}

// ---------------- reducer ----------------

function clone(s: HorseState): HorseState {
  const players: Record<string, HorsePlayer> = {};
  for (const [id, p] of Object.entries(s.players)) players[id] = { ...p };
  return {
    ...s,
    order: [...s.order],
    players,
    spot: s.spot ? { ...s.spot } : null,
    matchQueue: [...s.matchQueue],
    resolving: s.resolving ? { ...s.resolving } : null,
  };
}

/** Can take a turn: in the game, not eliminated, connected. */
function isActive(s: HorseState, id: string): boolean {
  const p = s.players[id];
  return !!p && !p.eliminated && p.disconnectedAt === null;
}

/** The next active player after `id` in join order (cyclic), excluding `id`; null if none. */
function nextActiveAfter(s: HorseState, id: string | null): string | null {
  const n = s.order.length;
  const start = id === null ? -1 : s.order.indexOf(id);
  for (let k = 1; k <= n; k++) {
    const cand = s.order[(start + k + n) % n]!;
    if (cand !== id && isActive(s, cand)) return cand;
  }
  return null;
}

class Run {
  readonly effects: HorseEffect[] = [];
  constructor(
    public s: HorseState,
    readonly now: number
  ) {}

  emit(kind: HorseEventKind, playerId: string | null, extra: { letters?: string; remainingMs?: number } = {}): void {
    this.effects.push({ type: "event", kind, playerId, ...extra });
  }

  beginTurn(id: string | null): void {
    this.s.turnId = id;
    this.s.deadline = id === null ? null : this.now + HORSE_TURN_MS;
    if (id !== null) this.emit("turn", id, { remainingMs: HORSE_TURN_MS });
  }

  eliminate(id: string): void {
    const p = this.s.players[id];
    if (!p || p.eliminated) return;
    p.eliminated = true;
    p.eliminatedAt = this.now;
    this.emit("eliminated", id, { letters: lettersOf(p.letters) });
  }

  /** Over when at most one non-eliminated participant remains. Returns true if the game ended. */
  checkWinner(): boolean {
    const s = this.s;
    if (s.phase === "free" || s.phase === "over") return s.phase === "over";
    const alive = s.order.filter((id) => !s.players[id]!.eliminated);
    if (alive.length > 1) return false;
    s.phase = "over";
    s.winnerId = alive[0] ?? null;
    s.turnId = null;
    s.deadline = null;
    s.resolving = null;
    s.matchQueue = [];
    s.endedAt = this.now;
    if (s.winnerId) this.emit("winner", s.winnerId);
    const losers = s.order
      .filter((id) => id !== s.winnerId)
      .sort((a, b) => (s.players[b]!.eliminatedAt ?? 0) - (s.players[a]!.eliminatedAt ?? 0));
    const ranked = s.winnerId ? [s.winnerId, ...losers] : losers;
    this.effects.push({
      type: "save",
      result: {
        winnerId: s.winnerId,
        startedAt: s.startedAt ?? this.now,
        endedAt: this.now,
        players: ranked.map((id, i) => ({ id, letters: s.players[id]!.letters, placement: i + 1 })),
      },
    });
    this.effects.push({ type: "returnToFree", afterMs: HORSE_RETURN_MS });
    return true;
  }

  /** A new setting turn for the next active player after `after`. */
  rotateSetter(after: string | null): void {
    const s = this.s;
    s.phase = "setting";
    s.spot = null;
    s.matchQueue = [];
    s.setterId = nextActiveAfter(s, after);
    this.beginTurn(s.setterId);
  }

  /** Next matcher in the queue, or the round ends and the setter role rotates. */
  advanceMatching(): void {
    const s = this.s;
    while (s.matchQueue.length) {
      const id = s.matchQueue.shift()!;
      if (isActive(s, id)) {
        this.beginTurn(id);
        return;
      }
    }
    this.rotateSetter(s.setterId);
  }

  /** Resolve the current turn's shot (or a timeout, which counts as a miss). */
  resolveTurn(playerId: string, made: boolean, at: { x: number; z: number } | null): void {
    const s = this.s;
    if (s.phase === "setting") {
      if (made && at) {
        s.spot = { x: at.x, z: at.z, hoop: "A" };
        s.phase = "matching";
        this.emit("set", playerId);
        // Matchers: every active player after the setter, in join order.
        const n = s.order.length;
        const from = s.order.indexOf(playerId);
        s.matchQueue = [];
        for (let k = 1; k < n; k++) {
          const id = s.order[(from + k) % n]!;
          if (isActive(s, id)) s.matchQueue.push(id);
        }
        this.advanceMatching();
      } else {
        this.rotateSetter(playerId);
      }
      return;
    }
    if (s.phase === "matching") {
      const p = s.players[playerId];
      if (made) {
        this.emit("matched", playerId);
      } else if (p && !p.eliminated) {
        p.letters += 1;
        this.emit("letter", playerId, { letters: lettersOf(p.letters) });
        if (p.letters >= HORSE_WORD.length) this.eliminate(playerId);
      }
      if (this.checkWinner()) return;
      this.advanceMatching();
    }
  }
}

export function reduce(state: HorseState, input: HorseInput, now: number): { state: HorseState; effects: HorseEffect[] } {
  switch (input.type) {
    case "start": {
      if (state.phase !== "free") return { state, effects: [] };
      if (!canStart(input.players, input.ownerId, input.by)) return { state, effects: [] };
      const run = new Run(initialHorseState(), now);
      const s = run.s;
      const participants = input.players.filter((p) => p.connected).sort((a, b) => a.joinOrder - b.joinOrder);
      s.order = participants.map((p) => p.id);
      for (const id of s.order) s.players[id] = { id, letters: 0, eliminated: false, eliminatedAt: null, disconnectedAt: null };
      s.startedAt = now;
      s.phase = "setting";
      s.setterId = s.order[0]!;
      run.beginTurn(s.setterId);
      return { state: s, effects: run.effects };
    }
    case "shotFired": {
      if ((state.phase !== "setting" && state.phase !== "matching") || state.resolving || state.turnId !== input.playerId) {
        return { state, effects: [] };
      }
      const s = clone(state);
      s.resolving = { playerId: input.playerId, remainingMs: Math.max(0, (s.deadline ?? now) - now) };
      s.deadline = null;
      return { state: s, effects: [] };
    }
    case "shotResult": {
      if (!state.resolving || state.resolving.playerId !== input.playerId) return { state, effects: [] };
      const run = new Run(clone(state), now);
      run.s.resolving = null;
      run.resolveTurn(input.playerId, input.made, { x: input.x, z: input.z });
      return { state: run.s, effects: run.effects };
    }
    default:
      return { state, effects: [] };
  }
}
