// Colyseus connection for a shared court (CLUTCH_COURT_SPEC.md §6). Plain TS:
// the page owns it, and it translates room state into engine calls, so the
// engine never imports the SDK. The SDK is imported dynamically so it lands
// in the lazy court chunk only.
import type { Room } from "@colyseus/sdk";
import {
  COLYSEUS_PATH,
  MSG,
  ROOM_NAME,
  type CorrectionMessage,
  type JoinOptions,
  type MoveMessage,
  type SeedMessage,
  type ShootMessage,
  type ShotMessage,
  type ShotRejectedMessage,
  type HorseEventMessage,
  type ReactionId,
  type ReactionShownMessage,
  type ToastMessage,
} from "../../../../../../shared/court/protocol";
import type { HorsePhase } from "../../../../../../shared/court/horse";

/** What the client reads from the synced CourtPlayer (see backend/src/court/state.ts). */
export interface NetPlayer {
  userId: string;
  name: string;
  teamColorPrimary: string;
  teamColorSecondary: string;
  teamCode: string;
  number: number;
  x: number;
  z: number;
  rotY: number;
  anim: string;
  connected: boolean;
  /** H-O-R-S-E progress, e.g. "HO". */
  letters: string;
  eliminated: boolean;
  /** Join order (also H-O-R-S-E turn order). */
  joinedAt: number;
}

/** Room-level H-O-R-S-E view (synced). */
export interface HorseView {
  phase: HorsePhase;
  turnId: string;
  setterId: string;
  spot: { x: number; z: number } | null;
  order: string[];
  /** Owner's userId. */
  ownerId: string;
}

interface NetState {
  players: { forEach(cb: (p: NetPlayer, sessionId: string) => void): void; get(id: string): NetPlayer | undefined; size: number };
  ownerId: string;
  courtColor: string;
  courtLogoUrl: string;
  phase: string;
  turnId: string;
  setterId: string;
  spotX: number;
  spotZ: number;
  spotHoop: string;
  turnOrder: { forEach(cb: (id: string) => void): void };
}

export interface CourtNetHandlers {
  /** Every state patch (~20 Hz). */
  onState(players: Map<string, NetPlayer>, view: HorseView): void;
  onHorseEvent(msg: HorseEventMessage): void;
  /** Another player's emote or quick phrase. */
  onReaction(msg: ReactionShownMessage): void;
  onToast(msg: ToastMessage): void;
  onCorrection(msg: CorrectionMessage): void;
  /** Any player's authoritative shot (ours included). */
  onShot(msg: ShotMessage): void;
  onShotRejected(msg: ShotRejectedMessage): void;
  /** Connection lost; the SDK is retrying. */
  onDrop(): void;
  onReconnect(): void;
  /** Left for good (not by us). */
  onClosed(code: number): void;
}

export interface CourtWelcome {
  sessionId: string;
  me: NetPlayer;
  ownerId: string;
  courtColor: string;
  courtLogoUrl: string;
}

export type JoinFailure = "notFound" | "closed" | "full" | "auth" | "network";

export class CourtJoinError extends Error {
  constructor(readonly reason: JoinFailure, message: string) {
    super(message);
  }
}

function classify(err: unknown): JoinFailure {
  const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
  if (msg.includes("not found") || msg.includes("invalid court")) return "notFound";
  if (msg.includes("closed")) return "closed";
  if (msg.includes("full") || msg.includes("locked")) return "full";
  if (msg.includes("expired") || msg.includes("signed in") || msg.includes("user not found")) return "auth";
  return "network";
}

export class CourtNet {
  private room: Room | null = null;
  private left = false;
  private seed: number | null = null;
  /** True between onDrop and onReconnect: nothing is sent (the SDK would replay stale moves). */
  private dropped = false;
  private joinedAt = 0;

  constructor(private readonly handlers: CourtNetHandlers) {}

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  /** How long the current session has been joined (0 before joining). */
  connectedMs(): number {
    return this.joinedAt ? Date.now() - this.joinedAt : 0;
  }

