// The court's surroundings that make it the owner's court: a street-art mural
// wall behind hoop A in the club's colours, a jumbotron on top of it (next
// game / live score / H-O-R-S-E standings, fed by the page), and bleachers on
// both sidelines with fans in team colours who jump up on every make.
//
// Draw calls: 4 in total. All the concrete and steel is one InstancedMesh,
// the whole crowd is another (one capsule geometry, per-instance colours),
// plus the mural plane and the jumbotron screen.
import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Vector3,
} from "three";
import { FENCE } from "../../../../../../shared/court/geometry";
import { JERSEY_FONT } from "./avatar-factory";

export interface VenueTeam {
  /** Full club name ("" when the owner has no club). */
  name: string;
  /** Display code, e.g. "PAO" ("" when none). */
  code: string;
  primary: string;
  secondary: string;
  logo: HTMLImageElement | null;
}

export interface TeamChip {
  code: string;
  color: string;
}

/** What the jumbotron shows. Built by the page (it has the data and the language). */
export type JumbotronContent =
  | { kind: "team" }
  | {
      kind: "game";
      /** "NEXT GAME" / "FINAL" / "LIVE" (already translated). */
      label: string;
      live: boolean;
      home: TeamChip;
      away: TeamChip;
      homeScore: number | null;
      awayScore: number | null;
      /** Date and time, or the quarter and clock. */
      sub: string;
    }
  | { kind: "horse"; title: string; rows: { name: string; letters: string; turn: boolean; out: boolean }[] };

// ---- layout (metres) ----
const WALL_Z = FENCE.minZ - 1.2;
const WALL_W = 18;
const WALL_H = 4.6;
const SCREEN_W = 6.2;
const SCREEN_H = 3.1;
const SCREEN_Y = WALL_H + 0.9 + SCREEN_H / 2;
const STAND_GAP = 0.9; // fence to first step
const STEP_D = 0.85;
const STEP_H = 0.45;
const STEPS = 4;
const STAND_LEN = 11;
/** Stands run from 2 m inside the back fence towards midcourt. */
const STAND_Z = FENCE.minZ + 2 + STAND_LEN / 2;

const HORSE = "HORSE";

export class Venue {
  readonly crowd: Crowd;
  readonly jumbotron: Jumbotron;

  constructor(scene: Scene, team: VenueTeam) {
    buildConcrete(scene);
    buildMural(scene, team);
    this.crowd = new Crowd(scene, team);
    this.jumbotron = new Jumbotron(scene, team);
  }

  update(now: number): void {
    this.crowd.update(now);
  }
}

// ---------- concrete and steel (1 draw call) ----------

function buildConcrete(scene: Scene): void {
  const parts: { pos: [number, number, number]; size: [number, number, number]; color: string }[] = [];
  // Mural wall body and its cap.
  parts.push({ pos: [0, WALL_H / 2, WALL_Z - 0.2], size: [WALL_W + 0.4, WALL_H, 0.35], color: "#9d978d" });
  parts.push({ pos: [0, WALL_H + 0.06, WALL_Z - 0.2], size: [WALL_W + 0.6, 0.12, 0.5], color: "#7d776e" });
  // Jumbotron posts and housing.
  const postH = SCREEN_Y - SCREEN_H / 2 - WALL_H;
  for (const x of [-2.2, 2.2]) parts.push({ pos: [x, WALL_H + postH / 2, WALL_Z - 0.3], size: [0.22, postH, 0.22], color: "#2b3138" });
  parts.push({ pos: [0, SCREEN_Y, WALL_Z - 0.3], size: [SCREEN_W + 0.4, SCREEN_H + 0.4, 0.4], color: "#1b2028" });
  // Bleachers: solid concrete steps (the top of each is a seat and the next row's footrest).
  for (const side of [-1, 1]) {
    for (let i = 0; i < STEPS; i++) {
      const h = STEP_H * (i + 1);
      const x = side * (FENCE.maxX + STAND_GAP + (i + 0.5) * STEP_D);
      parts.push({ pos: [x, h / 2, STAND_Z], size: [STEP_D, h, STAND_LEN], color: i % 2 ? "#b4b7bc" : "#c3c6ca" });
    }
    // Back rail.
    const rx = side * (FENCE.maxX + STAND_GAP + STEPS * STEP_D + 0.04);
    parts.push({ pos: [rx, STEP_H * STEPS + 0.5, STAND_Z], size: [0.07, 1.0, STAND_LEN], color: "#3a4048" });
  }
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: "#ffffff" }), parts.length);
  const m = new Matrix4();
  const c = new Color();
  parts.forEach((p, i) => {
    m.makeScale(...p.size).setPosition(...p.pos);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(p.color));
  });
  scene.add(mesh);
}

