// LED glass court (one draw call). A dark glass floor with 1 m panel seams
// and a fake sky reflection; the markings are LED light drawn from a
// channel-packed mask (R = lines, G = key paint, B = 3-point line, so the
// arc can light up on its own). Effects, all in the fragment shader:
//   - a neon ripple from under the rim on every make;
//   - a soft glow under every player's feet, brighter while running;
//   - the 3-point line glowing gold while you charge a three;
//   - lines turning fire-orange on a 3+ streak;
//   - a slow shimmer travelling along the lines.
// Brighter at night (uDay) so it carries the scene after dark.
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";
import {
  BOARD_FROM_BASELINE,
  CENTER_CIRCLE_RADIUS,
  COURT_WIDTH,
  FREE_THROW_FROM_BOARD,
  HALF_LENGTH,
  HALF_WIDTH,
  KEY_WIDTH,
  THREE_POINT_CORNER_INSET,
  THREE_POINT_RADIUS,
} from "../../../../../../shared/court/constants";
import { ACTIVE_HOOPS, FENCE, HALF_COURT, hoopLayout } from "../../../../../../shared/court/geometry";
import type { Lighting } from "./lighting";

/** Painted court area: 1 m run-off around the lines, cut at the fence on a half court. */
const COURT_MIN_Z = -HALF_LENGTH - 1;
const COURT_MAX_Z = Math.min(HALF_LENGTH + 1, FENCE.maxZ);
const PX_PER_M = 64;
const TEX_W = COURT_WIDTH + 2;
/** Size of the club logo at the top of the arc, metres. */
const LOGO_SIZE = 2.3;
const MAX_RIPPLES = 4;
const MAX_PLAYERS = 8;
const RIPPLE_LIFE_S = 2.6;
/** Head-to-head score plane: width (m) and centre z (between the logo and midcourt). */
const SCORE_W = 9.5;
const SCORE_Z = -1.55;

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function drawScore(canvas: HTMLCanvasElement, s: FloorScore): void {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  const mid = W / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "middle";
  const glow = (color: string, blur: number) => {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  };
  // Scores either side of a dash, names further out, in each player's kit colour.
  ctx.font = `800 230px ${FLOOR_FONT}`;
  ctx.fillStyle = "#ffffff";
  glow("#ffffff", 30);
  ctx.textAlign = "right";
  ctx.fillText(s.left.value, mid - 90, H / 2 + 8);
  ctx.textAlign = "left";
  ctx.fillText(s.right.value, mid + 90, H / 2 + 8);
  ctx.textAlign = "center";
  ctx.fillText("–", mid, H / 2);
  const name = (n: string, color: string, x: number, align: CanvasTextAlign) => {
    let px = 120;
    ctx.font = `800 ${px}px ${FLOOR_FONT}`;
    while (ctx.measureText(n).width > W * 0.27 && px > 50) ctx.font = `800 ${(px -= 6)}px ${FLOOR_FONT}`;
    ctx.textAlign = align;
    ctx.fillStyle = lighten(color);
    glow(lighten(color), 26);
    ctx.fillText(n.toUpperCase(), x, H / 2 + 6);
  };
  const valueW = (v: string) => {
    ctx.font = `800 230px ${FLOOR_FONT}`;
    return ctx.measureText(v).width;
  };
  name(s.left.name, s.left.color, mid - 90 - valueW(s.left.value) - 60, "right");
  name(s.right.name, s.right.color, mid + 90 + valueW(s.right.value) + 60, "left");
  ctx.shadowBlur = 0;
}

/** Kit colours can be very dark; LEDs need them bright enough to read. */
function lighten(hex: string): string {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s + 0.1), Math.max(hsl.l, 0.62));
  return "#" + c.getHexString();
}

const FLOOR_FONT = '"Sofia Sans Condensed", "Arial Narrow", sans-serif';

/** The big LED head-to-head on the floor near midcourt (null hides it). */
export interface FloorScore {
  left: { name: string; color: string; value: string };
  right: { name: string; color: string; value: string };
}

