// Clutch Court network protocol (CLUTCH_COURT_SPEC.md §6). Message names and
// payloads shared by the Colyseus room and the Angular client.
import { PLAYER_SPEED } from "./constants.js";
import { clampPlayerPosition } from "./geometry.js";
import type { HoopId, ShotEvent, Vec3 } from "./types.js";
import type { HorseEventKind, ShotRejectReason } from "./horse.js";

export const ROOM_NAME = "court";
/** HTTP + WebSocket path prefix the room server is mounted under. */
export const COLYSEUS_PATH = "/colyseus";
export const MAX_PLAYERS = 8;
/** Clients send moves at most this often. */
export const MOVE_HZ = 20;
/** Seconds a dropped player has to come back. */
export const RECONNECT_SECONDS = 30;
/** Room disposes this long after the last player leaves. */
export const EMPTY_DISPOSE_MS = 5 * 60 * 1000;
/** WebSocket close code: the same account joined this court from another tab or device. */
export const CLOSE_REPLACED = 4101;
/** A session must have lasted this long before a lost connection triggers an automatic rejoin. */
export const AUTO_REJOIN_MIN_SESSION_MS = 10_000;

export type CloseAction = "rejoin" | "rejoinWhenVisible" | "replaced" | "stay";

/**
 * What the client does when the room connection closes for good (the SDK's own
 * reconnection already gave up). Replaced sessions never rejoin on their own,
 * or two tabs would keep kicking each other. A session that died quickly shows
 * a Rejoin button instead, so a failing server can't cause a rejoin loop.
 */
export function closeAction(code: number, ctx: { visible: boolean; connectedMs: number }): CloseAction {
  if (code === CLOSE_REPLACED) return "replaced";
  if (ctx.connectedMs < AUTO_REJOIN_MIN_SESSION_MS) return "stay";
  return ctx.visible ? "rejoin" : "rejoinWhenVisible";
}

// Invite codes: 6 chars, uppercase, no 0/O/1/I/L.
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function isValidCourtCode(code: unknown): code is string {
  return typeof code === "string" && CODE_RE.test(code);
}

