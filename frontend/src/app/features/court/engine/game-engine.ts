// Clutch Court engine: renderer, loop, input, shots. Plain TS, no Angular.
// The page runs start() outside the Angular zone and receives low-rate HUD
// updates through EngineCallbacks (only when values change).
import { ACESFilmicToneMapping, Mesh, PerspectiveCamera, Vector3, WebGLRenderer } from "three";
import { BALL_RADIUS, RELEASE_HEIGHT, SHOT_COOLDOWN_SECONDS } from "../../../../../../shared/court/constants";
import { hoopLayout, insideThreePoint, pickTargetHoop } from "../../../../../../shared/court/geometry";
import { type TimeMode, indoorLighting, lightingFor, resolveHour } from "./lighting";
import type { FloorPlayer, FloorScore } from "./led-floor";
import { HorsePad, type PadState } from "./horse-pad";
import { randomSeed } from "../../../../../../shared/court/rng";
import {
  type ReleaseGrade,
  computeShotLaunch,
  greenHalfWidth,
  layupEligible,
  releaseGrade,
  shotDistance,
} from "../../../../../../shared/court/shot";
import { LAYUP_METER_FILL_SECONDS, METER_FILL_SECONDS } from "../../../../../../shared/court/constants";
import { CourtPhysics, RapierApi } from "../../../../../../shared/court/sim";
import { HoopId, ShotEvent, ShotResult } from "../../../../../../shared/court/types";
import { MAX_PLAYERS, MOVE_HZ, MoveMessage, PlayerAnim, ShootMessage, ShotMessage } from "../../../../../../shared/court/protocol";
import { JERSEY_FONT, JerseyText, createBall, createBlobShadow, releaseBallTexture, releaseShadowTexture } from "./avatar-factory";
import { AvatarBatch, AvatarRig } from "./avatar-rig";
import { BallPlayback } from "./ball-playback";
import { CourtAudio } from "./court-audio";
import { releaseNetTexture } from "./hoop-net";
import type { AvatarLook } from "../../../../../../shared/court/avatar";
import { Joystick } from "./input/joystick";
import { KeyboardInput } from "./input/keyboard";
import { ShootMeter } from "./input/shoot-meter";
import { CAMERA_PRESETS, PlayerController } from "./player-controller";
import { RemoteInfo, RemotePlayers, releaseOffset, shotBallPosition } from "./remote-players";
import { SpotRing } from "./spot-ring";
import type { ShotRejectReason } from "../../../../../../shared/court/horse";
import { BuiltScene, buildScene, disposeObject } from "./scene-builder";
import { FrameGovernor } from "./frame-governor";
import { ReactionBubbles } from "./reaction-bubbles";
import type { JumbotronContent } from "./venue";
import { isEmoteId, type ReactionId } from "../../../../../../shared/court/protocol";

/** Bubble key for our own player (remote players use their sessionId). */
const ME = "#me";

/** Live render numbers for the ?perf=1 overlay. */
export interface PerfStats {
  fps: number;
  low1: number;
  dpr: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export type { ReleaseGrade };

export interface PracticeStats {
  makes: number;
  attempts: number;
  streak: number;
  best: number;
}

export interface EngineCallbacks {
  onStats(stats: PracticeStats): void;
  onRelease(grade: ReleaseGrade, layup: boolean): void;
  onShotResult(made: boolean, streak: number): void;
  onContextLost(): void;
  onContextRestored(): void;
  /** A shot was refused by the H-O-R-S-E rules (locally or by the server). */
  onShotBlocked(reason: ShotRejectReason): void;
  /** The local player stepped onto / off the H-O-R-S-E pad. */
  onHorsePad(on: boolean): void;
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
  /** Time-of-day look: follow the clock, or a fixed day / sunset / night. */
  timeMode: TimeMode;
  muted: boolean;
  bestStreak: number;
  jersey: JerseyText | null;
  /** The local player's Locker-room look (null: automatic from the shirt number). */
  look?: AvatarLook | null;
  /** Club logo for the floor (CORS-enabled URL), or null. */
  logoUrl: string | null;
  /** The court owner's club for the mural, the fans and the jumbotron (null: no club). */
  courtTeam: { name: string; code: string; secondary: string } | null;
}

const RETURN_MS = 380;
/** Give up on a shot the server never answered (ball comes back). */
const SHOT_REPLY_TIMEOUT_MS = 3000;
/** Other players' shots fade out over this distance, metres. */
const HEARING_RANGE = 28;
/** Most device pixels rendered per frame (~1080p). A phone at dpr 2 is ~1.3M. */
const MAX_RENDER_PIXELS = 2_100_000;
/** Above this many device pixels the canvas is rendered without MSAA. */
const AA_MAX_PIXELS = 1_000_000;
/** How far the frame governor may scale the resolution down (on top of the pixel cap). */
const MIN_RENDER_SCALE = 0.5;

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
  private governor: FrameGovernor | null = null;
  /** The device's pixel ratio, capped (2, or 1.5 on low-end hardware). */
  private maxDpr = 1;
  /** The governor's quality scale on top of the size-aware ratio (1 = full). */
  private renderScale = 1;
  private lastCalls = 0;
  private timeMode: TimeMode = "auto";
  private lightingAt = 0;
  private lastShotPerfect = false;
  private readonly floorPlayers: FloorPlayer[] = [];
  private lastTriangles = 0;
  private running = false;
  private disposed = false;

