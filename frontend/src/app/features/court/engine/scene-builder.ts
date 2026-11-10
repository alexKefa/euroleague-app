// Procedural outdoor court (CLUTCH_COURT_SPEC.md §9): LED glass floor
// markings, two hoops with chain nets, fence, and cheap instanced
// surroundings. No model files. Shared materials and instancing keep this at
// a few dozen draw calls.
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  TorusGeometry,
} from "three";
import {
  BACKBOARD_HEIGHT,
  BACKBOARD_WIDTH,
  FENCE_HEIGHT,
} from "../../../../../../shared/court/constants";
import { ACTIVE_HOOPS, FENCE, RIM_RING_RADIUS, hoopLayout } from "../../../../../../shared/court/geometry";
import { HoopId } from "../../../../../../shared/court/types";
import { Venue, VenueTeam } from "./venue";
import { LedFloor } from "./led-floor";
import { Sky } from "./sky";

const NET_HEIGHT = 0.42;

export interface HoopVisual {
  id: HoopId;
  net: Mesh;
}

export interface BuiltScene {
  scene: Scene;
  hoops: Map<HoopId, HoopVisual>;
  /** Mural, jumbotron, floodlights and the crowd. */
  venue: Venue;
  /** LED glass court. */
  floor: LedFloor;
  sky: Sky;
  hemi: HemisphereLight;
  sun: DirectionalLight;
}

export interface SceneOptions {
  teamPrimary: string;
  /** Club logo painted at the top of the 3-point arc (already loaded, CORS-clean). */
  logo: HTMLImageElement | null;
  maxAnisotropy: number;
  /** Whose court it is: mural, fans' shirts, jumbotron. */
  venue: VenueTeam;
}