/** Normalise user input ("abc 23x" -> "ABC23X"). */
export function normalizeCourtCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** `random` returns a uniform integer in [0, n). */
export function generateCourtCode(random: (n: number) => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

/** "layup": charging a layup (the gather), "shoot": charging a jump shot. */
export type PlayerAnim = "idle" | "run" | "shoot" | "layup";
export const PLAYER_ANIMS: readonly PlayerAnim[] = ["idle", "run", "shoot", "layup"];

// ---- client -> server ----
export interface MoveMessage {
  x: number;
  z: number;
  rotY: number;
  anim: PlayerAnim;
}

/**
 * Shot request (spec §5.6 + one deviation): besides timing and hoop, the
 * client says where it shot from. The server accepts that position only if
 * it passes the same speed check as a move from its last known position,
 * else it uses its own. This lets the shooter's prediction and the server
 * simulate from the identical spot.
 */
export interface ShootMessage {
  /** Client-chosen id, echoed back so the shooter can match its prediction. */
  clientShotId: number;
  timingError: number;
  hoopId: HoopId;
  x: number;
  z: number;
  /** The client thinks this is a layup; the server checks it against its own view of the drive. */
  layup?: boolean;
}

export interface JoinOptions {
  code: string;
  accessToken: string;
}

// ---- server -> client ----
/** Sent to one client when its move was rejected; snap back to here. */
export interface CorrectionMessage {
  x: number;
  z: number;
}

export type ToastMessage = { kind: "joined" | "left" | "dropped" | "back"; name: string };

/** Private: the seed the server will use for this player's next shot (for prediction). */
export interface SeedMessage {
  seed: number;
}

/** Broadcast: an authoritative shot result. */
export interface ShotMessage {
  shotId: number;
  /** The shooter's echo of ShootMessage.clientShotId. */
  clientShotId: number;
  /** Colyseus sessionId of the shooter. */
  shooterId: string;
  hoopId: HoopId;
  made: boolean;
  perfect: boolean;
  /** Flat [x,y,z,...] in centimetres at SHOT_KEYFRAME_HZ (Int16-safe). */
  keyframes: number[];
  durationMs: number;
  events: ShotEvent[];
  spin: Vec3;
  /** The server simulated it as a layup. */
  layup: boolean;
}

/** Private: the server refused a shot (rate limit, not on court...). */
export interface ShotRejectedMessage {
  clientShotId: number;
  /** Why (H-O-R-S-E rules); absent for plain rate limiting. */
  reason?: ShotRejectReason;
}

/** Broadcast: a H-O-R-S-E game event (spec "horse:event"). */
export interface HorseEventMessage {
  kind: HorseEventKind;
  playerId: string | null;
  letters?: string;
  /** For kind "turn": time left on the new turn (phone clocks are not in sync with the server). */
  remainingMs?: number;
  /** For kind "winner": the final ranking, exactly as saved (ids are sessionIds). */
  standings?: { id: string; letters: string; placement: number }[];
}

export const MSG = {
  move: "move",
  correction: "correction",
  toast: "toast",
  /** Client asks for its next shot seed (after joining or reconnecting). */
  seedRequest: "seed?",
  seed: "seed",
  shoot: "shoot",
  shot: "shot",
  shotRejected: "shotRejected",
  horseStart: "horse:start",
  horseLeave: "horse:leave",
  horseEvent: "horse:event",
  /** Client -> server: ReactionMessage. Server -> everyone else: ReactionShownMessage. */
  react: "react",
  reacted: "reacted",
  /** Owner -> server: zero everyone's scoreboard. */
  resetScores: "scores:reset",
} as const;

// ---- Emotes and quick phrases (M5) ----
// Only ids travel; each client shows its own icon / translated phrase.
// Cocky by design: it's a pickup court. Playful trash talk, no insults.
export const EMOTE_IDS = ["shush", "flex", "cheer", "shrug", "laugh", "fire"] as const;
export const PHRASE_IDS = ["tooEasy", "cantGuard", "watchThis", "brick", "myCourt", "yourMove"] as const;
export type EmoteId = (typeof EMOTE_IDS)[number];
export type PhraseId = (typeof PHRASE_IDS)[number];
export type ReactionId = EmoteId | PhraseId;
/** Minimum gap between two reactions from one player (server-enforced). */
export const REACTION_GAP_MS = 1000;

const REACTION_SET: ReadonlySet<string> = new Set([...EMOTE_IDS, ...PHRASE_IDS]);

export function isReactionId(id: unknown): id is ReactionId {
  return typeof id === "string" && REACTION_SET.has(id);
}

export function isEmoteId(id: string): id is EmoteId {
  return (EMOTE_IDS as readonly string[]).includes(id);
}

export function reactionAllowed(lastAt: number | undefined, now: number): boolean {
  return lastAt === undefined || now - lastAt >= REACTION_GAP_MS;
}

export interface ReactionMessage {
  id: ReactionId;
}

export interface ReactionShownMessage {
  /** sessionId of the player who reacted. */
  playerId: string;
  id: ReactionId;
}

/** Speed tolerance before a move is rejected (spec §6.3: speed × 1.25). */
export const MOVE_SPEED_TOLERANCE = 1.25;
/** Slack for jitter in message arrival, metres. */
const MOVE_SLACK = 0.35;
/** Longest gap credited between two moves (a paused tab can't teleport). */
const MAX_MOVE_GAP = 0.5;

/**
 * Server-side move check. Returns the accepted position (clamped to the
 * fence), or null when the move was too fast and must be corrected.
 */
export function validateMove(
  prev: { x: number; z: number },
  next: { x: number; z: number },
  elapsedSeconds: number
): { x: number; z: number } | null {
  if (!Number.isFinite(next.x) || !Number.isFinite(next.z)) return null;
  const dt = Math.min(Math.max(elapsedSeconds, 0), MAX_MOVE_GAP);
  const allowed = PLAYER_SPEED * MOVE_SPEED_TOLERANCE * dt + MOVE_SLACK;
  if (Math.hypot(next.x - prev.x, next.z - prev.z) > allowed) return null;
  return clampPlayerPosition(next.x, next.z);
}

/** Wrap an angle into (-PI, PI]; non-finite -> 0. */
export function normalizeYaw(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}
