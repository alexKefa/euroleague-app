// Clutch Court engine: renderer, loop, input, shots. Plain TS, no Angular.
// The page runs start() outside the Angular zone and receives low-rate HUD
// updates through EngineCallbacks (only when values change).
import { ACESFilmicToneMapping, Mesh, PerspectiveCamera, Vector3, WebGLRenderer } from "three";
import { BALL_RADIUS, RELEASE_HEIGHT, SHOT_COOLDOWN_SECONDS } from "../../../../../../shared/court/constants";
import { pickTargetHoop } from "../../../../../../shared/court/geometry";
import { randomSeed } from "../../../../../../shared/court/rng";
import { computeShotLaunch, effectiveTiming } from "../../../../../../shared/court/shot";
import { CourtPhysics, RapierApi } from "../../../../../../shared/court/sim";
import { HoopId } from "../../../../../../shared/court/types";
import { Avatar, JERSEY_FONT, JerseyText, createAvatar, createBall, createBlobShadow, releaseBallTexture, releaseShadowTexture } from "./avatar-factory";
import { BallPlayback } from "./ball-playback";
import { CourtAudio } from "./court-audio";
import { Joystick } from "./input/joystick";
import { KeyboardInput } from "./input/keyboard";
import { ShootMeter } from "./input/shoot-meter";
import { CAMERA_PRESETS, PlayerController } from "./player-controller";
import { BuiltScene, buildScene, disposeObject } from "./scene-builder";

export type ReleaseGrade = "perfect" | "good" | "early" | "late";

export interface PracticeStats {
  makes: number;
  attempts: number;
  streak: number;
  best: number;
}

export interface EngineCallbacks {
  onStats(stats: PracticeStats): void;
  onRelease(grade: ReleaseGrade): void;
  onShotResult(made: boolean, streak: number): void;
  onContextLost(): void;
  onContextRestored(): void;
}

export interface EngineDom {
  container: HTMLElement;
  meter: HTMLElement;
  meterFill: HTMLElement;
  joystickZone: HTMLElement | null;
}

export interface EngineOptions {
  teamPrimary: string;
  teamSecondary: string;
  cameraPreset: number;
  muted: boolean;
  bestStreak: number;
  jersey: JerseyText | null;
  /** Club logo for the floor (CORS-enabled URL), or null. */
  logoUrl: string | null;
}

const RETURN_MS = 380;
const NET_SWISH_MS = 450;

export class GameEngine {
  private renderer!: WebGLRenderer;
  private camera!: PerspectiveCamera;
  private built!: BuiltScene;
  private physics!: CourtPhysics;
  private avatar!: Avatar;
  private ball!: Mesh;
  private ballShadow!: Mesh;
  private readonly player = new PlayerController();
  private readonly audio = new CourtAudio();
  private keyboard: KeyboardInput | null = null;
  private joystick: Joystick | null = null;
  private meter!: ShootMeter;
  private resizeObserver: ResizeObserver | null = null;

  private raf = 0;
  private lastTime = 0;
  private running = false;
  private disposed = false;

  private targetHoop: HoopId = "A";
  private playback: BallPlayback | null = null;
  private returning: { from: Vector3; startedAt: number } | null = null;
  private cooldownUntil = 0;
  private lockUntil = 0;
  private dribblePhase = 0;
  private netSwish: { hoop: HoopId; startedAt: number } | null = null;
  private stats: PracticeStats;
  private readonly tmp = new Vector3();
  private readonly hand = new Vector3();

  constructor(
    private readonly dom: EngineDom,
    private readonly cb: EngineCallbacks,
    private readonly opts: EngineOptions
  ) {
    this.stats = { makes: 0, attempts: 0, streak: 0, best: opts.bestStreak };
    this.player.preset = Math.min(Math.max(0, opts.cameraPreset), CAMERA_PRESETS.length - 1);
    this.audio.muted = opts.muted;
  }