  /** Join the court and resolve with the first full state. */
  async join(code: string, accessToken: string): Promise<CourtWelcome> {
    const { Client } = await import("@colyseus/sdk");
    const endpoint = `${location.protocol}//${location.host}${COLYSEUS_PATH}`;
    const client = new Client(endpoint);
    let room: Room;
    try {
      room = await client.joinOrCreate(ROOM_NAME, { code, accessToken } satisfies JoinOptions);
    } catch (err) {
      throw new CourtJoinError(classify(err), String((err as { message?: string })?.message ?? err));
    }
    this.room = room;
    this.joinedAt = Date.now();
    // Keep retrying for as long as the server holds the seat (RECONNECT_SECONDS):
    // the backoff (0.2 s doubling, capped at 5 s) adds up to ~31 s over 10 tries.
    // Then onLeave fires and the page rejoins fresh, which also covers a
    // server restart (the old room no longer exists to reconnect to).
    room.reconnection.maxRetries = 10;
    room.reconnection.minUptime = 1000;

    room.onMessage(MSG.toast, (m: ToastMessage) => this.handlers.onToast(m));
    room.onMessage(MSG.correction, (m: CorrectionMessage) => this.handlers.onCorrection(m));
    room.onMessage(MSG.seed, (m: SeedMessage) => (this.seed = m.seed));
    room.onMessage(MSG.shot, (m: ShotMessage) => this.handlers.onShot(m));
    room.onMessage(MSG.shotRejected, (m: ShotRejectedMessage) => this.handlers.onShotRejected(m));
    room.onMessage(MSG.horseEvent, (m: HorseEventMessage) => this.handlers.onHorseEvent(m));
    room.onMessage(MSG.reacted, (m: ReactionShownMessage) => this.handlers.onReaction(m));
    room.onDrop(() => {
      this.seed = null;
      this.dropped = true;
      this.handlers.onDrop();
    });
    room.onReconnect(() => {
      this.dropped = false;
      room.send(MSG.seedRequest);
      this.handlers.onReconnect();
    });
    // Handlers are registered: now ask for our first shot seed.
    room.send(MSG.seedRequest);
    room.onLeave((code: number) => {
      if (!this.left) this.handlers.onClosed(code);
    });

    const first = await new Promise<NetState>((resolve) => {
      const state = room.state as NetState | undefined;
      if (state && state.players?.size) resolve(state);
      else room.onStateChange.once((s) => resolve(s as NetState));
    });
    room.onStateChange((s) => this.handlers.onState(this.snapshot(s as NetState), this.view(s as NetState)));

    const me = first.players.get(room.sessionId);
    if (!me) throw new CourtJoinError("network", "joined without a player");
    return {
      sessionId: room.sessionId,
      me: { ...me },
      ownerId: first.ownerId,
      courtColor: first.courtColor,
      courtLogoUrl: first.courtLogoUrl,
    };
  }

  sendMove(m: MoveMessage): void {
    this.live()?.send(MSG.move, m);
  }

  /** The seed for our next shot (consumed; the server sends the following one with the result). */
  takeSeed(): number | null {
    const s = this.seed;
    this.seed = null;
    return s;
  }

  sendShoot(m: ShootMessage): void {
    this.live()?.send(MSG.shoot, m);
  }

  leave(): void {
    this.left = true;
    const room = this.room;
    this.room = null;
    if (room) void room.leave(true).catch(() => {});
  }

  startHorse(): void {
    this.live()?.send(MSG.horseStart);
  }

  sendReaction(id: ReactionId): void {
    this.live()?.send(MSG.react, { id });
  }

  leaveHorse(): void {
    this.live()?.send(MSG.horseLeave);
  }

  /** The room, unless the connection is down. */
  private live(): Room | null {
    return this.dropped ? null : this.room;
  }

  private view(state: NetState): HorseView {
    const order: string[] = [];
    state.turnOrder?.forEach((id) => order.push(id));
    const phase = (["free", "setting", "matching", "over"] as const).find((p) => p === state.phase) ?? "free";
    return {
      phase,
      turnId: state.turnId ?? "",
      setterId: state.setterId ?? "",
      spot: state.spotHoop ? { x: state.spotX, z: state.spotZ } : null,
      order,
      ownerId: state.ownerId,
    };
  }

  private snapshot(state: NetState): Map<string, NetPlayer> {
    const out = new Map<string, NetPlayer>();
    state.players.forEach((p, id) => out.set(id, p));
    return out;
  }
}
