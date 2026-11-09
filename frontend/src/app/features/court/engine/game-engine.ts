// Clutch Court engine: renderer, loop, input, shots. Plain TS, no Angular.
// The page runs start() outside the Angular zone and receives low-rate HUD
// updates through EngineCallbacks (only when values change).
import { ACESFilmicToneMapping, Mesh, PerspectiveCamera, Vector3, WebGLRenderer } from "three";
import { BALL_RADIUS, RELEASE_HEIGHT, SHOT_COOLDOWN_SECONDS } from "../../../../../../shared/court/constants";
import { pickTargetHoop } from "../../../../../../shared/court/geometry";
import { randomSeed } from "../../../../../../shared/court/rng";
import { computeShotLaunch, effectiveTiming } from "../../../../../../shared/court/shot";
import { CourtPhysics, RapierApi } from "../../../../../../shared/court/sim";
import { HoopId, ShotEvent, ShotResult } from "../../../../../../shared/court/types";
import { MAX_PLAYERS, MOVE_HZ, MoveMessage, PlayerAnim, ShootMessage, ShotMessage } from "../../../../../../shared/court/protocol";
import { JERSEY_FONT, JerseyText, createBall, createBlobShadow, releaseBallTexture, releaseShadowTexture } from "./avatar-factory";
import { AvatarBatch, AvatarRig } from "./avatar-rig";
import { BallPlayback } from "./ball-playback";
import { CourtAudio } from "./court-audio";
import { Joystick } from "./input/joystick";
import { KeyboardInput } from "./input/keyboard";
import { ShootMeter } from "./input/shoot-meter";
import { CAMERA_PRESETS, PlayerController } from "./player-controller";
import { RemoteInfo, RemotePlayers, releaseOffset, shotBallPosition } from "./remote-players";
import { SpotRing } from "./spot-ring";
import type { ShotRejectReason } from "../../../../../../shared/court/horse";
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
  /** A shot was refused by the H-O-R-S-E rules (locally or by the server). */
  onShotBlocked(reason: ShotRejectReason): void;
}

/** Multiplayer shots (M3). The engine predicts with the server's seed and plays the server's result. */
export interface ShotNet {
  /** The seed the server will use for our next shot, or null if not received yet. Consumed. */
  takeSeed(): number | null;
  send(m: ShootMessage): void;
}

export interface EngineDom {
  container: HTMLElement;
  meter: HTMLElement;
  meterFill: HTMLElement;
  joystickZone: HTMLElement | null;
}

export interface EngineOptions {
  /** Paint for the keys and centre circle (the court owner's club). */
  courtColor: string;
  /** The local player's kit. */
  kitPrimary: string;
  kitSecondary: string;
  /** Where the local player starts (multiplayer: the server's spawn point). */
  start?: { x: number; z: number; rotY: number };
  cameraPreset: number;
  muted: boolean;
  bestStreak: number;
  jersey: JerseyText | null;
  /** Club logo for the floor (CORS-enabled URL), or null. */
  logoUrl: string | null;
}

const RETURN_MS = 380;
const NET_SWISH_MS = 450;
/** Give up on a shot the server never answered (ball comes back). */
const SHOT_REPLY_TIMEOUT_MS = 3000;
/** Other players' shots fade out over this distance, metres. */
const HEARING_RANGE = 28;

export class GameEngine {
  private renderer!: WebGLRenderer;
  private camera!: PerspectiveCamera;
  private built!: BuiltScene;
  private physics!: CourtPhysics;
  private batch!: AvatarBatch;
  private rig!: AvatarRig;
  /** Hand-to-arc offset blended out just after our release. */
  private shotOffset = new Vector3();
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
  private remotes: RemotePlayers | null = null;
  private moveSink: ((m: MoveMessage) => void) | null = null;
  private lastMoveSentAt = 0;
  private lastSent: MoveMessage | null = null;
  private shotNet: ShotNet | null = null;
  private shotGate: ((x: number, z: number) => ShotRejectReason | null) | null = null;
  private spotRing: SpotRing | null = null;
  private clientShotId = 0;
  /** Our shot sent without a seed (no prediction): waiting for the server's result. */
  private awaitingShot: { clientShotId: number; sentAt: number } | null = null;
  /** The clientShotId our current (predicted) playback belongs to. */
  private playbackShotId = 0;