// ---------- mural (1 draw call) ----------

function buildMural(scene: Scene, team: VenueTeam): void {
  const tex = muralTexture(team);
  const mural = new Mesh(new PlaneGeometry(WALL_W, WALL_H), new MeshLambertMaterial({ map: tex }));
  mural.position.set(0, WALL_H / 2, WALL_Z - 0.01);
  scene.add(mural);
}

function muralTexture(team: VenueTeam): CanvasTexture {
  const W = 2048;
  const H = Math.round((W * WALL_H) / WALL_W);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // Concrete with faint block joints.
  ctx.fillStyle = "#a49d92";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(60,55,50,0.18)";
  ctx.lineWidth = 2;
  const blockW = W / 18;
  const blockH = H / 9;
  for (let r = 0; r < 9; r++) {
    for (let k = 0; k <= 18; k++) {
      const x = k * blockW + (r % 2 ? blockW / 2 : 0);
      ctx.strokeRect(x, r * blockH, blockW, blockH);
    }
  }

  // Big diagonal colour bands.
  const band = (x0: number, w: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, H);
    ctx.lineTo(x0 + w, H);
    ctx.lineTo(x0 + w + H * 0.55, 0);
    ctx.lineTo(x0 + H * 0.55, 0);
    ctx.closePath();
    ctx.fill();
  };
  band(-H * 0.3, W * 0.5, team.primary);
  band(W * 0.47, W * 0.05, team.secondary);
  band(W * 0.55, W * 0.6, team.primary);
  band(W * 0.53, W * 0.012, "#ffffff");

  // Drips under the bands' top edge and paint splatter.
  for (let i = 0; i < 38; i++) {
    const x = rand() * W;
    const len = 20 + rand() * 90;
    ctx.fillStyle = rand() < 0.5 ? team.primary : team.secondary;
    ctx.fillRect(x, H - len - rand() * 30, 5 + rand() * 6, len);
  }
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = 0.5 + rand() * 0.5;
    ctx.fillStyle = [team.secondary, "#ffffff", team.primary][i % 3]!;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, 3 + rand() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Left: the club crest on a white disc. (The centre of the wall sits behind
  // the backboard from most camera angles, so nothing important goes there.)
  const crestX = W * 0.2;
  const crestR = H * 0.36;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(crestX, H * 0.5, crestR, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = team.secondary;
  ctx.stroke();
  if (team.logo) {
    const s = crestR * 1.4;
    const ar = team.logo.width / team.logo.height || 1;
    const w = ar >= 1 ? s : s * ar;
    const h = ar >= 1 ? s / ar : s;
    ctx.drawImage(team.logo, crestX - w / 2, H * 0.5 - h / 2, w, h);
  } else {
    ctx.fillStyle = team.primary;
    ctx.font = `800 ${Math.round(crestR * 0.9)}px ${JERSEY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("C", crestX, H * 0.52);
  }

  // Right: the club code in graffiti block letters (offset shadow + thick outline), name below.
  const word = (team.code || "CLUTCH").toUpperCase();
  const cx = W * 0.74;
  ctx.save();
  ctx.translate(cx, H * 0.47);
  ctx.transform(1, 0, -0.18, 1, 0, 0); // italic lean
  let size = Math.round(H * 0.6);
  ctx.font = `800 ${size}px ${JERSEY_FONT}`;
  while (ctx.measureText(word).width > W * 0.4 && size > 40) {
    size -= 8;
    ctx.font = `800 ${size}px ${JERSEY_FONT}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.fillStyle = "#111318";
  ctx.fillText(word, 14, 14);
  ctx.lineWidth = 22;
  ctx.strokeStyle = "#111318";
  ctx.strokeText(word, 0, 0);
  ctx.lineWidth = 10;
  ctx.strokeStyle = team.secondary;
  ctx.strokeText(word, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(word, 0, 0);
  ctx.restore();

  const name = team.name.toUpperCase();
  if (name) {
    let ns = Math.round(H * 0.1);
    ctx.font = `800 ${ns}px ${JERSEY_FONT}`;
    while (ctx.measureText(name).width > W * 0.42 && ns > 18) {
      ns -= 2;
      ctx.font = `800 ${ns}px ${JERSEY_FONT}`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111318";
    ctx.fillRect(cx - ctx.measureText(name).width / 2 - 24, H * 0.82 - ns * 0.7, ctx.measureText(name).width + 48, ns * 1.4);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, cx, H * 0.82);
  }

  // A small tag, bottom left.
  ctx.save();
  ctx.translate(W * 0.045, H * 0.88);
  ctx.rotate(-0.12);
  ctx.font = `italic 800 ${Math.round(H * 0.08)}px ${JERSEY_FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#111318";
  ctx.lineWidth = 6;
  ctx.textAlign = "left";
  ctx.strokeText("clutch", 0, 0);
  ctx.fillText("clutch", 0, 0);
  ctx.restore();

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- crowd (1 draw call) ----------

const FAN_PARTS = 6; // torso, head, hair, 2 arms, legs
const FAN_SKIN = ["#f1c9a5", "#ddaa82", "#b97f55", "#8a5a3b", "#5e3b27"];
const FAN_HAIR = ["#1a1310", "#2e2016", "#4b3221", "#0e0e0e", "#6e4b2a", "#b8a27a"];
const FAN_PANTS = ["#1f2a3a", "#2b2b2b", "#3b4a5a", "#4a4035"];
const UP = new Vector3(0, 1, 0);

interface Fan {
  seat: Vector3;
  side: number;
  phase: number;
  /** Reaction delay after a make, ms. */
  delay: number;
  /** How hard they cheer (0 = stays seated). */
  eager: number;
}

class Crowd {
  private readonly mesh: InstancedMesh;
  private readonly fans: Fan[] = [];
  private cheerAt = -Infinity;
  private strength = 1;
  private lastIdleAt = 0;
  // scratch
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly s = new Vector3();

  constructor(scene: Scene, team: VenueTeam) {
    let seed = 23;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    const shirts = [team.primary, team.primary, team.primary, team.secondary, team.secondary, "#f4f4f4", "#22262e"];
    const perRow = 13;
    for (const side of [-1, 1]) {
      for (let row = 0; row < STEPS; row++) {
        for (let k = 0; k < perRow; k++) {
          if (rand() < 0.22) continue; // empty seats
          const x = side * (FENCE.maxX + STAND_GAP + row * STEP_D + STEP_D * 0.62);
          const z = STAND_Z - STAND_LEN / 2 + 0.5 + (k + 0.3 * rand()) * ((STAND_LEN - 1) / perRow);
          this.fans.push({
            seat: new Vector3(x, STEP_H * (row + 1), z),
            side,
            phase: rand() * Math.PI * 2,
            delay: rand() * 320,
            eager: rand() < 0.15 ? 0 : 0.6 + rand() * 0.4,
          });
        }
      }
    }
    this.mesh = new InstancedMesh(new CapsuleGeometry(0.5, 1, 3, 8), new MeshLambertMaterial({ color: "#ffffff" }), this.fans.length * FAN_PARTS);
    const c = new Color();
    this.fans.forEach((_, i) => {
      const skin = pick(FAN_SKIN);
      const shirt = pick(shirts);
      const colors = [shirt, skin, pick(FAN_HAIR), skin, skin, pick(FAN_PANTS)];
      colors.forEach((col, p) => this.mesh.setColorAt(i * FAN_PARTS + p, c.set(col)));
    });
    this.update(0, true);
    scene.add(this.mesh);
  }

  /** Someone scored: everyone jumps up for a moment. */
  cheer(now: number, strength = 1): void {
    this.cheerAt = now;
    this.strength = strength;
  }

  update(now: number, force = false): void {
    const since = now - this.cheerAt;
    const cheering = since < 2600;
    // Idle crowds barely move: refresh them ~8x a second instead of every frame.
    if (!force && !cheering && now - this.lastIdleAt < 120) return;
    this.lastIdleAt = now;
    const hold = 1300 * this.strength;
    this.fans.forEach((f, i) => {
      const t = since - f.delay;
      let c = 0;
      if (t > 0) {
        const rise = Math.min(1, t / 250);
        const fall = t > hold ? Math.max(0, 1 - (t - hold) / 500) : 1;
        c = rise * rise * (3 - 2 * rise) * fall * f.eager * Math.min(1, this.strength + 0.2);
      }
      this.pose(i, f, c, now);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private pose(i: number, f: Fan, c: number, now: number): void {
    const base = i * FAN_PARTS;
    const fwdX = -f.side; // facing the court
    const bounce = c * 0.07 * Math.abs(Math.sin(now / 110 + f.phase));
    const rise = 0.42 * c + bounce;
    const hip = this.v.copy(f.seat).add(this.w.set(fwdX * 0.28 * c, rise, 0));
    const sway = 0.018 * Math.sin(now / 900 + f.phase) * (1 - c);

    // Torso (faces ±x: width runs along z).
    const torsoY = hip.y + 0.3;
    this.set(base, hip.x, torsoY, hip.z + sway, null, 0.24, 0.27, 0.38);
    // Head and hair.
    this.set(base + 1, hip.x, torsoY + 0.43, hip.z + sway * 1.6, null, 0.19, 0.12, 0.19);
    this.set(base + 2, hip.x - fwdX * 0.012, torsoY + 0.52, hip.z + sway * 1.6, null, 0.2, 0.055, 0.2);
    // Arms: hands on the lap when seated, up and waving when cheering.
    for (const side of [-1, 1]) {
      const sx = hip.x;
      const sy = torsoY + 0.2;
      const sz = hip.z + sway + side * 0.21;
      const wave = 0.09 * Math.sin(now / 85 + f.phase + side) * c;
      const hx = sx + fwdX * (0.3 * (1 - c) + 0.06 * c);
      const hy = sy + (-0.28) * (1 - c) + 0.58 * c;
      const hz = sz + side * (-0.08 * (1 - c) + (0.14 + wave) * c);
      this.segment(base + (side < 0 ? 3 : 4), sx, sy, sz, hx, hy, hz, 0.085);
    }
    // Legs: a lap blob forward when seated, straight down to the footrest when standing.
    const seatedQ = this.q.setFromUnitVectors(UP, this.s.set(fwdX, -0.25, 0).normalize()).clone();
    const lx = hip.x + fwdX * 0.22 * (1 - c);
    const ly = hip.y + 0.02 - 0.44 * c;
    this.q.copy(seatedQ).slerp(new Quaternion(), c);
    this.m.compose(this.s.set(lx, ly, hip.z), this.q, this.w.set(0.17, 0.2 + 0.2 * c, 0.3));
    this.mesh.setMatrixAt(base + 5, this.m);
  }

  private set(index: number, x: number, y: number, z: number, q: Quaternion | null, sx: number, sy: number, sz: number): void {
    this.m.compose(this.s.set(x, y, z), q ?? this.q.identity(), new Vector3(sx, sy, sz));
    this.mesh.setMatrixAt(index, this.m);
  }

  private segment(index: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void {
    const dir = this.s.set(bx - ax, by - ay, bz - az);
    const len = dir.length();
    this.q.setFromUnitVectors(UP, dir.divideScalar(Math.max(len, 1e-5)));
    // The capsule is 2 units tall at scale 1 (length 1 + two 0.5 caps).
    this.m.compose(this.w.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), this.q, new Vector3(r, len / 2, r));
    this.mesh.setMatrixAt(index, this.m);
  }
}

// ---------- jumbotron (1 draw call) ----------

class Jumbotron {
  private readonly canvas = document.createElement("canvas");
  private readonly tex: CanvasTexture;
  private key = "";

  constructor(
    scene: Scene,
    private readonly team: VenueTeam
  ) {
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    const screen = new Mesh(new PlaneGeometry(SCREEN_W, SCREEN_H), new MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    screen.position.set(0, SCREEN_Y, WALL_Z - 0.09);
    scene.add(screen);
    this.set({ kind: "team" });
  }

  set(content: JumbotronContent): void {
    const key = JSON.stringify(content);
    if (key === this.key) return;
    this.key = key;
    this.draw(content);
    this.tex.needsUpdate = true;
  }

  private draw(content: JumbotronContent): void {
    const ctx = this.canvas.getContext("2d")!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const team = this.team;
    const font = (px: number, w = 800) => `${w} ${px}px ${JERSEY_FONT}`;
    const fit = (text: string, px: number, maxW: number, w = 800) => {
      ctx.font = font(px, w);
      while (ctx.measureText(text).width > maxW && px > 14) ctx.font = font((px -= 2), w);
    };

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0d131d");
    g.addColorStop(1, "#151f2e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Header strip in club colours.
    ctx.fillStyle = team.primary;
    ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = team.secondary;
    ctx.fillRect(0, 64, W, 6);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = font(38);
    ctx.fillText("CLUTCH COURT", 28, 34);
    if (team.code) {
      ctx.textAlign = "right";
      ctx.fillText(team.code.toUpperCase(), W - 28, 34);
    }
    ctx.textAlign = "center";

    if (content.kind === "team") {
      fit((team.code || "CLUTCH").toUpperCase(), 210, W - 120);
      ctx.fillStyle = "#ffffff";
      ctx.fillText((team.code || "CLUTCH").toUpperCase(), W / 2, 250);
      if (team.name) {
        fit(team.name.toUpperCase(), 46, W - 120, 600);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText(team.name.toUpperCase(), W / 2, 410);
      }
    } else if (content.kind === "game") {
      // Label row.
      ctx.font = font(44);
      if (content.live) {
        const label = content.label.toUpperCase();
        const w = ctx.measureText(label).width;
        ctx.fillStyle = "#ff3b30";
        ctx.beginPath();
        ctx.arc(W / 2 - w / 2 - 26, 122, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, W / 2, 124);
      } else {
        ctx.fillStyle = "#ffc93c";
        ctx.fillText(content.label.toUpperCase(), W / 2, 124);
      }
      // Team chips.
      const chip = (t: TeamChip, cx: number) => {
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.roundRect(cx - 150, 205, 300, 150, 22);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 4;
        ctx.stroke();
        fit(t.code.toUpperCase(), 104, 260);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(t.code.toUpperCase(), cx, 284);
      };
      chip(content.home, 190);
      chip(content.away, W - 190);
      // Score or "vs".
      ctx.fillStyle = "#ffffff";
      if (content.homeScore !== null && content.awayScore !== null) {
        fit(`${content.homeScore}–${content.awayScore}`, 128, 330);
        ctx.fillText(`${content.homeScore}–${content.awayScore}`, W / 2, 284);
      } else {
        ctx.font = font(96);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText("VS", W / 2, 284);
      }
      fit(content.sub, 44, W - 100, 600);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(content.sub, W / 2, 432);
    } else {
      ctx.fillStyle = "#ffc93c";
      ctx.font = font(48);
      ctx.fillText(content.title, W / 2, 122);
      const rows = content.rows.slice(0, 8);
      const cols = rows.length > 4 ? 2 : 1;
      const colW = W / cols;
      const rowH = 82;
      rows.forEach((r, i) => {
        const col = cols === 2 ? Math.floor(i / 4) : 0;
        const row = cols === 2 ? i % 4 : i;
        const x0 = col * colW + 40;
        const y = 196 + row * rowH;
        if (r.turn) {
          ctx.fillStyle = "rgba(255,201,60,0.18)";
          ctx.fillRect(col * colW + 16, y - rowH / 2 + 6, colW - 32, rowH - 12);
        }
        ctx.globalAlpha = r.out ? 0.4 : 1;
        ctx.textAlign = "left";
        ctx.fillStyle = r.turn ? "#ffc93c" : "#ffffff";
        fit(`${r.turn ? "▶ " : ""}${r.name}`, 44, colW - 300, 700);
        ctx.fillText(`${r.turn ? "▶ " : ""}${r.name}`, x0, y);
        ctx.font = font(48);
        for (let k = 0; k < HORSE.length; k++) {
          ctx.fillStyle = k < r.letters.length ? "#ff5a4f" : "rgba(255,255,255,0.18)";
          ctx.fillText(HORSE[k]!, x0 + colW - 270 + k * 44, y);
        }
        ctx.globalAlpha = 1;
      });
      ctx.textAlign = "center";
    }

    // LED dot-matrix sheen.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
  }
}