export function buildScene({ teamPrimary, logo, maxAnisotropy, venue: venueTeam }: SceneOptions): BuiltScene {
  const scene = new Scene();
  // The sky dome replaces a flat background; fog takes the horizon colour (set by the lighting).
  scene.fog = new Fog("#cfe4f5", 45, 110);

  const hemi = new HemisphereLight("#e4f1ff", "#5a6b45", 1.6);
  scene.add(hemi);
  const sun = new DirectionalLight("#fff3dc", 2.2);
  sun.position.set(-12, 25, 8);
  scene.add(sun);

  // Grass/asphalt surroundings and the court surface.
  const ground = new Mesh(new PlaneGeometry(240, 240), new MeshLambertMaterial({ color: "#58704a" }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const pad = new Mesh(
    new PlaneGeometry(FENCE.maxX - FENCE.minX, FENCE.maxZ - FENCE.minZ),
    new MeshLambertMaterial({ color: "#161b22" })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set((FENCE.maxX + FENCE.minX) / 2, -0.005, (FENCE.maxZ + FENCE.minZ) / 2);
  scene.add(pad);

  const floor = new LedFloor(scene, { teamPrimary, teamSecondary: venueTeam.secondary, logo, maxAnisotropy });
  const sky = new Sky(scene);

  const hoops = new Map<HoopId, HoopVisual>();
  const poleMat = new MeshStandardMaterial({ color: "#2b3138", roughness: 0.6, metalness: 0.4 });
  const rimMat = new MeshStandardMaterial({ color: "#e8531f", roughness: 0.45, metalness: 0.3 });
  const netMat = new MeshBasicMaterial({ color: "#d8dde2", wireframe: true });
  const boardTex = backboardTexture();
  const boardMats = [poleMat, poleMat, poleMat, poleMat, new MeshLambertMaterial({ map: boardTex }), new MeshLambertMaterial({ map: boardTex })];
  for (const id of ACTIVE_HOOPS) {
    const h = hoopLayout(id);
    const g = new Group();

    const pole = new Mesh(new CylinderGeometry(h.pole.radius, h.pole.radius, h.pole.halfHeight * 2, 12), poleMat);
    pole.position.set(h.pole.center.x, h.pole.center.y, h.pole.center.z);
    g.add(pole);

    const arm = new Mesh(new BoxGeometry(h.arm.half.x * 2, h.arm.half.y * 2, h.arm.half.z * 2), poleMat);
    arm.position.set(h.arm.center.x, h.arm.center.y, h.arm.center.z);
    g.add(arm);

    const board = new Mesh(new BoxGeometry(h.board.half.x * 2, h.board.half.y * 2, h.board.half.z * 2), boardMats);
    board.position.set(h.board.center.x, h.board.center.y, h.board.center.z);
    g.add(board);

    const rim = new Mesh(new TorusGeometry(RIM_RING_RADIUS, 0.018, 8, 32), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(h.rim.x, h.rim.y, h.rim.z);
    g.add(rim);

    // Bracket between rim and board.
    const sign = id === "A" ? -1 : 1;
    const bracket = new Mesh(new BoxGeometry(0.12, 0.03, 0.17), rimMat);
    bracket.position.set(0, h.rim.y - 0.01, h.rim.z + sign * (RIM_RING_RADIUS + 0.07));
    g.add(bracket);

    const net = new Mesh(new CylinderGeometry(RIM_RING_RADIUS, 0.15, NET_HEIGHT, 12, 4, true), netMat);
    // Pivot at the rim so the swish animation stretches downwards.
    net.geometry.translate(0, -NET_HEIGHT / 2, 0);
    net.position.set(h.rim.x, h.rim.y, h.rim.z);
    g.add(net);

    scene.add(g);
    hoops.set(id, { id, net });
  }

  buildFence(scene, maxAnisotropy);
  const venue = new Venue(scene, venueTeam);
  buildSurroundings(scene);
  return { scene, hoops, venue, floor, sky, hemi, sun };
}

function backboardTexture(): CanvasTexture {
  const ppm = 200;
  const canvas = document.createElement("canvas");
  canvas.width = BACKBOARD_WIDTH * ppm;
  canvas.height = BACKBOARD_HEIGHT * ppm;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f2f4f6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#1d2228";
  ctx.lineWidth = 0.05 * ppm;
  ctx.strokeRect(0.025 * ppm, 0.025 * ppm, canvas.width - 0.05 * ppm, canvas.height - 0.05 * ppm);
  // Shooter's square: 0.59 x 0.45, bottom edge level with the rim (0.15 above the board bottom).
  const w = 0.59 * ppm;
  const h = 0.45 * ppm;
  ctx.strokeRect((canvas.width - w) / 2, canvas.height - 0.15 * ppm - h, w, h);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ---------- fence ----------

function chainLinkTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#c9ced4";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, size);
  ctx.moveTo(size, 0);
  ctx.lineTo(0, size);
  ctx.stroke();
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function buildFence(scene: Scene, maxAnisotropy: number): void {
  const tex = chainLinkTexture();
  tex.anisotropy = maxAnisotropy;
  const cell = 0.12; // metres per diamond
  const lenX = FENCE.maxX - FENCE.minX;
  const lenZ = FENCE.maxZ - FENCE.minZ;
  const midX = (FENCE.maxX + FENCE.minX) / 2;
  const midZ = (FENCE.maxZ + FENCE.minZ) / 2;
  const sides: Array<{ len: number; x: number; z: number; rotY: number }> = [
    { len: lenZ, x: FENCE.minX, z: midZ, rotY: Math.PI / 2 },
    { len: lenZ, x: FENCE.maxX, z: midZ, rotY: -Math.PI / 2 },
    { len: lenX, x: midX, z: FENCE.minZ, rotY: 0 },
    { len: lenX, x: midX, z: FENCE.maxZ, rotY: Math.PI },
  ];
  for (const side of sides) {
    const t = tex.clone();
    t.repeat.set(side.len / cell, FENCE_HEIGHT / cell);
    t.needsUpdate = true;
    const mat = new MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, side: DoubleSide, depthWrite: false, opacity: 0.85 });
    const mesh = new Mesh(new PlaneGeometry(side.len, FENCE_HEIGHT), mat);
    mesh.position.set(side.x, FENCE_HEIGHT / 2, side.z);
    mesh.rotation.y = side.rotY;
    scene.add(mesh);
  }
  tex.dispose();

  // Posts and top rail.
  const postMat = new MeshLambertMaterial({ color: "#8a9199" });
  const spacing = 3;
  const positions: Array<[number, number]> = [];
  const nz = Math.round(lenZ / spacing);
  for (let i = 0; i <= nz; i++) {
    const z = FENCE.minZ + (i * lenZ) / nz;
    positions.push([FENCE.minX, z], [FENCE.maxX, z]);
  }
  const nx = Math.round(lenX / spacing);
  for (let i = 1; i < nx; i++) {
    const x = FENCE.minX + (i * lenX) / nx;
    positions.push([x, FENCE.minZ], [x, FENCE.maxZ]);
  }
  const posts = new InstancedMesh(new CylinderGeometry(0.04, 0.04, FENCE_HEIGHT, 6), postMat, positions.length);
  const m = new Matrix4();
  positions.forEach(([x, z], i) => posts.setMatrixAt(i, m.makeTranslation(x, FENCE_HEIGHT / 2, z)));
  scene.add(posts);

  const railGeo = new BoxGeometry(1, 0.05, 0.05);
  const rails = new InstancedMesh(railGeo, postMat, 4);
  const dummy = new Object3D();
  sides.forEach((side, i) => {
    dummy.position.set(side.x, FENCE_HEIGHT, side.z);
    dummy.rotation.set(0, side.rotY, 0);
    dummy.scale.set(side.len, 1, 1);
    dummy.updateMatrix();
    rails.setMatrixAt(i, dummy.matrix);
  });
  scene.add(rails);
}

// ---------- surroundings ----------

function buildSurroundings(scene: Scene): void {
  // Centre the park on the fenced area (it is offset on a half court).
  const oz = (FENCE.maxZ + FENCE.minZ) / 2;
  // Deterministic pseudo-random placement so the park looks the same each visit.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dummy = new Object3D();

  const buildingCount = 26;
  const buildings = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: "#ffffff" }), buildingCount);
  const palette = ["#c9b8a3", "#b5c2cc", "#d9cdb8", "#a7b3a0", "#c4a690", "#9fb0bf"].map((c) => new Color(c));
  for (let i = 0; i < buildingCount; i++) {
    const a = (i / buildingCount) * Math.PI * 2 + rand() * 0.15;
    const r = 55 + rand() * 25;
    const w = 8 + rand() * 10;
    const h = 8 + rand() * 22;
    dummy.position.set(Math.cos(a) * r, h / 2, oz + Math.sin(a) * r);
    dummy.rotation.set(0, -a, 0);
    dummy.scale.set(w, h, 6 + rand() * 6);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);
    buildings.setColorAt(i, palette[i % palette.length]!);
  }
  scene.add(buildings);

  // Rounded, leafy trees: a trunk and three overlapping crown blobs in
  // varied greens (2 draw calls for the whole park).
  const treeCount = 24;
  const blobs = 3;
  const trunks = new InstancedMesh(new CylinderGeometry(0.13, 0.22, 2.4, 7), new MeshLambertMaterial({ color: "#6b4f3a" }), treeCount);
  const crowns = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshLambertMaterial({ color: "#ffffff" }), treeCount * blobs);
  const greens = ["#4f7a3a", "#5d8a44", "#46703a", "#6a9550", "#3f6634"].map((c) => new Color(c));
  for (let i = 0; i < treeCount; i++) {
    const a = (i / treeCount) * Math.PI * 2 + rand() * 0.2;
    // Outside the fence, the bleachers and the mural wall.
    const r = 20 + rand() * 20;
    const x = Math.cos(a) * r;
    const z = oz + Math.sin(a) * r * 1.15;
    const s = 0.85 + rand() * 0.5;
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.set(s, s, s);
    dummy.position.set(x, 1.2 * s, z);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    for (let k = 0; k < blobs; k++) {
      const main = k === 0;
      const ang = rand() * Math.PI * 2;
      const off = main ? 0 : 0.85 * s;
      dummy.position.set(x + Math.cos(ang) * off, (main ? 3.4 : 2.9 + rand() * 0.9) * s, z + Math.sin(ang) * off);
      const b = (main ? 1.55 : 1.05 + rand() * 0.25) * s;
      dummy.scale.set(b, b * 0.9, b);
      dummy.rotation.set(rand(), rand(), 0);
      dummy.updateMatrix();
      crowns.setMatrixAt(i * blobs + k, dummy.matrix);
      crowns.setColorAt(i * blobs + k, greens[Math.floor(rand() * greens.length)]!);
    }
  }
  scene.add(trunks, crowns);
}

/** Dispose every geometry, material and texture under `root`. */
export function disposeObject(root: Object3D): void {
  const textures = new Set<{ dispose(): void }>();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    mesh.geometry?.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const mat of mats) {
      for (const value of Object.values(mat)) {
        if (value && typeof value === "object" && "isTexture" in value) textures.add(value as { dispose(): void });
      }
      mat.dispose();
    }
    if (obj instanceof InstancedMesh) obj.dispose();
  });
  textures.forEach((t) => t.dispose());
}
