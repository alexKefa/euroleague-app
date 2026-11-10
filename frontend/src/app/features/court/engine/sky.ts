// Gradient sky dome that follows the time of day: horizon -> zenith colours,
// a soft sun (or moon) glow, and stars once it's dark. One draw call.
import { BackSide, Color, Mesh, Scene, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import type { Lighting } from "./lighting";

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
    if (h < 0.0) col = uHorizon * (0.75 + 0.25 * (1.0 + h));
    // Sun / moon glow.
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.25) * (1.0 - 0.6 * uNight);
    // Stars: sparse hashed points, fading in at night, not near the horizon.
    if (uNight > 0.01 && h > 0.08) {
      vec3 cell = floor(d * 180.0);
      float star = step(0.9965, hash(cell));
      col += vec3(star) * uNight * smoothstep(0.08, 0.35, h) * 0.9;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor(scene: Scene) {
    this.mat = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uNight: { value: 0 },
      },
    });
    this.mesh = new Mesh(new SphereGeometry(200, 32, 16), this.mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setLighting(l: Lighting): void {
    const u = this.mat.uniforms;
    (u["uTop"]!.value as Color).set(l.skyTop);
    (u["uHorizon"]!.value as Color).set(l.skyHorizon);
    (u["uSunDir"]!.value as Vector3).set(l.sunDir.x, l.sunDir.y, l.sunDir.z);
    (u["uSunColor"]!.value as Color).set(l.sunColor);
    u["uNight"]!.value = 1 - Math.min(1, l.day / 0.3);
  }

  /** Keep the dome centred on the camera. */
  follow(cameraPos: Vector3): void {
    this.mesh.position.copy(cameraPos);
  }
}
