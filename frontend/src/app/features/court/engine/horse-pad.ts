// The H-O-R-S-E pad: a permanent glowing spot on the floor beside the
// sideline. Stand on it to get the "Start H-O-R-S-E" prompt (the page owns
// the prompt and the confirm sheet). Shows the game state: ready to start,
// waiting for players, or a game in progress. One draw call.
import { AdditiveBlending, CanvasTexture, CircleGeometry, Mesh, MeshBasicMaterial, SRGBColorSpace, Scene } from "three";
import { JERSEY_FONT } from "./avatar-factory";

/** Beside the left sideline near midcourt: off the lines, inside the fence. */
export const HORSE_PAD = { x: -8.75, z: -2.2, radius: 1.05 };

export type PadState = "ready" | "waiting" | "playing";

export class HorsePad {
  private readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private readonly canvas = document.createElement("canvas");
  private readonly tex: CanvasTexture;
  private state: PadState | null = null;
  private labels: Record<PadState, string> = { ready: "START", waiting: "2+ PLAYERS", playing: "LIVE" };

  constructor(scene: Scene) {
    this.canvas.width = this.canvas.height = 512;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    this.mesh = new Mesh(new CircleGeometry(HORSE_PAD.radius, 48), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(HORSE_PAD.x, 0.018, HORSE_PAD.z);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Translated second-line labels. */
  setLabels(labels: Record<PadState, string>): void {
    this.labels = labels;
    if (this.state) this.draw(this.state);
  }

  /** null hides the pad (practice court). */
  setState(state: PadState | null): void {
    this.mesh.visible = state !== null;
    if (state === null || state === this.state) return;
    this.state = state;
    this.draw(state);
  }

  isOn(x: number, z: number): boolean {
    return this.mesh.visible && Math.hypot(x - HORSE_PAD.x, z - HORSE_PAD.z) < HORSE_PAD.radius;
  }

  update(now: number, playerOn: boolean): void {
    if (!this.mesh.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / (this.state === "ready" ? 260 : 600));
    const base = this.state === "ready" ? 0.75 : 0.45;
    this.mat.opacity = Math.min(1, base + 0.25 * pulse + (playerOn ? 0.25 : 0));
  }

  private draw(state: PadState): void {
    const c = this.canvas.getContext("2d")!;
    const S = this.canvas.width;
    const mid = S / 2;
    const gold = state === "playing" ? "#ff5a4f" : state === "ready" ? "#ffc93c" : "#9aa3ad";
    c.clearRect(0, 0, S, S);
    // Soft fill and a double LED ring.
    const g = c.createRadialGradient(mid, mid, S * 0.1, mid, mid, mid);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.75, hexA(gold, 0.12));
    g.addColorStop(1, hexA(gold, 0.28));
    c.fillStyle = g;
    c.beginPath();
    c.arc(mid, mid, mid - 2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = gold;
    c.shadowColor = gold;
    c.shadowBlur = 24;
    c.lineWidth = 14;
    c.beginPath();
    c.arc(mid, mid, mid - 16, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 4;
    c.setLineDash([18, 14]);
    c.beginPath();
    c.arc(mid, mid, mid - 46, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    // Title + state.
    c.fillStyle = gold;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `800 92px ${JERSEY_FONT}`;
    c.fillText("H-O-R-S-E", mid, mid - 36);
    c.shadowBlur = 12;
    c.font = `800 56px ${JERSEY_FONT}`;
    c.fillStyle = "#ffffff";
    const label = this.labels[state];
    c.fillText(state === "ready" ? `▶ ${label}` : label, mid, mid + 58);
    c.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
