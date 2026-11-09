// Other players on the court (CLUTCH_COURT_SPEC.md §6.4): each is rendered
// ~100 ms in the past, interpolated between buffered server snapshots, posed
// by the procedural rig, with a name tag and their own ball.
import { CanvasTexture, Mesh, SRGBColorSpace, Scene, Sprite, SpriteMaterial, Vector3 } from "three";
import { HoopId, ShotEvent, ShotResult, Vec3 } from "../../../../../../shared/court/types";
import { JERSEY_FONT, JerseyText, createBall } from "./avatar-factory";
import { AvatarBatch, AvatarRig } from "./avatar-rig";
import { BallPlayback } from "./ball-playback";
import { disposeObject } from "./scene-builder";

const INTERP_DELAY_MS = 100;
const MAX_SNAPSHOTS = 30;
const RETURN_MS = 380;
/** The ball blends from the shooter's hand into the simulated arc over this long. */
export const RELEASE_BLEND_MS = 140;

/** A remote shot event, for the engine's sounds and net animation. */
export type RemoteShotEvent = (event: ShotEvent, at: Vector3, hoop: HoopId) => void;

export interface RemoteInfo {
  name: string;
  primary: string;
  secondary: string;
  jersey: JerseyText;
}

interface Snapshot {
  t: number;
  x: number;
  z: number;
  rotY: number;
  anim: string;
}

interface Remote {
  rig: AvatarRig;
  ball: Mesh;
  tag: Sprite;
  buffer: Snapshot[];
  connected: boolean;
  dribble: number;
  /** When their "shoot" anim started (drives the charge pose). */
  chargeStartedAt: number | null;
  shot: { playback: BallPlayback; hoop: HoopId; offset: Vector3 } | null;
  returning: { from: Vector3; startedAt: number } | null;
}

function lerpAngle(a: number, b: number, u: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * u;
}

function nameTag(name: string, accent: string): Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `600 44px ${JERSEY_FONT}`;
  ctx.font = font;
  const text = name.length > 18 ? `${name.slice(0, 17)}…` : name;
  const w = Math.ceil(ctx.measureText(text).width) + 56;
  const h = 68;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = "rgba(8,12,20,0.62)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(26, h / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 44, h / 2 + 2);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const height = 0.3;
  sprite.scale.set((height * w) / h, height, 1);
  sprite.renderOrder = 2;
  return sprite;
}

/** Ball position from a playback, blending out the hand-to-arc offset just after release. */
export function shotBallPosition(pb: BallPlayback, offset: Vector3, now: number, out: Vector3): Vector3 {
  pb.positionAt(now, out);
  const u = 1 - Math.min(1, (now - pb.startedAt) / RELEASE_BLEND_MS);
  if (u > 0) out.addScaledVector(offset, u * u);
  return out;
}

/** Offset between where the ball is now (in hand) and where the simulated arc starts. */
export function releaseOffset(result: ShotResult, ballNow: Vector3): Vector3 {
  const k = result.keyframes;
  return new Vector3(ballNow.x - k[0]! / 100, ballNow.y - k[1]! / 100, ballNow.z - k[2]! / 100);
}

export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();
  private readonly tmp = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly batch: AvatarBatch
  ) {}

  has(id: string): boolean {
    return this.remotes.has(id);
  }

  add(id: string, info: RemoteInfo, x: number, z: number, rotY: number): void {
    if (this.remotes.has(id)) return;
    const slot = this.batch.alloc();
    if (slot === null) return; // court full (shouldn't happen: capacity = max players)
    const rig = new AvatarRig(this.batch, this.scene, slot, info.primary, info.secondary, info.jersey);
    const tag = nameTag(info.name, info.primary);
    const ball = createBall();
    this.scene.add(tag, ball);
    this.remotes.set(id, {
      rig,
      ball,
      tag,
      buffer: [{ t: performance.now(), x, z, rotY, anim: "idle" }],
      connected: true,
      dribble: 0,
      chargeStartedAt: null,
      shot: null,
      returning: null,
    });
  }

  push(id: string, x: number, z: number, rotY: number, anim: string, t: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.buffer.push({ t, x, z, rotY, anim });
    if (r.buffer.length > MAX_SNAPSHOTS) r.buffer.splice(0, r.buffer.length - MAX_SNAPSHOTS);
  }

  /** Play another player's authoritative shot from now. */
  startShot(id: string, result: ShotResult, spin: Vec3, hoop: HoopId, now: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.shot = { playback: new BallPlayback(result, now, spin), hoop, offset: releaseOffset(result, r.ball.position) };
    r.returning = null;
    r.chargeStartedAt = null;
    r.rig.release(now);
  }

  setConnected(id: string, connected: boolean): void {
    const r = this.remotes.get(id);
    if (!r || r.connected === connected) return;
    r.connected = connected;
    (r.tag.material as SpriteMaterial).opacity = connected ? 1 : 0.35;
  }

  remove(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.rig.dispose();
    this.scene.remove(r.tag, r.ball);
    disposeObject(r.tag);
    disposeObject(r.ball);
    this.remotes.delete(id);
  }

  ids(): string[] {
    return [...this.remotes.keys()];
  }

  update(now: number, dt: number, onEvent: RemoteShotEvent): void {
    const renderAt = now - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const buf = r.buffer;
      while (buf.length > 2 && buf[1]!.t <= renderAt) buf.shift();
      const a = buf[0]!;
      const b = buf[1];
      let x = a.x;
      let z = a.z;
      let rotY = a.rotY;
      let anim = a.anim;
      if (b && renderAt > a.t) {
        const u = Math.min(1, (renderAt - a.t) / Math.max(1, b.t - a.t));
        x = a.x + (b.x - a.x) * u;
        z = a.z + (b.z - a.z) * u;
        rotY = lerpAngle(a.rotY, b.rotY, u);
        anim = u > 0.5 ? b.anim : a.anim;
      }

      // "shoot" while their ball is still in hand = charging.
      const charging = anim === "shoot" && !r.shot && !r.returning;
      if (charging && r.chargeStartedAt === null) r.chargeStartedAt = now;
      if (!charging) r.chargeStartedAt = null;
      const running = anim === "run";
      if (running) r.dribble += dt * 9;
      r.rig.update(now, dt, x, z, rotY, {
        moving: running,
        charging,
        chargeSeconds: r.chargeStartedAt === null ? 0 : (now - r.chargeStartedAt) / 1000,
        dribblePhase: r.dribble,
      });
      r.tag.position.set(x, 2.25, z);

      // Ball: in flight, flying back, or in hand.
      if (r.shot) {
        const pb = r.shot.playback;
        shotBallPosition(pb, r.shot.offset, now, r.ball.position);
        r.ball.rotateOnWorldAxis(pb.spin(now).axis, -dt * 7);
        for (const ev of pb.takeEvents(now)) onEvent(ev, r.ball.position, r.shot.hoop);
        if (pb.done(now)) {
          r.returning = { from: r.ball.position.clone(), startedAt: now };
          r.shot = null;
        }
      } else if (r.returning) {
        const u = Math.min(1, (now - r.returning.startedAt) / RETURN_MS);
        const e = u * u * (3 - 2 * u);
        r.rig.ballWorld(this.tmp);
        r.ball.position.lerpVectors(r.returning.from, this.tmp, e);
        r.ball.position.y += Math.sin(u * Math.PI) * 0.8;
        if (u >= 1) r.returning = null;
      } else {
        r.rig.ballWorld(r.ball.position);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}
