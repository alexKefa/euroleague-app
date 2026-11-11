// Procedural indoor court (CLUTCH_COURT_SPEC.md §9): LED glass floor
// markings, two hoops with chain nets, inside a club gym (gym.ts). No model
// files. Shared materials and instancing keep this at
// a few dozen draw calls.
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  Color,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  TorusGeometry,
} from "three";
import {
  BACKBOARD_HEIGHT,
  BACKBOARD_WIDTH,
} from "../../../../../../shared/court/constants";
import { ACTIVE_HOOPS, FENCE, RIM_RING_RADIUS, hoopLayout } from "../../../../../../shared/court/geometry";
import { HoopId } from "../../../../../../shared/court/types";
import { Venue, VenueTeam } from "./venue";
import { LedFloor } from "./led-floor";
import { Gym, ROOM } from "./gym";
import { HoopNet } from "./hoop-net";

const NET_HEIGHT = 0.44;
const NET_BOTTOM_RADIUS = 0.1;

export interface HoopVisual {
  id: HoopId;
  net: HoopNet;
}

export interface BuiltScene {
  scene: Scene;
  hoops: Map<HoopId, HoopVisual>;
  /** Mural, scoreboard, bleachers and the crowd. */
  venue: Venue;
  /** LED glass court. */
  floor: LedFloor;
  /** Walls, high windows, lamps. */
  gym: Gym;
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
  // Indoors: no fog. The background only shows when the camera swings outside the room.
  scene.background = new Color("#15181d");

  const hemi = new HemisphereLight("#e4f1ff", "#5a6b45", 1.6);
  scene.add(hemi);
  const sun = new DirectionalLight("#fff3dc", 2.2);
  sun.position.set(-12, 25, 8);
  scene.add(sun);

  // Rubber sports floor wall to wall, then the court surface.
  const ground = new Mesh(
    new PlaneGeometry(ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ),
    new MeshLambertMaterial({ color: "#262a30" })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((ROOM.maxX + ROOM.minX) / 2, -0.02, (ROOM.maxZ + ROOM.minZ) / 2);
  scene.add(ground);

  const pad = new Mesh(
    new PlaneGeometry(FENCE.maxX - FENCE.minX, FENCE.maxZ - FENCE.minZ),
    new MeshLambertMaterial({ color: "#161b22" })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set((FENCE.maxX + FENCE.minX) / 2, -0.005, (FENCE.maxZ + FENCE.minZ) / 2);
  scene.add(pad);

  const floor = new LedFloor(scene, { teamPrimary, teamSecondary: venueTeam.secondary, logo, maxAnisotropy });
  const gym = new Gym(scene, venueTeam, maxAnisotropy);

  const hoops = new Map<HoopId, HoopVisual>();
  const poleMat = new MeshStandardMaterial({ color: "#2b3138", roughness: 0.6, metalness: 0.4 });
  const rimMat = new MeshStandardMaterial({ color: "#e8531f", roughness: 0.45, metalness: 0.3 });
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

    const net = new HoopNet(h.rim.x, h.rim.y, h.rim.z, RIM_RING_RADIUS, NET_HEIGHT, NET_BOTTOM_RADIUS);
    g.add(net.mesh);

    scene.add(g);
    hoops.set(id, { id, net });
  }

  const venue = new Venue(scene, venueTeam);
  return { scene, hoops, venue, floor, gym, hemi, sun };
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
