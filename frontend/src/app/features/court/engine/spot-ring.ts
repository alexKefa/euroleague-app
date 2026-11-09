// The H-O-R-S-E spot to match: a pulsing gold ring on the floor with the
// allowed radius (HORSE_SPOT_RADIUS), plus a faint filled disc.
import { AdditiveBlending, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene } from "three";
import { HORSE_SPOT_RADIUS } from "../../../../../../shared/court/horse";
import { disposeObject } from "./scene-builder";

export class SpotRing {
  private readonly group = new Group();
  private readonly ringMat = new MeshBasicMaterial({ color: "#ffc93c", transparent: true, side: DoubleSide, depthWrite: false });
  private readonly fillMat = new MeshBasicMaterial({ color: "#ffc93c", transparent: true, opacity: 0.12, depthWrite: false, blending: AdditiveBlending });

  constructor(private readonly scene: Scene) {
    const ring = new Mesh(new RingGeometry(HORSE_SPOT_RADIUS - 0.06, HORSE_SPOT_RADIUS, 48), this.ringMat);
    const fill = new Mesh(new CircleGeometry(HORSE_SPOT_RADIUS, 48), this.fillMat);
    for (const m of [ring, fill]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.group.add(m);
    }
    ring.position.y = 0.016;
    fill.position.y = 0.014;
    this.group.visible = false;
    scene.add(this.group);
  }

  show(x: number, z: number): void {
    this.group.position.set(x, 0, z);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(now: number): void {
    if (!this.group.visible) return;
    this.ringMat.opacity = 0.6 + 0.35 * Math.sin(now / 220);
  }

  dispose(): void {
    this.scene.remove(this.group);
    disposeObject(this.group);
  }
}
