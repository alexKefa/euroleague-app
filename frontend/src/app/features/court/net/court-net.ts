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
  type ToastMessage,
} from "../../../../../../shared/court/protocol";

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
}

interface NetState {
  players: { forEach(cb: (p: NetPlayer, sessionId: string) => void): void; get(id: string): NetPlayer | undefined; size: number };
  ownerId: string;
  courtColor: string;
  courtLogoUrl: string;
}

export interface CourtNetHandlers {
  /** Every state patch (~20 Hz). */
  onState(players: Map<string, NetPlayer>): void;
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

  constructor(private readonly handlers: CourtNetHandlers) {}

  get sessionId(): string {
    return this.room?.sessionId ?? "";
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

    room.onMessage(MSG.toast, (m: ToastMessage) => this.handlers.onToast(m));
    room.onMessage(MSG.correction, (m: CorrectionMessage) => this.handlers.onCorrection(m));
    room.onMessage(MSG.seed, (m: SeedMessage) => (this.seed = m.seed));
    room.onMessage(MSG.shot, (m: ShotMessage) => this.handlers.onShot(m));
    room.onMessage(MSG.shotRejected, (m: ShotRejectedMessage) => this.handlers.onShotRejected(m));
    room.onDrop(() => {
      this.seed = null;
      this.handlers.onDrop();
    });
    room.onReconnect(() => {
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
    room.onStateChange((s) => this.handlers.onState(this.snapshot(s as NetState)));

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
    this.room?.send(MSG.move, m);
  }

  /** The seed for our next shot (consumed; the server sends the following one with the result). */
  takeSeed(): number | null {
    const s = this.seed;
    this.seed = null;
    return s;
  }

  sendShoot(m: ShootMessage): void {
    this.room?.send(MSG.shoot, m);
  }

  leave(): void {
    this.left = true;
    const room = this.room;
    this.room = null;
    if (room) void room.leave(true).catch(() => {});
  }

  private snapshot(state: NetState): Map<string, NetPlayer> {
    const out = new Map<string, NetPlayer>();
    state.players.forEach((p, id) => out.set(id, p));
    return out;
  }
}