  /** Load Rapier, build the scene, start the loop. Throws if WebGL is unavailable. */
  async start(): Promise<void> {
    const [RAPIER, logo] = await Promise.all([
      import("@dimforge/rapier3d-compat").then(async (m) => {
        await m.default.init();
        return m.default;
      }),
      loadImage(this.opts.logoUrl, 4000),
      loadJerseyFont(),
    ]);
    if (this.disposed) return;
    this.physics = new CourtPhysics(RAPIER as unknown as RapierApi);

    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    const dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    this.renderer = new WebGLRenderer({ antialias: dpr < 2, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.dom.container.appendChild(canvas);

    this.camera = new PerspectiveCamera(60, 1, 0.1, 250);
    this.built = buildScene({ teamPrimary: this.opts.teamPrimary, logo, maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy() });
    this.avatar = createAvatar(this.opts.teamPrimary, this.opts.teamSecondary, this.opts.jersey);
    this.built.scene.add(this.avatar.root);
    this.ball = createBall();
    this.built.scene.add(this.ball);
    this.ballShadow = createBlobShadow(0.42);
    this.built.scene.add(this.ballShadow);

    this.meter = new ShootMeter(this.dom.meter, this.dom.meterFill);
    this.keyboard = new KeyboardInput({
      shootDown: () => this.pressShoot(),
      shootUp: () => this.releaseShoot(),
      cycleCamera: () => this.cycleCamera(),
    });
    if (this.dom.joystickZone) this.joystick = new Joystick(this.dom.joystickZone);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.dom.container);
    this.resize();
    this.cb.onStats({ ...this.stats });

    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- public controls (from the HUD) ----------

  pressShoot(): void {
    if (!this.running) return;
    this.audio.unlock();
    const now = performance.now();
    if (this.meter.charging || this.playback || this.returning || now < this.cooldownUntil) return;
    const target = pickTargetHoop(this.player.x, this.player.z, this.player.rotY);
    this.targetHoop = target.hoopId;
    this.player.lockedYaw = target.yaw;
    this.meter.start(now);
  }

  releaseShoot(): void {
    if (!this.running || !this.meter.charging) return;
    const now = performance.now();
    const timingError = this.meter.release(now);
    this.fire(timingError, now);
  }

  /** Returns the new preset index. */
  cycleCamera(): number {
    this.player.preset = (this.player.preset + 1) % CAMERA_PRESETS.length;
    return this.player.preset;
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.keyboard?.dispose();
    this.joystick?.dispose();
    this.resizeObserver?.disconnect();
    this.audio.dispose();
    this.meter?.cancel();
    if (this.built) disposeObject(this.built.scene);
    releaseBallTexture();
    releaseShadowTexture();
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener("webglcontextlost", this.onContextLost);
      canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      canvas.remove();
    }
    this.physics?.dispose();
  }

  // ---------- shots ----------

  private fire(timingError: number, now: number): void {
    const launch = computeShotLaunch(this.player.x, this.player.z, this.targetHoop, timingError, randomSeed());
    const result = this.physics.simulate(launch);
    this.playback = new BallPlayback(result, now, launch.spin);
    this.cooldownUntil = now + SHOT_COOLDOWN_SECONDS * 1000;
    this.lockUntil = now + 300;
    this.stats.attempts++;
    const eff = effectiveTiming(timingError);
    const grade: ReleaseGrade = launch.perfect ? "perfect" : Math.abs(eff) < 0.25 ? "good" : eff < 0 ? "early" : "late";
    this.cb.onRelease(grade);
  }

  private finishShot(made: boolean): void {
    if (made) {
      this.stats.makes++;
      this.stats.streak++;
      this.stats.best = Math.max(this.stats.best, this.stats.streak);
    } else {
      this.stats.streak = 0;
    }
    this.cb.onShotResult(made, this.stats.streak);
    this.cb.onStats({ ...this.stats });
  }

  // ---------- loop ----------

  private loop = (time: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    const now = performance.now();

    if (this.meter.charging && this.meter.update(now)) this.releaseShoot();
    if (!this.meter.charging && now >= this.lockUntil) this.player.lockedYaw = null;

    const kb = this.keyboard!.vector();
    const js = this.joystick?.vector() ?? { x: 0, y: 0 };
    const input = Math.hypot(js.x, js.y) > Math.hypot(kb.x, kb.y) ? js : kb;
    this.player.update(dt, input);

    this.updateAvatar(dt, now);
    this.updateBall(dt, now);
    this.updateNet(now);
    this.player.updateCamera(dt, this.camera);
    this.placeMeter();
    this.renderer.render(this.built.scene, this.camera);
  };

  private updateAvatar(dt: number, now: number): void {
    const { root, body } = this.avatar;
    root.position.set(this.player.x, 0, this.player.z);
    root.rotation.y = this.player.rotY;
    // Squat while charging, spring up on release, bob while running.
    let sy = 1;
    if (this.meter.charging) sy = 0.9;
    else if (now < this.lockUntil) sy = 1.06;
    else if (this.player.moving) sy = 1 + Math.sin(this.dribblePhase * 2) * 0.025;
    body.scale.y += (sy - body.scale.y) * Math.min(1, dt * 18);
    if (this.player.moving) this.dribblePhase += dt * 9;
  }

  private handPosition(out: Vector3): Vector3 {
    const p = this.player;
    const fx = Math.sin(p.rotY);
    const fz = Math.cos(p.rotY);
    if (this.meter.charging) {
      // Set point above the head (the release point is at RELEASE_HEIGHT).
      return out.set(p.x + fx * 0.15, RELEASE_HEIGHT - 0.1, p.z + fz * 0.15);
    }
    // Right-hand side; dribble while running.
    const rx = -fz;
    const rz = fx;
    const y = p.moving ? BALL_RADIUS + Math.abs(Math.cos(this.dribblePhase)) * 0.85 : 1.0;
    return out.set(p.x + rx * 0.34 + fx * 0.25, y, p.z + rz * 0.34 + fz * 0.25);
  }

  private updateBall(dt: number, now: number): void {
    const ball = this.ball;
    if (this.playback) {
      const pb = this.playback;
      pb.positionAt(now, ball.position);
      ball.rotateOnWorldAxis(pb.spin(now).axis, -dt * 7);
      for (const ev of pb.takeEvents(now)) {
        this.audio.play(ev.kind, ev.strength);
        if (ev.kind === "make") {
          this.netSwish = { hoop: this.targetHoop, startedAt: now };
          this.player.addShake(0.08);
          this.finishShot(true);
        }
      }
      if (pb.done(now)) {
        if (!pb.result.made) this.finishShot(false);
        this.playback = null;
        this.returning = { from: ball.position.clone(), startedAt: now };
      }
    } else if (this.returning) {
      const u = Math.min(1, (now - this.returning.startedAt) / RETURN_MS);
      const e = u * u * (3 - 2 * u);
      this.handPosition(this.hand);
      ball.position.lerpVectors(this.returning.from, this.hand, e);
      ball.position.y += Math.sin(u * Math.PI) * 0.8;
      if (u >= 1) this.returning = null;
    } else {
      this.handPosition(this.hand);
      const k = this.meter.charging ? 1 - Math.exp(-dt * 20) : 1;
      ball.position.lerp(this.hand, k);
      if (this.player.moving) ball.rotateX(dt * 8);
    }
    // Shadow follows on the floor and fades/grows with height.
    this.ballShadow.position.set(ball.position.x, 0.013, ball.position.z);
    const h = Math.max(0, ball.position.y - BALL_RADIUS);
    const s = 1 + h * 0.35;
    this.ballShadow.scale.set(s, s, s);
    (this.ballShadow.material as { opacity: number }).opacity = Math.max(0.15, 1 - h * 0.18);
  }

  private updateNet(now: number): void {
    for (const hoop of this.built.hoops.values()) {
      const swish = this.netSwish && this.netSwish.hoop === hoop.id ? (now - this.netSwish.startedAt) / NET_SWISH_MS : 1;
      if (swish < 1) {
        const w = Math.sin(swish * Math.PI) * (1 - swish * 0.4);
        hoop.net.scale.set(1 - w * 0.25, 1 + w * 0.35, 1 - w * 0.25);
        hoop.net.rotation.y = Math.sin(swish * 12) * 0.08 * (1 - swish);
      } else if (hoop.net.scale.y !== 1) {
        hoop.net.scale.set(1, 1, 1);
        hoop.net.rotation.y = 0;
      }
    }
  }

  private placeMeter(): void {
    if (this.dom.meter.style.display === "none") return;
    this.tmp.set(this.player.x, 2.0, this.player.z).project(this.camera);
    const w = this.dom.container.clientWidth;
    const h = this.dom.container.clientHeight;
    this.meter.place(((this.tmp.x + 1) / 2) * w + 44, ((1 - this.tmp.y) / 2) * h - 40);
  }

  private resize(): void {
    const w = this.dom.container.clientWidth;
    const h = this.dom.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow (portrait) screens get a wider vertical FOV so the hoop stays in view.
    this.camera.fov = w / h < 0.8 ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.meter.cancel();
    this.cb.onContextLost();
  };

  private onContextRestored = () => {
    // The page rebuilds the engine from scratch: simpler and safer than
    // re-uploading every GPU resource in place.
    this.cb.onContextRestored();
  };
}

/** Load an image for canvas use; resolves null on error or timeout (never blocks the court). */
function loadImage(url: string | null, timeoutMs: number): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/** Make sure the jersey font is ready before lettering is drawn into canvases. */
async function loadJerseyFont(): Promise<void> {
  try {
    await Promise.race([document.fonts.load(`800 64px ${JERSEY_FONT}`, "ΑΒΓ ABC 0123"), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    /* fall back to whatever font is available */
  }
}
