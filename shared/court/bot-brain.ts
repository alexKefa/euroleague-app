// Court bots (admin testing): a server-side player that runs around, shoots,
// drives in for layups and plays its H-O-R-S-E turns. Pure and step-driven:
// the room calls step() 20 times a second with what the bot can see and
// applies what it returns (a move, and sometimes a shot). No timers, no I/O.
import { PLAYER_SPEED } from "./constants.js";
import { clampPlayerPosition, insideThreePoint, rimCenter } from "./geometry.js";
import type { HorsePhase } from "./horse.js";
import type { PlayerAnim, ReactionId } from "./protocol.js";
import { gaussian } from "./rng.js";

export interface BotView {
  x: number;
  z: number;
  phase: HorsePhase;
  turnId: string;
  spot: { x: number; z: number } | null;
  /** A shot of ours is still in the air / cooling down. */
  busy: boolean;
}

export interface BotOutput {
  move?: { x: number; z: number; rotY: number; anim: PlayerAnim };
  shoot?: { timingError: number; layup: boolean; vx: number; vz: number };
}

type Action =
  | { t: "run"; x: number; z: number; speed: number }
  | { t: "wait"; ms: number }
  /** Hold the shot (the charge pose), drifting at (vx, vz), then release. */
  | { t: "charge"; ms: number; layup: boolean; vx: number; vz: number };

const RUN = PLAYER_SPEED * 0.82;
const rim = rimCenter("A");

export class BotBrain {
  private queue: Action[] = [];
  private current: (Action & { startedAt: number }) | null = null;
  private horseKey = "";
  private rotY = Math.PI;

  constructor(
    readonly id: string,
    private readonly rand: () => number = Math.random
  ) {}

  step(now: number, dt: number, v: BotView): BotOutput {
    const inGame = v.phase === "setting" || v.phase === "matching";
    if (inGame) {
      const key = `${v.phase}:${v.turnId}:${v.spot?.x ?? ""}:${v.spot?.z ?? ""}`;
      if (key !== this.horseKey) {
        this.horseKey = key;
        this.current = null;
        this.queue = v.turnId === this.id ? this.horseTurn(v) : [{ t: "wait", ms: 400 }];
      }
    } else if (this.horseKey) {
      this.horseKey = "";
      this.current = null;
      this.queue = [];
    }
    if (!this.current) {
      if (!this.queue.length) {
        // Free play waits for its last shot to land; in a game we just idle until our turn.
        if (v.busy || inGame) return this.stand(v);
        this.queue = this.freePlay(v);
      }
      this.current = { ...this.queue.shift()!, startedAt: now };
    }
    const a = this.current;
    switch (a.t) {
      case "wait":
        if (now - a.startedAt >= a.ms) this.current = null;
        return this.stand(v);
      case "run": {
        const dx = a.x - v.x;
        const dz = a.z - v.z;
        const d = Math.hypot(dx, dz);
        const step = a.speed * dt;
        if (d <= step) {
          this.current = null;
          return this.moveTo(a.x, a.z, dx, dz, d > 0.01 ? "run" : "idle");
        }
        return this.moveTo(v.x + (dx / d) * step, v.z + (dz / d) * step, dx, dz, "run");
      }
      case "charge": {
        const out = this.moveTo(v.x + a.vx * dt, v.z + a.vz * dt, rim.x - v.x, rim.z - v.z, a.layup ? "layup" : "shoot");
        if (now - a.startedAt >= a.ms) {
          this.current = null;
          out.shoot = { timingError: this.timing(), layup: a.layup, vx: a.vx, vz: a.vz };
        }
        return out;
      }
    }
  }

