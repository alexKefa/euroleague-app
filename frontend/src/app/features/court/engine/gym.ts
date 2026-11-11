// The indoor club gym around the court: painted block walls with team-colour
// wall padding and banners, a band of high windows that follow the time of
// day, a dark ceiling with steel trusses, a grid of always-on overhead lamps,
// and a divider curtain at half court (the far half isn't in play).
//
// Every surface faces inwards and is single-sided, so when the chase camera
// swings outside the room (deep in a corner, wide preset) the near wall just
// disappears instead of blocking the view.
//
// Draw calls: 4 walls + ceiling + windows + trusses + lamp housings + lamp
// faces + lamp glow + curtain = 11.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Scene,
} from "three";
import { FENCE } from "../../../../../../shared/court/geometry";
import { JERSEY_FONT } from "./avatar-factory";
import type { IndoorLighting } from "./lighting";
import type { VenueTeam } from "./venue";

/** Room interior (metres). The end wall sits just behind the mural and scoreboard. */
export const ROOM = {
  minX: -15.6,
  maxX: 15.6,
  minZ: FENCE.minZ - 1.75,
  maxZ: 13,
  height: 11,
} as const;

const PAD_H = 2.2;
const PX_PER_M = 48;
const WINDOW_Y = 8.5;
const WINDOW_W = 2.6;
const WINDOW_H = 2.0;
const LAMP_Y = ROOM.height - 1.6;
const TRUSS_BOTTOM = ROOM.height - 1.3;

export class Gym {
  private readonly windows: MeshBasicMaterial;
  private readonly lampFaces: MeshBasicMaterial;
  private readonly glow: PointsMaterial;

  constructor(scene: Scene, team: VenueTeam, maxAnisotropy: number) {
    buildWalls(scene, team, maxAnisotropy);
    this.windows = buildWindows(scene);
    buildTrusses(scene);
    const lamps = buildLamps(scene);
    this.lampFaces = lamps.faces;
    this.glow = lamps.glow;
    buildCurtain(scene, team, maxAnisotropy);
  }

  setLighting(l: IndoorLighting): void {
    this.windows.color.set(l.windowColor);
    this.lampFaces.color.setScalar(0.75 + 0.25 * l.lamps);
    this.glow.opacity = 0.2 + 0.55 * l.lamps;
  }
}

// ---------- walls and ceiling (5 draw calls) ----------

function canvas(wM: number, hM: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; W: number; H: number; m: number } {
  const c = document.createElement("canvas");
  c.width = Math.round(wM * PX_PER_M);
  c.height = Math.round(hM * PX_PER_M);
  return { c, ctx: c.getContext("2d")!, W: c.width, H: c.height, m: PX_PER_M };
}

function texture(c: HTMLCanvasElement, maxAnisotropy: number): CanvasTexture {
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** Painted concrete block above, team-colour wall padding below. */
function paintWall(ctx: CanvasRenderingContext2D, W: number, H: number, m: number, team: VenueTeam): void {
  ctx.fillStyle = "#d8d5ce";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(70,65,60,0.13)";
  ctx.lineWidth = 1;
  const bw = 0.4 * m;
  const bh = 0.2 * m;
  for (let r = 0, y = H - PAD_H * m; y > 0; r++, y -= bh) {
    for (let x = r % 2 ? -bw / 2 : 0; x < W; x += bw) ctx.strokeRect(x, y - bh, bw, bh);
  }
  // A painted stripe in the club colour at the top of the block work.
  ctx.fillStyle = team.primary;
  ctx.fillRect(0, 0.9 * m, W, 0.35 * m);
  ctx.fillStyle = team.secondary;
  ctx.fillRect(0, 1.25 * m, W, 0.08 * m);
  // Padding with seams every 2 m.
  const padTop = H - PAD_H * m;
  ctx.fillStyle = team.primary;
  ctx.fillRect(0, padTop, W, PAD_H * m);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let x = 2 * m; x < W; x += 2 * m) ctx.fillRect(x - 1, padTop, 2, PAD_H * m);
  ctx.fillStyle = team.secondary;
  ctx.fillRect(0, padTop - 0.1 * m, W, 0.1 * m);
  // Scuffed kick plate.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, H - 0.15 * m, W, 0.15 * m);
}