export interface FloorPlayer {
  x: number;
  z: number;
  /** 0 = standing .. 1 = full speed. */
  run: number;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMask;
  uniform sampler2D uLogo;
  uniform float uHasLogo;
  uniform vec3 uLogoRect; // centre x, centre z, half size
  uniform float uTime;
  uniform vec3 uTeam;
  uniform vec3 uTeam2;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform float uDay;
  uniform float uArc;
  uniform float uFire;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform int uRippleCount;
  uniform vec3 uPlayers[${MAX_PLAYERS}];
  uniform int uPlayerCount;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = clamp(V.y, 0.0, 1.0);
    float fres = pow(1.0 - ndv, 3.0);

    // Glass: deep tinted black, 1 m LED panel seams.
    vec3 glass = vec3(0.012, 0.015, 0.022) + uTeam * 0.025;
    vec2 cell = abs(fract(vWorld.xz) - 0.5);
    float seam = smoothstep(0.484, 0.5, max(cell.x, cell.y));
    glass *= 1.0 - 0.45 * seam;
    // Fake sky reflection, strongest at grazing angles.
    vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(ndv * 1.6, 0.0, 1.0));
    vec3 col = glass + sky * (0.05 + 0.45 * fres);

    float led = mix(1.7, 0.85, uDay);
    vec4 m = texture2D(uMask, vUv);
    float shimmer = 0.8 + 0.2 * sin(uTime * 1.6 - (vWorld.x * 0.5 + vWorld.z * 0.35));
    vec3 lineCol = mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.42, 0.08), uFire);
    vec3 arcCol = mix(lineCol, vec3(1.0, 0.78, 0.18), uArc);
    float arcPulse = shimmer + uArc * (0.7 + 0.3 * sin(uTime * 9.0));
    col += m.r * lineCol * shimmer * led;
    col += m.b * arcCol * arcPulse * led;
    col += m.g * uTeam * 0.4 * led;

    if (uHasLogo > 0.5) {
      vec2 lu = (vWorld.xz - uLogoRect.xy) / (2.0 * uLogoRect.z) + 0.5;
      if (lu.x > 0.0 && lu.x < 1.0 && lu.y > 0.0 && lu.y < 1.0) {
        vec4 lg = texture2D(uLogo, vec2(lu.x, 1.0 - lu.y));
        col += lg.rgb * lg.a * 0.8 * led;
      }
    }

    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      if (i >= uRippleCount) break;
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      float d = distance(vWorld.xz, r.xy);
      float rad = age * 7.5;
      float ring = exp(-pow((d - rad) / 0.45, 2.0)) * exp(-age * 1.1) * r.w;
      float echo = exp(-pow((d - rad * 0.6) / 0.3, 2.0)) * exp(-age * 1.6) * r.w * 0.5;
      col += ((uTeam * 1.4 + vec3(0.25)) * ring + uTeam2 * echo) * led;
    }

    for (int i = 0; i < ${MAX_PLAYERS}; i++) {
      if (i >= uPlayerCount) break;
      vec2 dp = vWorld.xz - uPlayers[i].xy;
      float g = exp(-dot(dp, dp) * 2.2);
      col += (uTeam * 0.6 + vec3(0.12)) * g * (0.3 + 0.7 * uPlayers[i].z) * led * 0.5;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class LedFloor {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly ripples: { x: number; z: number; t: number; s: number }[] = [];
  private arc = 0;
  private fire = 0;
  private readonly score: { mesh: Mesh; mat: MeshBasicMaterial; canvas: HTMLCanvasElement; tex: CanvasTexture; key: string; flashAt: number };

  constructor(
    scene: Scene,
    opts: { teamPrimary: string; teamSecondary: string; logo: HTMLImageElement | null; maxAnisotropy: number }
  ) {
    const mask = courtMask();
    mask.anisotropy = opts.maxAnisotropy;
    const logo = logoTexture(opts.logo);
    const logoZ = hoopLayout("A").rim.z + THREE_POINT_RADIUS + LOGO_SIZE / 2 + 0.15;
    this.mat = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMask: { value: mask },
        uLogo: { value: logo },
        uHasLogo: { value: logo ? 1 : 0 },
        uLogoRect: { value: new Vector3(0, logoZ, LOGO_SIZE / 2) },
        uTime: { value: 0 },
        uTeam: { value: new Color(opts.teamPrimary) },
        uTeam2: { value: new Color(opts.teamSecondary) },
        uSkyTop: { value: new Color("#6fa8dc") },
        uSkyHorizon: { value: new Color("#cfe4f5") },
        uDay: { value: 1 },
        uArc: { value: 0 },
        uFire: { value: 0 },
        uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()) },
        uRippleCount: { value: 0 },
        uPlayers: { value: Array.from({ length: MAX_PLAYERS }, () => new Vector3()) },
        uPlayerCount: { value: 0 },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(COURT_WIDTH + 2, COURT_MAX_Z - COURT_MIN_Z), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.z = (COURT_MAX_Z + COURT_MIN_Z) / 2;
    scene.add(this.mesh);

    // Head-to-head score: its own additive plane between the logo and midcourt.
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 320;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = opts.maxAnisotropy;
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
    const mesh = new Mesh(new PlaneGeometry(SCORE_W, (SCORE_W * canvas.height) / canvas.width), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.014, SCORE_Z);
    mesh.renderOrder = 1;
    mesh.visible = false;
    scene.add(mesh);
    this.score = { mesh, mat, canvas, tex, key: "", flashAt: -Infinity };
  }

  /** Show / update / hide the head-to-head (flashes when it changes). */
  setScore(s: FloorScore | null): void {
    const sc = this.score;
    sc.mesh.visible = s !== null;
    if (!s) {
      sc.key = "";
      return;
    }
    const key = JSON.stringify(s);
    if (key === sc.key) return;
    if (sc.key) sc.flashAt = performance.now();
    sc.key = key;
    drawScore(sc.canvas, s);
    sc.tex.needsUpdate = true;
  }

  /** A make: a ring of light spreads out from (x, z). */
  ripple(x: number, z: number, strength: number, nowMs: number): void {
    this.ripples.push({ x, z, t: nowMs / 1000, s: strength });
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
  }

  private dayFactor(): number {
    return this.mat.uniforms["uDay"]!.value as number;
  }

  setLighting(l: Lighting): void {
    const u = this.mat.uniforms;
    (u["uSkyTop"]!.value as Color).set(l.skyTop);
    (u["uSkyHorizon"]!.value as Color).set(l.skyHorizon);
    u["uDay"]!.value = l.day;
  }

  /** Per frame. arc / fire: 0 or 1 targets, eased here. */
  update(nowMs: number, dt: number, players: FloorPlayer[], arc: number, fire: number): void {
    const u = this.mat.uniforms;
    const t = nowMs / 1000;
    u["uTime"]!.value = t;
    const k = 1 - Math.exp(-8 * dt);
    this.arc += (arc - this.arc) * k;
    this.fire += (fire - this.fire) * (1 - Math.exp(-3 * dt));
    u["uArc"]!.value = this.arc;
    u["uFire"]!.value = this.fire;

    while (this.ripples.length && t - this.ripples[0]!.t > RIPPLE_LIFE_S) this.ripples.shift();
    const rs = u["uRipples"]!.value as Vector4[];
    this.ripples.forEach((r, i) => rs[i]!.set(r.x, r.z, r.t, r.s));
    u["uRippleCount"]!.value = this.ripples.length;

    if (this.score.mesh.visible) {
      const since = nowMs - this.score.flashAt;
      const flash = since < 900 ? 1 - since / 900 : 0;
      this.score.mat.opacity = mix(0.55, 0.95, 1 - this.dayFactor()) + 0.4 * flash;
    }

    const ps = u["uPlayers"]!.value as Vector3[];
    const n = Math.min(MAX_PLAYERS, players.length);
    for (let i = 0; i < n; i++) ps[i]!.set(players[i]!.x, players[i]!.z, players[i]!.run);
    u["uPlayerCount"]!.value = n;
  }
}