  constructor(
    private readonly dom: EngineDom,
    private readonly cb: EngineCallbacks,
    private readonly opts: EngineOptions
  ) {
    this.stats = { makes: 0, attempts: 0, streak: 0, best: opts.bestStreak };
    this.player.preset = Math.min(Math.max(0, opts.cameraPreset), CAMERA_PRESETS.length - 1);
    this.audio.muted = opts.muted;
    if (opts.start) {
      this.player.x = opts.start.x;
      this.player.z = opts.start.z;
      this.player.rotY = opts.start.rotY;
    }
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
    // Any first touch/key unlocks audio, so other players' shots are heard
    // even before we shoot ourselves.
    window.addEventListener("pointerdown", this.unlockAudio, true);
    window.addEventListener("keydown", this.unlockAudio, true);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.dom.container.appendChild(canvas);

    this.camera = new PerspectiveCamera(60, 1, 0.1, 250);
    this.built = buildScene({ teamPrimary: this.opts.courtColor, logo, maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy() });
    this.batch = new AvatarBatch(this.built.scene, MAX_PLAYERS);
    this.rig = new AvatarRig(this.batch, this.built.scene, this.batch.alloc()!, this.opts.kitPrimary, this.opts.kitSecondary, this.opts.jersey);
    this.remotes = new RemotePlayers(this.built.scene, this.batch);
    this.spotRing = new SpotRing(this.built.scene);
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
    if (this.meter.charging || this.playback || this.returning || this.awaitingShot || now < this.cooldownUntil) return;
    const blocked = this.shotGate?.(this.player.x, this.player.z) ?? null;
    if (blocked) {
      this.cb.onShotBlocked(blocked);
      return;
    }
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

  // ---------- multiplayer hooks (the engine itself knows nothing about Colyseus) ----------

  /** Local moves are passed here at most MOVE_HZ times a second, only when they change. */
  setMoveSink(sink: ((m: MoveMessage) => void) | null): void {
    this.moveSink = sink;
    this.lastSent = null;
  }

  setShotNet(net: ShotNet | null): void {
    this.shotNet = net;
  }

  /** H-O-R-S-E: who may shoot from where (null = shoot freely). */
  setShotGate(gate: ((x: number, z: number) => ShotRejectReason | null) | null): void {
    this.shotGate = gate;
  }

  /** H-O-R-S-E: the ring at the spot to match (null hides it). */
  setSpotRing(spot: { x: number; z: number } | null): void {
    if (spot) this.spotRing?.show(spot.x, spot.z);
    else this.spotRing?.hide();
  }

  /** An authoritative shot from the server: ours (confirm the prediction) or another player's. */
  onServerShot(msg: ShotMessage, mySessionId: string): void {
    if (!this.running) return;
    const now = performance.now();
    const result: ShotResult = { made: msg.made, keyframes: msg.keyframes, durationMs: msg.durationMs, events: msg.events };
    if (msg.shooterId !== mySessionId) {
      this.remotes?.startShot(msg.shooterId, result, msg.spin, msg.hoopId, now);
      return;
    }
    if (this.playback && this.playbackShotId === msg.clientShotId) {
      this.playback.replaceResult(result);
    } else if (this.awaitingShot?.clientShotId === msg.clientShotId) {
      this.awaitingShot = null;
      this.targetHoop = msg.hoopId;
      this.startPlayback(result, now, msg.spin);
      this.playbackShotId = msg.clientShotId;
    }
  }

  /** The server refused our shot (rate limit or H-O-R-S-E rules): the ball comes back, the attempt doesn't count. */
  onShotRejected(clientShotId: number, reason?: ShotRejectReason): void {
    const now = performance.now();
    if (reason) this.cb.onShotBlocked(reason);
    if (this.playback && this.playbackShotId === clientShotId) {
      this.returning = { from: this.ball.position.clone(), startedAt: now };
      this.playback = null;
    } else if (this.awaitingShot?.clientShotId === clientShotId) {
      this.awaitingShot = null;
    } else {
      return;
    }
    this.stats.attempts = Math.max(0, this.stats.attempts - 1);
    this.cb.onStats({ ...this.stats });
  }

  /** The server rejected a move: snap back. */
  applyCorrection(x: number, z: number): void {
    this.player.x = x;
    this.player.z = z;
    this.lastSent = null;
  }

  hasRemote(id: string): boolean {
    return this.remotes?.has(id) ?? false;
  }

  addRemote(id: string, info: RemoteInfo, x: number, z: number, rotY: number): void {
    this.remotes?.add(id, info, x, z, rotY);
  }

  pushRemote(id: string, x: number, z: number, rotY: number, anim: string): void {
    this.remotes?.push(id, x, z, rotY, anim, performance.now());
  }

  setRemoteConnected(id: string, connected: boolean): void {
    this.remotes?.setConnected(id, connected);
  }

  removeRemote(id: string): void {
    this.remotes?.remove(id);
  }

  remoteIds(): string[] {
    return this.remotes?.ids() ?? [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("pointerdown", this.unlockAudio, true);
    window.removeEventListener("keydown", this.unlockAudio, true);
    this.keyboard?.dispose();
    this.joystick?.dispose();
    this.resizeObserver?.disconnect();
    this.audio.dispose();
    this.meter?.cancel();
    this.moveSink = null;
    this.remotes?.dispose();
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
    // Shared court: the server simulates; with its seed in hand we predict
    // the identical shot locally so the release feels instant.
    const net = this.shotNet;
    const x = Math.round(this.player.x * 100) / 100;
    const z = Math.round(this.player.z * 100) / 100;
    const seed = net ? net.takeSeed() : randomSeed();
    const launch = computeShotLaunch(x, z, this.targetHoop, timingError, seed ?? 0);
    if (net) {
      const clientShotId = ++this.clientShotId;
      net.send({ clientShotId, timingError, hoopId: this.targetHoop, x, z });
      if (seed === null) {
        this.awaitingShot = { clientShotId, sentAt: now };
      } else {
        this.startPlayback(this.physics.simulate(launch), now, launch.spin);
        this.playback!.authoritative = false;
        this.playbackShotId = clientShotId;
      }
    } else {
      this.startPlayback(this.physics.simulate(launch), now, launch.spin);
    }
    this.cooldownUntil = now + SHOT_COOLDOWN_SECONDS * 1000;
    this.lockUntil = now + 300;
    this.stats.attempts++;
    const eff = effectiveTiming(timingError);
    const grade: ReleaseGrade = launch.perfect ? "perfect" : Math.abs(eff) < 0.25 ? "good" : eff < 0 ? "early" : "late";
    this.cb.onRelease(grade);
  }

  private startPlayback(result: ShotResult, now: number, spin: { x: number; y: number; z: number }): void {
    this.playback = new BallPlayback(result, now, spin);
    this.shotOffset = releaseOffset(result, this.ball.position);
    this.rig.release(now);
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
    this.remotes?.update(now, dt, this.onRemoteShotEvent);
    this.spotRing?.update(now);
    this.batch.commit();
    if (this.awaitingShot && now - this.awaitingShot.sentAt > SHOT_REPLY_TIMEOUT_MS) this.onShotRejected(this.awaitingShot.clientShotId);
    this.sendMove(now);
    this.player.updateCamera(dt, this.camera);
    this.placeMeter();
    this.renderer.render(this.built.scene, this.camera);
  };

  private sendMove(now: number): void {
    if (!this.moveSink || now - this.lastMoveSentAt < 1000 / MOVE_HZ) return;
    const p = this.player;
    const anim: PlayerAnim = this.meter.charging || now < this.lockUntil ? "shoot" : p.moving ? "run" : "idle";
    const m: MoveMessage = { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, rotY: Math.round(p.rotY * 100) / 100, anim };
    const last = this.lastSent;
    if (last && last.x === m.x && last.z === m.z && last.rotY === m.rotY && last.anim === m.anim) return;
    this.lastMoveSentAt = now;
    this.lastSent = m;
    this.moveSink(m);
  }

  private updateAvatar(dt: number, now: number): void {
    const p = this.player;
    if (p.moving) this.dribblePhase += dt * 9;
    this.rig.update(now, dt, p.x, p.z, p.rotY, {
      moving: p.moving,
      charging: this.meter.charging,
      chargeSeconds: this.meter.heldSeconds(now),
      dribblePhase: this.dribblePhase,
      speed: p.speed,
    });
  }

  /** Where the held ball is: the rig's hand (dribble, gather, set point). */
  private handPosition(out: Vector3): Vector3 {
    return this.rig.ballWorld(out);
  }

  private updateBall(dt: number, now: number): void {
    const ball = this.ball;
    if (this.playback) {
      const pb = this.playback;
      shotBallPosition(pb, this.shotOffset, now, ball.position);
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
      this.handPosition(ball.position);
      if (this.player.moving) ball.rotateX(dt * 8);
    }
    // Shadow follows on the floor and fades/grows with height.
    this.ballShadow.position.set(ball.position.x, 0.013, ball.position.z);
    const h = Math.max(0, ball.position.y - BALL_RADIUS);
    const s = 1 + h * 0.35;
    this.ballShadow.scale.set(s, s, s);
    (this.ballShadow.material as { opacity: number }).opacity = Math.max(0.15, 1 - h * 0.18);
  }

  private onRemoteShotEvent = (ev: ShotEvent, at: Vector3, hoop: HoopId): void => {
    const d = Math.hypot(at.x - this.player.x, at.z - this.player.z);
    this.audio.play(ev.kind, ev.strength, Math.max(0, 1 - d / HEARING_RANGE) * 0.8);
    if (ev.kind === "make") this.netSwish = { hoop, startedAt: performance.now() };
  };

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

  private unlockAudio = () => this.audio.unlock();

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