function drawCrest(ctx: CanvasRenderingContext2D, team: VenueTeam, cx: number, cy: number, size: number, fallbackColor: string): void {
  if (team.logo) {
    const ar = team.logo.width / team.logo.height || 1;
    const w = ar >= 1 ? size : size * ar;
    const h = ar >= 1 ? size / ar : size;
    ctx.drawImage(team.logo, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  ctx.fillStyle = fallbackColor;
  ctx.font = `800 ${Math.round(size * 0.5)}px ${JERSEY_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((team.code || "C").toUpperCase(), cx, cy);
}

/** A hanging pennant with a pointed bottom: the crest on a team-colour field. */
function drawBanner(ctx: CanvasRenderingContext2D, team: VenueTeam, x: number, top: number, m: number, flip: boolean): void {
  const w = 1.5 * m;
  const h = 2.5 * m;
  const field = flip ? team.secondary : team.primary;
  const trim = flip ? team.primary : team.secondary;
  ctx.fillStyle = "#3a4048";
  ctx.fillRect(x - w / 2 - 0.1 * m, top - 0.06 * m, w + 0.2 * m, 0.06 * m);
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w / 2, top + h * 0.8);
  ctx.lineTo(x, top + h);
  ctx.lineTo(x - w / 2, top + h * 0.8);
  ctx.closePath();
  ctx.fillStyle = field;
  ctx.fill();
  ctx.lineWidth = 0.07 * m;
  ctx.strokeStyle = trim;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x, top + h * 0.4, w * 0.36, 0, Math.PI * 2);
  ctx.fill();
  drawCrest(ctx, team, x, top + h * 0.4, w * 0.5, field);
}

function buildWalls(scene: Scene, team: VenueTeam, maxAnisotropy: number): void {
  const lenX = ROOM.maxX - ROOM.minX;
  const lenZ = ROOM.maxZ - ROOM.minZ;
  const midX = (ROOM.maxX + ROOM.minX) / 2;
  const midZ = (ROOM.maxZ + ROOM.minZ) / 2;
  const H = ROOM.height;

  // Side walls: banners between the windows, above the bleachers.
  const side = (sign: 1 | -1) => {
    const { c, ctx, W, H: h, m } = canvas(lenZ, H);
    paintWall(ctx, W, h, m, team);
    // From inside, the +x wall runs from minZ (left) to maxZ (right); -x the other way.
    const zToX = (z: number) => (sign === 1 ? z - ROOM.minZ : ROOM.maxZ - z) * m;
    let k = 0;
    for (let z = ROOM.minZ + 3.5; z < FENCE.maxZ; z += 4, k++) drawBanner(ctx, team, zToX(z), h - 6.8 * m, m, k % 2 === 1);
    const mesh = new Mesh(new PlaneGeometry(lenZ, H), new MeshLambertMaterial({ map: texture(c, maxAnisotropy) }));
    mesh.position.set(sign === 1 ? ROOM.maxX : ROOM.minX, H / 2, midZ);
    mesh.rotation.y = sign === 1 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(mesh);
  };
  side(1);
  side(-1);

  // End wall behind hoop A (the mural and scoreboard stand in front of it).
  {
    const { c, ctx, W, H: h, m } = canvas(lenX, H);
    paintWall(ctx, W, h, m, team);
    for (const [i, x] of [-12, -10, 10, 12].entries()) drawBanner(ctx, team, (x - ROOM.minX) * m, h - 7.6 * m, m, i % 2 === 1);
    const mesh = new Mesh(new PlaneGeometry(lenX, H), new MeshLambertMaterial({ map: texture(c, maxAnisotropy) }));
    mesh.position.set(midX, H / 2, ROOM.minZ);
    scene.add(mesh);
  }

  // Back wall: double doors and the club name.
  {
    const { c, ctx, W, H: h, m } = canvas(lenX, H);
    paintWall(ctx, W, h, m, team);
    for (const dx of [-9, 9]) {
      const x = W / 2 + dx * m;
      ctx.fillStyle = "#3a4048";
      ctx.fillRect(x - 1.1 * m, h - 2.5 * m, 2.2 * m, 2.5 * m);
      ctx.fillStyle = "#525a64";
      ctx.fillRect(x - 1.0 * m, h - 2.4 * m, 0.95 * m, 2.4 * m);
      ctx.fillRect(x + 0.05 * m, h - 2.4 * m, 0.95 * m, 2.4 * m);
      ctx.fillStyle = "#9aa3ad";
      ctx.fillRect(x - 0.25 * m, h - 1.3 * m, 0.18 * m, 0.04 * m);
      ctx.fillRect(x + 0.07 * m, h - 1.3 * m, 0.18 * m, 0.04 * m);
    }
    const word = (team.name || team.code || "CLUTCH").toUpperCase();
    let size = Math.round(1.6 * m);
    ctx.font = `800 ${size}px ${JERSEY_FONT}`;
    while (ctx.measureText(word).width > W * 0.7 && size > 20) ctx.font = `800 ${(size -= 4)}px ${JERSEY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = team.primary;
    ctx.fillText(word, W / 2, h - 5.2 * m);
    const mesh = new Mesh(new PlaneGeometry(lenX, H), new MeshLambertMaterial({ map: texture(c, maxAnisotropy) }));
    mesh.position.set(midX, H / 2, ROOM.maxZ);
    mesh.rotation.y = Math.PI;
    scene.add(mesh);
  }

  // Ceiling: dark acoustic panels.
  {
    const { c, ctx, W, H: h, m } = canvas(lenX, lenZ);
    ctx.fillStyle = "#2c3036";
    ctx.fillRect(0, 0, W, h);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 1.2 * m) ctx.strokeRect(x, 0, 1.2 * m, h);
    for (let y = 0; y < h; y += 0.6 * m) ctx.strokeRect(0, y, W, 0.6 * m);
    const mesh = new Mesh(new PlaneGeometry(lenX, lenZ), new MeshLambertMaterial({ map: texture(c, maxAnisotropy) }));
    mesh.position.set(midX, H, midZ);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
  }
}

// ---------- high windows (1 draw call) ----------

function windowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 200;
  const ctx = c.getContext("2d")!;
  // Glass: brighter at the top, so it reads as sky rather than a flat panel.
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#c8cdd2");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#2b3138";
  const t = 10;
  ctx.fillRect(0, 0, c.width, t);
  ctx.fillRect(0, c.height - t, c.width, t);
  ctx.fillRect(0, 0, t, c.height);
  ctx.fillRect(c.width - t, 0, t, c.height);
  for (let i = 1; i < 4; i++) ctx.fillRect((i * c.width) / 4 - 3, 0, 6, c.height);
  ctx.fillRect(0, c.height / 2 - 3, c.width, 6);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function buildWindows(scene: Scene): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ map: windowTexture(), toneMapped: false });
  const spots: [number, number, number][] = [];
  for (let z = ROOM.minZ + 2.5; z < ROOM.maxZ - 1.5; z += 3.6) {
    spots.push([ROOM.maxX - 0.02, z, -Math.PI / 2], [ROOM.minX + 0.02, z, Math.PI / 2]);
  }
  const mesh = new InstancedMesh(new PlaneGeometry(WINDOW_W, WINDOW_H), mat, spots.length);
  const d = new Object3D();
  spots.forEach(([x, z, ry], i) => {
    d.position.set(x, WINDOW_Y, z);
    d.rotation.set(0, ry, 0);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  scene.add(mesh);
  return mat;
}

// ---------- roof trusses (1 draw call) ----------

function buildTrusses(scene: Scene): void {
  const lenX = ROOM.maxX - ROOM.minX;
  const depth = ROOM.height - TRUSS_BOTTOM;
  const parts: Matrix4[] = [];
  const d = new Object3D();
  const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0) => {
    d.position.set(x, y, z);
    d.rotation.set(0, 0, rz);
    d.scale.set(sx, sy, sz);
    d.updateMatrix();
    parts.push(d.matrix.clone());
  };
  const panel = 2.6;
  const panels = Math.round(lenX / panel);
  const step = lenX / panels;
  const web = Math.hypot(step, depth);
  const ang = Math.atan2(depth, step);
  for (let z = ROOM.minZ + 3; z < ROOM.maxZ; z += 5) {
    add(0, TRUSS_BOTTOM, z, lenX, 0.14, 0.14);
    add(0, ROOM.height - 0.1, z, lenX, 0.14, 0.14);
    for (let i = 0; i < panels; i++) {
      const x = ROOM.minX + (i + 0.5) * step;
      add(x, TRUSS_BOTTOM + depth / 2, z, web, 0.07, 0.07, i % 2 ? -ang : ang);
    }
  }
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: "#5d646d" }), parts.length);
  parts.forEach((m, i) => mesh.setMatrixAt(i, m));
  scene.add(mesh);
}