/** R = lines, G = key paint, B = 3-point line; soft halos so the LEDs bloom. */
function courtMask(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W * PX_PER_M;
  canvas.height = Math.round((COURT_MAX_Z - COURT_MIN_Z) * PX_PER_M);
  const ctx = canvas.getContext("2d")!;
  // World (x, z) -> canvas px. Canvas top (y = 0) is world -z (hoop A end).
  const X = (x: number) => (x + TEX_W / 2) * PX_PER_M;
  const Y = (z: number) => (z - COURT_MIN_Z) * PX_PER_M;
  const M = (m: number) => m * PX_PER_M;
  const courtEndZ = HALF_COURT ? 0 : HALF_LENGTH;
  const courtLen = courtEndZ + HALF_LENGTH;
  const keyLen = BOARD_FROM_BASELINE + FREE_THROW_FROM_BOARD;
  const RED = "rgb(255,0,0)";
  const BLUE = "rgb(0,0,255)";

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";

  ctx.save();
  ctx.beginPath();
  ctx.rect(X(-HALF_WIDTH), Y(-HALF_LENGTH), M(COURT_WIDTH), M(courtLen));
  ctx.clip();

  // Key paint and centre circle (green).
  ctx.fillStyle = "rgb(0,255,0)";
  for (const id of ACTIVE_HOOPS) {
    const s = id === "A" ? -1 : 1;
    ctx.fillRect(X(-KEY_WIDTH / 2), Math.min(Y(s * HALF_LENGTH), Y(s * (HALF_LENGTH - keyLen))), M(KEY_WIDTH), M(keyLen));
  }
  ctx.beginPath();
  ctx.arc(X(0), Y(0), M(CENTER_CIRCLE_RADIUS), 0, Math.PI * 2);
  ctx.fill();

  // Lines: each stroked with a glow halo (shadowBlur) in its own channel.
  const stroke = (color: string, draw: () => void) => {
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.lineWidth = M(0.06);
    ctx.shadowBlur = M(0.18);
    draw();
    ctx.shadowBlur = 0;
    draw();
  };
  stroke(RED, () => {
    ctx.beginPath();
    ctx.arc(X(0), Y(0), M(CENTER_CIRCLE_RADIUS), 0, Math.PI * 2);
    ctx.stroke();
  });
  for (const id of ACTIVE_HOOPS) {
    const s = id === "A" ? -1 : 1;
    const rimZ = hoopLayout(id).rim.z;
    const baseline = s * HALF_LENGTH;
    const ftZ = s * (HALF_LENGTH - keyLen);
    const towardMid: [number, number] = s === -1 ? [0, Math.PI] : [Math.PI, 2 * Math.PI];
    stroke(RED, () => {
      ctx.strokeRect(X(-KEY_WIDTH / 2), Math.min(Y(baseline), Y(ftZ)), M(KEY_WIDTH), M(keyLen));
      ctx.beginPath();
      ctx.arc(X(0), Y(ftZ), M(1.8), towardMid[0], towardMid[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(0), Y(rimZ), M(1.25), towardMid[0], towardMid[1]);
      ctx.stroke();
    });
    const cornerX = HALF_WIDTH - THREE_POINT_CORNER_INSET;
    const dz = Math.sqrt(THREE_POINT_RADIUS ** 2 - cornerX ** 2);
    const meetZ = rimZ - s * dz;
    const a = Math.atan2(-s * dz, cornerX);
    const b = Math.atan2(-s * dz, -cornerX);
    stroke(BLUE, () => {
      ctx.beginPath();
      ctx.moveTo(X(-cornerX), Y(baseline));
      ctx.lineTo(X(-cornerX), Y(meetZ));
      ctx.moveTo(X(cornerX), Y(baseline));
      ctx.lineTo(X(cornerX), Y(meetZ));
      ctx.stroke();
      ctx.beginPath();
      if (s === -1) ctx.arc(X(0), Y(rimZ), M(THREE_POINT_RADIUS), a, b, false);
      else ctx.arc(X(0), Y(rimZ), M(THREE_POINT_RADIUS), b, a, false);
      ctx.stroke();
    });
  }
  ctx.restore(); // clip

  // Boundary on top, unclipped.
  stroke(RED, () => {
    ctx.strokeRect(X(-HALF_WIDTH), Y(-HALF_LENGTH), M(COURT_WIDTH), M(courtLen));
    if (!HALF_COURT) {
      ctx.beginPath();
      ctx.moveTo(X(-HALF_WIDTH), Y(0));
      ctx.lineTo(X(HALF_WIDTH), Y(0));
      ctx.stroke();
    }
  });

  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

/** The club crest on its own small texture (the shader places it in world space). */
function logoTexture(logo: HTMLImageElement | null): CanvasTexture | null {
  if (!logo || !logo.naturalWidth) return null;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.min(size / logo.naturalWidth, size / logo.naturalHeight);
  const w = logo.naturalWidth * scale;
  const h = logo.naturalHeight * scale;
  ctx.drawImage(logo, (size - w) / 2, (size - h) / 2, w, h);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