  /** A cocky reaction to a shot landing, or null (most of the time). */
  reactTo(mine: boolean, made: boolean): ReactionId | null {
    const r = this.rand();
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(this.rand() * xs.length)]!;
    if (mine && made && r < 0.4) return pick(["tooEasy", "cantGuard", "flex", "shush", "fire"] as const);
    if (mine && !made && r < 0.2) return "shrug";
    if (!mine && made && r < 0.25) return pick(["watchThis", "yourMove"] as const);
    if (!mine && !made && r < 0.3) return pick(["brick", "laugh"] as const);
    return null;
  }

  // ---- planning ----

  private freePlay(v: BotView): Action[] {
    const r = this.rand();
    if (r < 0.28) return this.layupDrive(v);
    if (r < 0.78) {
      const a = (this.rand() - 0.5) * 2.6;
      const d = 2.5 + this.rand() * 4.8;
      const p = clampPlayerPosition(rim.x + Math.sin(a) * d, Math.min(1.5, rim.z + Math.cos(a) * d));
      return [{ t: "run", ...p, speed: RUN }, ...this.jumper(), { t: "wait", ms: 500 + this.rand() * 1200 }];
    }
    const p = clampPlayerPosition((this.rand() - 0.5) * 12, -10 + this.rand() * 11);
    return [{ t: "run", ...p, speed: RUN * 0.6 }, { t: "wait", ms: 800 + this.rand() * 1500 }];
  }

  private layupDrive(_v: BotView): Action[] {
    const a = (this.rand() - 0.5) * 1.8;
    const start = { x: rim.x + Math.sin(a) * 5.2, z: rim.z + Math.cos(a) * 5.2 };
    const gatherAt = { x: rim.x + Math.sin(a) * 2.3, z: rim.z + Math.cos(a) * 2.3 };
    // Drift towards the rim through the gather so the drive is real.
    const len = Math.hypot(rim.x - gatherAt.x, rim.z - gatherAt.z);
    const vx = ((rim.x - gatherAt.x) / len) * 2.2;
    const vz = ((rim.z - gatherAt.z) / len) * 2.2;
    return [
      { t: "run", ...start, speed: RUN },
      { t: "run", ...gatherAt, speed: RUN * 1.05 },
      { t: "charge", ms: 380, layup: true, vx, vz },
      { t: "wait", ms: 700 + this.rand() * 1000 },
    ];
  }

  private jumper(): Action[] {
    return [{ t: "charge", ms: 700 + this.rand() * 150, layup: false, vx: 0, vz: 0 }];
  }

  private horseTurn(v: BotView): Action[] {
    const think: Action = { t: "wait", ms: 700 + this.rand() * 1100 };
    if (v.phase === "matching" && v.spot) {
      const p = { x: v.spot.x + (this.rand() - 0.5) * 0.5, z: v.spot.z + (this.rand() - 0.5) * 0.5 };
      return [think, { t: "run", ...p, speed: RUN }, ...this.jumper()];
    }
    return [think, { t: "run", ...this.setSpot(), speed: RUN }, ...this.jumper()];
  }

  /** A spot inside the arc to set from. */
  private setSpot(): { x: number; z: number } {
    for (let i = 0; i < 50; i++) {
      const a = (this.rand() - 0.5) * 2.4;
      const d = 2.5 + this.rand() * 3.6;
      const p = { x: rim.x + Math.sin(a) * d, z: rim.z + Math.cos(a) * d };
      if (insideThreePoint("A", p.x, p.z)) return p;
    }
    return { x: rim.x, z: rim.z + 4 };
  }

  // ---- helpers ----

  private timing(): number {
    return Math.max(-1, Math.min(1, gaussian(this.rand) * 0.28));
  }

  private stand(v: BotView): BotOutput {
    return { move: { x: v.x, z: v.z, rotY: this.rotY, anim: "idle" } };
  }

  private moveTo(x: number, z: number, faceX: number, faceZ: number, anim: PlayerAnim): BotOutput {
    if (Math.hypot(faceX, faceZ) > 0.05) this.rotY = Math.atan2(faceX, faceZ);
    const p = clampPlayerPosition(x, z);
    return { move: { x: p.x, z: p.z, rotY: this.rotY, anim } };
  }
}