// ---------- overhead lamps (3 draw calls: housings, faces, glow) ----------

function glowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,250,235,0.85)");
  g.addColorStop(0.45, "rgba(255,240,210,0.25)");
  g.addColorStop(1, "rgba(255,240,210,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function buildLamps(scene: Scene): { faces: MeshBasicMaterial; glow: PointsMaterial } {
  const spots: [number, number][] = [];
  for (const x of [-10.5, -3.5, 3.5, 10.5]) {
    for (let z = ROOM.minZ + 3; z < ROOM.maxZ - 1; z += 5) spots.push([x, z]);
  }
  const housings = new InstancedMesh(
    new CylinderGeometry(0.3, 0.45, 0.35, 12, 1, true),
    new MeshLambertMaterial({ color: "#3a4048" }),
    spots.length
  );
  const faces = new MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
  const faceGeo = new CircleGeometry(0.42, 16);
  faceGeo.rotateX(Math.PI / 2); // face down
  const disks = new InstancedMesh(faceGeo, faces, spots.length);
  const m = new Matrix4();
  const glowPos: number[] = [];
  spots.forEach(([x, z], i) => {
    housings.setMatrixAt(i, m.makeTranslation(x, LAMP_Y, z));
    disks.setMatrixAt(i, m.makeTranslation(x, LAMP_Y - 0.18, z));
    glowPos.push(x, LAMP_Y - 0.3, z);
  });
  scene.add(housings, disks);

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(glowPos, 3));
  const glow = new PointsMaterial({
    map: glowTexture(),
    size: 2.6,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    color: new Color("#fff6e0"),
    opacity: 0.5,
    toneMapped: false,
  });
  scene.add(new Points(geo, glow));
  return { faces, glow };
}

