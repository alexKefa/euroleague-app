// Other players on the court (CLUTCH_COURT_SPEC.md §6.4): each is rendered
// ~100 ms in the past, interpolated between buffered server snapshots, with
// a name tag above the head.
import { CanvasTexture, Mesh, SRGBColorSpace, Scene, Sprite, SpriteMaterial } from "three";
import { BALL_RADIUS } from "../../../../../../shared/court/constants";
import { Avatar, JERSEY_FONT, JerseyText, createAvatar, createBall } from "./avatar-factory";
import { disposeObject } from "./scene-builder";

const INTERP_DELAY_MS = 100;
const MAX_SNAPSHOTS = 30;

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
  avatar: Avatar;
  ball: Mesh;
  tag: Sprite;
  buffer: Snapshot[];
  connected: boolean;
  dribble: number;
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
  sprite.position.y = 2.2;
  sprite.renderOrder = 2;
  return sprite;
}

export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();

  constructor(private readonly scene: Scene) {}

  has(id: string): boolean {
    return this.remotes.has(id);
  }

  add(id: string, info: RemoteInfo, x: number, z: number, rotY: number): void {
    if (this.remotes.has(id)) return;
    const avatar = createAvatar(info.primary, info.secondary, info.jersey);
    avatar.root.position.set(x, 0, z);
    avatar.root.rotation.y = rotY;
    const tag = nameTag(info.name, info.primary);
    avatar.root.add(tag);
    const ball = createBall();
    this.scene.add(avatar.root, ball);
    this.remotes.set(id, { avatar, ball, tag, buffer: [{ t: performance.now(), x, z, rotY, anim: "idle" }], connected: true, dribble: 0 });
  }

  push(id: string, x: number, z: number, rotY: number, anim: string, t: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.buffer.push({ t, x, z, rotY, anim });
    if (r.buffer.length > MAX_SNAPSHOTS) r.buffer.splice(0, r.buffer.length - MAX_SNAPSHOTS);
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
    this.scene.remove(r.avatar.root, r.ball);
    disposeObject(r.avatar.root);
    disposeObject(r.ball);
    this.remotes.delete(id);
  }

  ids(): string[] {
    return [...this.remotes.keys()];
  }

  update(now: number, dt: number): void {
    const renderAt = now - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const buf = r.buffer;
      // Drop snapshots older than the pair we interpolate between.
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
      const root = r.avatar.root;
      root.position.set(x, 0, z);
      root.rotation.y = rotY;

      const running = anim === "run";
      const target = anim === "shoot" ? 0.9 : running ? 1 + Math.sin(r.dribble * 2) * 0.025 : 1;
      r.avatar.body.scale.y += (target - r.avatar.body.scale.y) * Math.min(1, dt * 18);
      if (running) r.dribble += dt * 9;

      // Ball in the right hand; bounced while running, raised while shooting.
      const fx = Math.sin(rotY);
      const fz = Math.cos(rotY);
      if (anim === "shoot") {
        r.ball.position.set(x + fx * 0.15, 2.1, z + fz * 0.15);
      } else {
        const y = running ? BALL_RADIUS + Math.abs(Math.cos(r.dribble)) * 0.85 : 1.0;
        r.ball.position.set(x - fz * 0.34 + fx * 0.25, y, z + fx * 0.34 + fz * 0.25);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}