  private targetHoop: HoopId = "A";
  private playback: BallPlayback | null = null;
  private returning: { from: Vector3; startedAt: number } | null = null;
  private cooldownUntil = 0;
  private lockUntil = 0;
  /** The current / last shot is a layup (decided when the button goes down). */
  private layupShot = false;
  /** Smoothed ground velocity, m/s (for layup eligibility). */
  private readonly vel = { x: 0, z: 0 };
  /** Connection lost: no movement or shots until it's back (the server would snap us back anyway). */
  private frozen = false;
  private dribblePhase = 0;
  /** Every ball on court this frame (the nets react to them). */
  private readonly ballsOnCourt: Vector3[] = [];
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
  private bubbles: ReactionBubbles | null = null;
  private pad: HorsePad | null = null;
  private onPad = false;
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
    this.maxDpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    // MSAA only on small canvases: on a big desktop window it multiplies the
    // cost of an already large frame (phones at dpr 2 never needed it).
    const cssPixels = (this.dom.container.clientWidth || window.innerWidth) * (this.dom.container.clientHeight || window.innerHeight);
    const antialias = this.maxDpr < 2 && cssPixels * this.maxDpr * this.maxDpr <= AA_MAX_PIXELS;
    this.renderer = new WebGLRenderer({ antialias, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.maxDpr);
    // The governor controls a quality scale on top of the size-aware ratio, so
    // it can still act on a desktop already at dpr 1.
    this.governor = new FrameGovernor(1, MIN_RENDER_SCALE);
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
    const ct = this.opts.courtTeam;
    this.built = buildScene({
      teamPrimary: this.opts.courtColor,
      logo,
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
      venue: { name: ct?.name ?? "", code: ct?.code ?? "", primary: this.opts.courtColor, secondary: ct?.secondary ?? "#0b1220", logo },
    });
    this.batch = new AvatarBatch(this.built.scene, MAX_PLAYERS);
    this.rig = new AvatarRig(this.batch, this.built.scene, this.batch.alloc()!, this.opts.kitPrimary, this.opts.kitSecondary, this.opts.jersey, this.opts.look ?? null);
    this.remotes = new RemotePlayers(this.built.scene, this.batch);
    this.spotRing = new SpotRing(this.built.scene);
    this.bubbles = new ReactionBubbles(this.built.scene);
    this.pad = new HorsePad(this.built.scene);
    this.timeMode = this.opts.timeMode;
    this.applyLighting();
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
    if (this.frozen || this.meter.charging || this.playback || this.returning || this.awaitingShot || now < this.cooldownUntil) return;
    const blocked = this.shotGate?.(this.player.x, this.player.z) ?? null;
    if (blocked) {
      this.cb.onShotBlocked(blocked);
      return;
    }
    const target = pickTargetHoop(this.player.x, this.player.z, this.player.rotY);
    this.targetHoop = target.hoopId;
    this.player.lockedYaw = target.yaw;
    // Driving at the rim from close range turns the shot into a layup.
    this.layupShot = layupEligible(this.player.x, this.player.z, target.hoopId, this.vel.x, this.vel.z);
    // The green is wide at the rim and tight from deep; the meter shows it before you shoot.
    const kind = this.layupShot ? "layup" : "jumper";
    const green = greenHalfWidth(shotDistance(this.player.x, this.player.z, target.hoopId, kind), kind);
    this.meter.start(now, this.layupShot ? LAYUP_METER_FILL_SECONDS : METER_FILL_SECONDS, green);
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

  /** Freeze local input while the connection is down; unfreezing re-sends our position. */
  setFrozen(frozen: boolean): void {
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    if (frozen) this.meter.cancel();
    else this.lastSent = null;
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
      this.remotes?.startShot(msg.shooterId, result, msg.spin, msg.hoopId, now, msg.layup === true);
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

  /**
   * Show an emote or quick phrase. playerId null = us. text is what goes in
   * the bubble (the emoji, or the phrase in the viewer's language).
   */
  react(id: ReactionId, text: string, playerId: string | null): void {
    if (!this.running) return;
    const now = performance.now();
    if (isEmoteId(id)) {
      if (playerId === null) this.rig.emote(id, now);
      else this.remotes?.emote(playerId, id, now);
    }
    this.bubbles?.show(playerId ?? ME, text, isEmoteId(id), now);
  }

  /** The H-O-R-S-E pad on the floor (null hides it: practice courts). */
  setHorsePad(state: PadState | null, labels?: Record<PadState, string>): void {
    if (labels) this.pad?.setLabels(labels);
    this.pad?.setState(state);
  }

  setCameraPreset(preset: number): void {
    this.player.preset = Math.max(0, Math.min(CAMERA_PRESETS.length - 1, Math.floor(preset) || 0));
  }

  /** Switch the time-of-day look (auto follows the clock). */
  setTimeMode(mode: TimeMode): void {
    this.timeMode = mode;
    if (this.built) this.applyLighting();
  }

  private applyLighting(): void {
    const l = lightingFor(resolveHour(this.timeMode));
    const g = indoorLighting(l);
    const b = this.built;
    b.hemi.color.set(g.hemiSky);
    b.hemi.groundColor.set(g.hemiGround);
    b.hemi.intensity = g.hemiIntensity;
    b.sun.color.set(g.keyColor);
    b.sun.intensity = g.keyIntensity;
    b.sun.position.set(g.keyDir.x * 30, g.keyDir.y * 30, g.keyDir.z * 30);
    // The glass floor reflects the ceiling and the walls, not the sky.
    b.floor.setLighting({ ...l, skyTop: "#2c3036", skyHorizon: "#7d7a74" });
    b.gym.setLighting(g);
    this.lightingAt = performance.now();
  }

  /** LED floor: who's where, the 3-point glow while charging a three, fire on a streak. */
  private updateFloor(now: number, dt: number): void {
    // "auto" drifts with the clock: re-light once a minute.
    if (this.timeMode === "auto" && now - this.lightingAt > 60_000) this.applyLighting();
    const p = this.player;
    const fp = this.floorPlayers;
    fp.length = 0;
    fp.push({ x: p.x, z: p.z, run: Math.min(1, p.speed / 4.5) });
    this.remotes?.floorPlayers(fp);
    const arc = this.meter.charging && !this.layupShot && !insideThreePoint(this.targetHoop, p.x, p.z) ? 1 : 0;
    const fire = this.stats.streak >= 3 ? 1 : 0;
    this.built.floor.update(now, dt, fp, arc, fire);
    const on = this.pad?.isOn(p.x, p.z) ?? false;
    if (on !== this.onPad) {
      this.onPad = on;
      this.cb.onHorsePad(on);
    }
    this.pad?.update(now, on);
  }

  /** The LED head-to-head score on the floor (null hides it). */
  setFloorScore(score: FloorScore | null): void {
    this.built?.floor.setScore(score);
  }

  /** What the jumbotron shows (redrawn only when it changes). */
  setJumbotron(content: JumbotronContent): void {
    this.built?.venue.jumbotron.set(content);
  }

  /** Make the crowd stand up and cheer (e.g. a H-O-R-S-E winner). */
  cheer(strength = 1.5): void {
    if (this.running) this.built.venue.crowd.cheer(performance.now(), strength);
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
    this.bubbles?.dispose();
    if (this.built) disposeObject(this.built.scene);
    releaseBallTexture();
    releaseShadowTexture();
    releaseNetTexture();
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener("webglcontextlost", this.onContextLost);
      canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      // Give the GL context back now instead of whenever GC runs: browsers keep
      // only ~16 alive and kill the oldest after that (each court visit made one).
      // The context-lost listener is already removed, so this doesn't trip it.
      this.renderer.forceContextLoss();
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
    const kind = this.layupShot ? "layup" : "jumper";
    const launch = computeShotLaunch(x, z, this.targetHoop, timingError, seed ?? 0, kind);
    if (net) {
      const clientShotId = ++this.clientShotId;
      net.send({ clientShotId, timingError, hoopId: this.targetHoop, x, z, layup: this.layupShot });
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
    const grade = releaseGrade(timingError, launch.distance, kind);
    this.lastShotPerfect = launch.perfect;
    this.cb.onRelease(grade, this.layupShot);
  }

  private startPlayback(result: ShotResult, now: number, spin: { x: number; y: number; z: number }): void {
    this.playback = new BallPlayback(result, now, spin);
    this.shotOffset = releaseOffset(result, this.ball.position);
    this.rig.release(now, this.layupShot);
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
    const frameMs = time - this.lastTime;
    const dt = Math.min(0.05, frameMs / 1000);
    this.lastTime = time;
    const now = performance.now();
    const nextScale = this.governor?.frame(now, frameMs) ?? null;
    if (nextScale !== null) {
      this.renderScale = nextScale;
      this.resize();
    }

    if (this.meter.charging && this.meter.update(now)) this.releaseShoot();
    if (!this.meter.charging && now >= this.lockUntil) this.player.lockedYaw = null;

    const kb = this.keyboard!.vector();
    const js = this.joystick?.vector() ?? { x: 0, y: 0 };
    const raw = this.frozen ? { x: 0, y: 0 } : Math.hypot(js.x, js.y) > Math.hypot(kb.x, kb.y) ? js : kb;
    // The layup gather slows you to two quick steps.
    const slow = this.meter.charging && this.layupShot ? 0.45 : 1;
    const input = { x: raw.x * slow, y: raw.y * slow };
    const px = this.player.x;
    const pz = this.player.z;
    this.player.update(dt, input);
    if (dt > 0) {
      const k = 1 - Math.exp(-12 * dt);
      this.vel.x += ((this.player.x - px) / dt - this.vel.x) * k;
      this.vel.z += ((this.player.z - pz) / dt - this.vel.z) * k;
    }

    this.updateAvatar(dt, now);
    this.updateBall(dt, now);
    this.updateNet(now);
    this.remotes?.update(now, dt, this.onRemoteShotEvent);
    this.spotRing?.update(now);
    this.built.venue.update(now);
    this.bubbles?.update(now, (key, out) => (key === ME ? out.set(this.player.x, 0, this.player.z) : (this.remotes?.positionOf(key, out) ?? null)));
    this.batch.commit();
    if (this.awaitingShot && now - this.awaitingShot.sentAt > SHOT_REPLY_TIMEOUT_MS) this.onShotRejected(this.awaitingShot.clientShotId);
    this.sendMove(now);
    this.player.updateCamera(dt, this.camera);
    this.updateFloor(now, dt);
    this.placeMeter();
    this.renderer.render(this.built.scene, this.camera);
    this.lastCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
  };

  /** Render numbers for the ?perf=1 overlay (null before the first frame). */
  perfStats(): PerfStats | null {
    if (!this.renderer || !this.governor) return null;
    const g = this.governor.stats();
    const mem = this.renderer.info.memory;
    return { ...g, dpr: Math.round(this.renderer.getPixelRatio() * 100) / 100, calls: this.lastCalls, triangles: this.lastTriangles, geometries: mem.geometries, textures: mem.textures };
  }

  private sendMove(now: number): void {
    if (!this.moveSink || now - this.lastMoveSentAt < 1000 / MOVE_HZ) return;
    const p = this.player;
    const anim: PlayerAnim = this.meter.charging || now < this.lockUntil ? (this.layupShot ? "layup" : "shoot") : p.moving ? "run" : "idle";
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
      layup: this.layupShot,
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
        if (ev.kind === "rim") this.built.hoops.get(this.targetHoop)?.net.shake(now, ev.strength);
        if (ev.kind === "make") {
          this.built.venue.crowd.cheer(now, 1);
          const rim = hoopLayout(this.targetHoop).rim;
          // The net sways out the way the ball was travelling.
          this.built.hoops.get(this.targetHoop)?.net.swish(now, rim.x - this.player.x, rim.z - this.player.z, this.lastShotPerfect ? 1.15 : 1);
          this.built.floor.ripple(rim.x, rim.z, this.lastShotPerfect ? 1.6 : 1, now);
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
    const net = this.built.hoops.get(hoop)?.net;
    if (ev.kind === "rim") net?.shake(performance.now(), ev.strength * 0.8);
    if (ev.kind === "make") {
      const a = Math.random() * Math.PI * 2;
      net?.swish(performance.now(), Math.cos(a), Math.sin(a));
      this.built.venue.crowd.cheer(performance.now(), 0.7);
      const rim = hoopLayout(hoop).rim;
      this.built.floor.ripple(rim.x, rim.z, 0.9, performance.now());
    }
  };

  private updateNet(now: number): void {
    const balls = this.ballsOnCourt;
    balls.length = 0;
    balls.push(this.ball.position);
    this.remotes?.ballPositions(balls);
    for (const hoop of this.built.hoops.values()) hoop.net.update(now, balls);
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
    // Full-screen shaders (LED floor, sky) cost per pixel: cap the pixels
    // rendered so a large desktop window costs about what a phone does.
    const budgetDpr = Math.sqrt(MAX_RENDER_PIXELS / (w * h));
    const dpr = Math.max(0.4, Math.min(this.maxDpr, budgetDpr) * this.renderScale);
    if (Math.abs(this.renderer.getPixelRatio() - dpr) > 0.01) this.renderer.setPixelRatio(dpr);
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