// ---------- divider curtain at half court (1 draw call) ----------

function buildCurtain(scene: Scene, team: VenueTeam, maxAnisotropy: number): void {
  const lenX = ROOM.maxX - ROOM.minX;
  const h = TRUSS_BOTTOM;
  const { c, ctx, W, H, m } = canvas(lenX, h);
  // Upper: see-through netting (cut out with alphaTest). Lower: solid vinyl.
  const vinyl = 3 * m;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(40,44,50,1)";
  ctx.lineWidth = 2;
  const cell = 0.15 * m;
  for (let x = 0; x <= W; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H - vinyl);
    ctx.stroke();
  }
  for (let y = 0; y <= H - vinyl; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#2b3138";
  ctx.fillRect(0, 0, W, 0.12 * m);
  ctx.fillStyle = team.primary;
  ctx.fillRect(0, H - vinyl, W, vinyl);
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  for (let x = 1.5 * m; x < W; x += 1.5 * m) ctx.fillRect(x - 2, H - vinyl, 4, vinyl);
  ctx.fillStyle = team.secondary;
  ctx.fillRect(0, H - vinyl, W, 0.12 * m);
  for (const dx of [-8, 0, 8]) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(W / 2 + dx * m, H - vinyl / 2, 1.05 * m, 0, Math.PI * 2);
    ctx.fill();
    drawCrest(ctx, team, W / 2 + dx * m, H - vinyl / 2, 1.5 * m, team.primary);
  }
  const mat = new MeshLambertMaterial({ map: texture(c, maxAnisotropy), alphaTest: 0.4 });
  const mesh = new Mesh(new PlaneGeometry(lenX, h), mat);
  // Faces the court (-z) only: from the camera behind it (z > midcourt) it's culled.
  mesh.position.set(0, h / 2, FENCE.maxZ + 0.6);
  mesh.rotation.y = Math.PI;
  scene.add(mesh);
}
