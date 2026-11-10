import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, effect, inject, signal, untracked } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { firstValueFrom, of, catchError, timeout } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Game, Team } from "../../core/models";
import { EventsService, GameUpdate } from "../../core/events.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { ThemeService } from "../../core/theme.service";
import { cdnImage } from "../../shared/cdn-image";
import { stashPendingCourtJoin } from "../../shared/pending-court-join";
import { displayTeamCode } from "../../shared/team-display-codes";
import { jerseyNumber, kitColors } from "../../../../../shared/court/kit";
import {
  MAX_PLAYERS,
  EMOTE_IDS,
  PHRASE_IDS,
  RECONNECT_SECONDS,
  closeAction,
  isEmoteId,
  isReactionId,
  reactionAllowed,
  type ReactionId,
  isValidCourtCode,
  normalizeCourtCode,
  type ToastMessage,
} from "../../../../../shared/court/protocol";
import { JerseyText } from "./engine/avatar-factory";
import { EngineCallbacks, EngineOptions, GameEngine, PerfStats, PracticeStats, ReleaseGrade } from "./engine/game-engine";
import { CourtJoinError, CourtNet, HorseView, JoinFailure, NetPlayer } from "./net/court-net";
import { EMOTE_ICONS } from "./engine/reaction-bubbles";
import type { JumbotronContent } from "./engine/venue";
import { HorseHudComponent, HorseHudPlayer, HorseWinner } from "./hud/horse-hud";
import { HORSE_RETURN_MS, canStart, shotGate } from "../../../../../shared/court/horse";
import type { HorseEventMessage } from "../../../../../shared/court/protocol";

const PREFS_KEY = "court.prefs";
const BEST_KEY = "court.practice.best";

interface Prefs {
  camera: number;
  muted: boolean;
}

type LoadState = "loading" | "ready" | "error" | "contextLost" | JoinFailure | "disconnected" | "replaced";

interface Flash {
  id: number;
  text: string;
  tone: "perfect" | "good" | "bad" | "make" | "fire";
}

interface Notice {
  id: number;
  text: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

/**
 * Clutch Court. /court/practice: single player, local physics.
 * /court/:code: a shared court (Colyseus room) joined by invite link.
 */
@Component({
  selector: "app-court-page",
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, HorseHudComponent],
  templateUrl: "./court-page.html",
  styleUrl: "./court-page.css",
})
export class CourtPageComponent implements OnInit, OnDestroy {
  protected i18n = inject(I18nService);
  private zone = inject(NgZone);
  private navHistory = inject(NavHistoryService);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  @ViewChild("host", { static: true }) private host!: ElementRef<HTMLElement>;
  @ViewChild("meter", { static: true }) private meter!: ElementRef<HTMLElement>;
  @ViewChild("meterFill", { static: true }) private meterFill!: ElementRef<HTMLElement>;
  @ViewChild("joystickZone", { static: true }) private joystickZone!: ElementRef<HTMLElement>;

  /** Invite code for a shared court; null in practice mode. */
  protected readonly code: string | null = this.readCode();
  protected readonly maxPlayers = MAX_PLAYERS;
  protected readonly backUrl = this.navHistory.previousUrlOutside("/court/") ?? "/court";
  protected readonly touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  protected readonly state = signal<LoadState>("loading");
  protected readonly stats = signal<PracticeStats>({ makes: 0, attempts: 0, streak: 0, best: 0 });
  protected readonly flash = signal<Flash | null>(null);
  protected readonly prefs = signal<Prefs>(readJson<Prefs>(PREFS_KEY, { camera: 0, muted: false }));
  protected readonly playerCount = signal(1);
  protected readonly reconnecting = signal(false);
  /** Seconds left of the server's seat hold while reconnecting (null when connected). */
  protected readonly holdSeconds = signal<number | null>(null);
  /** The browser reports no network (shown before the socket notices). */
  protected readonly offline = signal(typeof navigator !== "undefined" && navigator.onLine === false);
  /** The loading screen is an automatic rejoin, not a first join. */
  protected readonly rejoining = signal(false);
  private holdTimer: ReturnType<typeof setInterval> | null = null;
  // ---- emotes and quick phrases ----
  protected readonly reactOpen = signal(false);
  protected readonly emotes = EMOTE_IDS.map((id) => ({ id, icon: EMOTE_ICONS[id] }));
  protected readonly phrases = PHRASE_IDS;
  private lastReactAt: number | undefined;

  /** ?perf=1: live fps / draw calls overlay for checking a phone against the spec's budget. */
  protected readonly perfOn = this.route.snapshot.queryParamMap.get("perf") === "1";
  protected readonly perf = signal<PerfStats | null>(null);
  private perfTimer: ReturnType<typeof setInterval> | null = null;
  /** Lost the court while in the background: rejoin when the page is visible again. */
  private rejoinOnVisible = false;
  protected readonly notices = signal<Notice[]>([]);
  protected readonly inviteOpen = signal(false);
  protected readonly copied = signal(false);
  protected readonly canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // ---- H-O-R-S-E (shared courts only) ----
  protected readonly horseView = signal<HorseView>({ phase: "free", turnId: "", setterId: "", spot: null, order: [], ownerId: "" });
  protected readonly horsePlayers = signal<HorseHudPlayer[]>([]);
  protected readonly turnEndsAt = signal<number | null>(null);
  protected readonly horseWinner = signal<HorseWinner | null>(null);
  protected readonly isStarter = signal(false);
  protected readonly canStartHorse = signal(false);
  protected readonly horseConfirm = signal(false);
  protected readonly mySessionId = signal("");
  /** sessionId -> name, kept after a player leaves so the scoreboard and winner screen can still name them. */
  private readonly names = new Map<string, string>();
  /** Last known letters per sessionId (players who left are no longer in the synced state). */
  private readonly lastLetters = new Map<string, string>();
  private hudKey = "";
  private gateKey = "";
  private winnerTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- jumbotron: the court owner's club's live / next / last game ----
  private events = inject(EventsService);
  /** Every game of the court's club this season (null until loaded or when there's no club). */
  private jumboGames: Game[] | null = null;
  /** Live scores push straight onto the big screen. */
  private readonly jumboLive = effect(() => {
    const u = this.events.lastGameUpdate();
    if (u) untracked(() => this.onGameUpdate(u));
  });

  private engine: GameEngine | null = null;
  private net: CourtNet | null = null;
  private destroyed = false;
  private flashId = 0;
  private noticeId = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (this.perfOn) this.perfTimer = setInterval(() => this.perf.set(this.engine?.perfStats() ?? null), 500);
    void this.boot();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.perfTimer) clearInterval(this.perfTimer);
    if (this.winnerTimer) clearTimeout(this.winnerTimer);
    this.teardown();
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }

  protected get inviteUrl(): string {
    return `${location.origin}/court/${this.code ?? ""}`;
  }

  protected fgPct(s: PracticeStats): string {
    return s.attempts ? `${Math.round((100 * s.makes) / s.attempts)}%` : "–";
  }

  protected shootDown(e: PointerEvent): void {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.engine?.pressShoot();
  }

  protected shootUp(e: PointerEvent): void {
    e.preventDefault();
    this.engine?.releaseShoot();
  }

  protected cycleCamera(): void {
    const camera = this.engine?.cycleCamera() ?? 0;
    this.savePrefs({ ...this.prefs(), camera });
  }

  protected toggleMute(): void {
    const muted = !this.prefs().muted;
    this.engine?.setMuted(muted);
    this.savePrefs({ ...this.prefs(), muted });
  }

  protected restart(): void {
    this.rejoinOnVisible = false;
    this.teardown();
    void this.boot();
  }

  // ---- jumbotron ----

  private async loadJumbotron(teamId: string): Promise<void> {
    this.jumboGames = null;
    this.refreshJumbotron();
    if (!teamId) return;
    const games = await firstValueFrom(this.api.getTeamGames(teamId).pipe(timeout(8000), catchError(() => of(null))));
    if (this.destroyed || !games) return;
    this.jumboGames = games;
    this.refreshJumbotron();
  }

  private onGameUpdate(u: GameUpdate): void {
    const g = this.jumboGames?.find((x) => x.id === u.gameId);
    if (!g) return;
    g.homeScore = u.homeScore;
    g.awayScore = u.awayScore;
    g.status = u.status;
    g.quarter = u.quarter ?? g.quarter;
    g.gameClockSeconds = u.gameClockSeconds ?? g.gameClockSeconds;
    this.refreshJumbotron();
  }

  /** Live game > a final from the last 18 h > the next game > the last final. */
  private featuredGame(): Game | null {
    const games = this.jumboGames;
    if (!games?.length) return null;
    const now = Date.now();
    const at = (g: Game) => Date.parse(g.tipoffAt);
    const finals = games.filter((g) => g.status === "final").sort((a, b) => at(b) - at(a));
    return (
      games.find((g) => g.status === "live") ??
      finals.find((g) => now - at(g) < 18 * 3600_000) ??
      games.filter((g) => g.status !== "final" && at(g) > now - 3 * 3600_000).sort((a, b) => at(a) - at(b))[0] ??
      finals[0] ??
      null
    );
  }

  private refreshJumbotron(): void {
    this.engine?.setJumbotron(this.jumbotronContent());
  }

  private jumbotronContent(): JumbotronContent {
    const view = this.horseView();
    if (this.code && (view.phase === "setting" || view.phase === "matching")) {
      return {
        kind: "horse",
        title: "H-O-R-S-E",
        rows: this.horsePlayers().map((p) => ({ name: p.name, letters: p.letters, turn: p.isTurn, out: p.eliminated })),
      };
    }
    const g = this.featuredGame();
    if (!g) return { kind: "team" };
    const chip = (t: Game["homeTeam"]) => ({ code: displayTeamCode(t.code), color: t.primaryColor || "#2a3445" });
    const live = g.status === "live";
    const final = g.status === "final";
    const locale = this.i18n.lang() === "el" ? "el-GR" : "en-GB";
    const when = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(g.tipoffAt)
    );
    let sub = when;
    if (live) {
      const q = g.quarter ?? 0;
      const period = q > 4 ? this.i18n.t("court.jumbo.ot") : q > 0 ? this.i18n.t("court.jumbo.quarter").replace("{q}", String(q)) : "";
      const secs = g.gameClockSeconds;
      const clock = secs === null || secs === undefined ? "" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      sub = [period, clock].filter(Boolean).join(" · ") || this.i18n.t("court.jumbo.live");
    }
    return {
      kind: "game",
      label: this.i18n.t(live ? "court.jumbo.live" : final ? "court.jumbo.final" : "court.jumbo.next"),
      live,
      home: chip(g.homeTeam),
      away: chip(g.awayTeam),
      homeScore: live || final ? g.homeScore : null,
      awayScore: live || final ? g.awayScore : null,
      sub,
    };
  }

  // ---- emotes and quick phrases (M5) ----

  protected react(id: ReactionId): void {
    this.reactOpen.set(false);
    // Same gap the server enforces, so we never show one the others won't see.
    const now = Date.now();
    if (!this.engine || !reactionAllowed(this.lastReactAt, now)) return;
    this.lastReactAt = now;
    this.engine.react(id, this.reactionText(id), null);
    this.net?.sendReaction(id);
  }

  private reactionText(id: ReactionId): string {
    return isEmoteId(id) ? EMOTE_ICONS[id] : this.i18n.t(`court.phrase.${id}`);
  }

  // ---- connection loss (M5 reconnection UX) ----

  private onOnline = () => this.offline.set(false);
  private onOffline = () => this.offline.set(true);

  private onVisibility = () => {
    if (document.visibilityState !== "visible" || !this.rejoinOnVisible) return;
    this.rejoinOnVisible = false;
    if (this.state() === "disconnected") this.autoRejoin();
  };

  private autoRejoin(): void {
    this.rejoining.set(true);
    this.restart();
  }

  private onDropped(): void {
    // The SDK fires onDrop again for every failed retry: only the first one starts the countdown.
    if (this.reconnecting()) return;
    this.reconnecting.set(true);
    this.engine?.setFrozen(true);
    const until = Date.now() + RECONNECT_SECONDS * 1000;
    const tick = () => this.holdSeconds.set(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    this.stopHoldTimer();
    this.holdTimer = setInterval(tick, 500);
  }

  private onReconnected(): void {
    this.stopHoldTimer();
    this.reconnecting.set(false);
    this.engine?.setFrozen(false);
  }

  private onConnectionClosed(code: number, net: CourtNet): void {
    this.stopHoldTimer();
    this.reconnecting.set(false);
    this.engine?.setMoveSink(null);
    this.engine?.setFrozen(true);
    const action = closeAction(code, { visible: document.visibilityState === "visible", connectedMs: net.connectedMs() });
    if (action === "replaced") return this.state.set("replaced");
    this.state.set("disconnected");
    if (action === "rejoin") this.autoRejoin();
    else if (action === "rejoinWhenVisible") this.rejoinOnVisible = true;
  }

  private stopHoldTimer(): void {
    if (this.holdTimer) clearInterval(this.holdTimer);
    this.holdTimer = null;
    this.holdSeconds.set(null);
  }

  protected async share(): Promise<void> {
    try {
      await navigator.share({ title: this.i18n.t("court.invite.shareTitle"), text: this.i18n.t("court.invite.shareText"), url: this.inviteUrl });
    } catch {
      /* dismissed */
    }
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteUrl);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* clipboard blocked: the link is still shown for manual copying */
    }
  }

  protected confirmHorse(): void {
    this.horseConfirm.set(false);
    if (this.canStartHorse()) this.net?.startHorse();
  }

  protected forfeitHorse(): void {
    this.net?.leaveHorse();
  }

  private readCode(): string | null {
    const raw = this.route.snapshot.paramMap.get("code");
    if (!raw) return null;
    const code = normalizeCourtCode(raw);
    return isValidCourtCode(code) ? code : "";
  }

  private savePrefs(p: Prefs): void {
    this.prefs.set(p);
    writeStorage(PREFS_KEY, JSON.stringify(p));
  }

  private teamColors(): { primary: string; secondary: string } {
    const css = getComputedStyle(document.documentElement);
    const primary = css.getPropertyValue("--accent-primary").trim() || "#FF6B35";
    const secondary = css.getPropertyValue("--accent-secondary").trim() || "#0B1220";
    return { primary, secondary };
  }

  private engineCallbacks(bestStored: number): EngineCallbacks {
    return {
      onStats: (s) => {
        if (s.best > this.stats().best && s.best > bestStored) writeStorage(BEST_KEY, JSON.stringify({ best: s.best }));
        this.stats.set(s);
      },
      onRelease: (grade, layup) => this.showRelease(grade, layup),
      onShotResult: (made, streak) => {
        if (!made) return;
        if (streak >= 3) this.showFlash(this.i18n.t("court.onFire").replace("{n}", String(streak)), "fire");
        else this.showFlash(this.i18n.t("court.bucket"), "make");
      },
      onContextLost: () => this.state.set("contextLost"),
      onContextRestored: () => this.restart(),
      onShotBlocked: (reason) => this.showFlash(this.i18n.t(`court.horse.block.${reason}`), "bad"),
    };
  }

  private async boot(): Promise<void> {
    this.state.set("loading");
    try {
      if (this.code === null) await this.bootPractice();
      else await this.bootShared(this.code);
    } finally {
      this.rejoining.set(false);
    }
  }

  private async bootPractice(): Promise<void> {
    const team = await this.favoriteTeam();
    if (this.destroyed) return;
    // Reskin like the dashboard does, so a direct /court link gets team colours too.
    if (team && !this.theme.favoriteTeam()) this.theme.applyTeam(team);
    const { primary, secondary } = this.teamColors();
    const user = this.auth.currentUser();
    const best = Number(readJson<{ best: number }>(BEST_KEY, { best: 0 }).best) || 0;
    await this.startEngine(this.engineCallbacks(best), {
      courtColor: primary,
      kitPrimary: primary,
      kitSecondary: secondary,
      bestStreak: best,
      jersey: { name: user?.username ?? "", number: user ? jerseyNumber(user.id) : 7, chest: team ? displayTeamCode(team.code) : "" },
      logoUrl: team?.logoUrl ? cdnImage(team.logoUrl, 240).src : null,
      courtTeam: team ? { name: team.name, code: displayTeamCode(team.code), secondary } : null,
    });
    void this.loadJumbotron(team?.id ?? "");
  }

  private async bootShared(code: string): Promise<void> {
    if (!code) {
      this.state.set("notFound");
      return;
    }
    // Signed in? Otherwise park the invite and go through sign-up/login.
    const loggedIn = await firstValueFrom(this.auth.restoreSession().pipe(timeout(8000), catchError(() => of(false))));
    if (this.destroyed) return;
    if (!loggedIn && !this.auth.isAuthenticated()) {
      stashPendingCourtJoin(code);
      void this.router.navigateByUrl("/welcome");
      return;
    }

    const info = await firstValueFrom(this.api.getCourt(code).pipe(timeout(8000), catchError(() => of(null))));
    if (this.destroyed) return;
    if (!info) return this.state.set("network");
    if (!info.exists) return this.state.set("notFound");
    if (!info.active) return this.state.set("closed");
    if ((info.playerCount ?? 0) >= MAX_PLAYERS) return this.state.set("full");

    // A fresh access token for the room's onAuth (spec §6.1).
    const token = await firstValueFrom(this.auth.refreshAccessToken().pipe(timeout(8000), catchError(() => of(null))));
    if (this.destroyed) return;
    if (!token) return this.state.set("auth");

    const net = new CourtNet({
      onState: (players, view) => {
        this.syncPlayers(players);
        this.syncHorse(players, view);
      },
      onToast: (m) => this.showNotice(m),
      onCorrection: (m) => this.engine?.applyCorrection(m.x, m.z),
      onShot: (m) => this.engine?.onServerShot(m, net.sessionId),
      onShotRejected: (m) => this.engine?.onShotRejected(m.clientShotId, m.reason),
      onHorseEvent: (m) => this.onHorseEvent(m),
      onReaction: (m) => {
        if (isReactionId(m.id)) this.engine?.react(m.id, this.reactionText(m.id), m.playerId);
      },
      onDrop: () => this.onDropped(),
      onReconnect: () => this.onReconnected(),
      onClosed: (code) => this.onConnectionClosed(code, net),
    });
    this.net = net;
    let welcome;
    try {
      welcome = await this.zone.runOutsideAngular(() => net.join(code, token));
    } catch (err) {
      console.error("[court] join failed", err);
      if (this.net === net) this.state.set(err instanceof CourtJoinError ? err.reason : "network");
      return;
    }
    if (this.destroyed || this.net !== net) {
      net.leave();
      return;
    }

    const me = welcome.me;
    const kit = kitColors(me.teamColorPrimary, me.teamColorSecondary);
    await this.startEngine(this.engineCallbacks(Number.MAX_SAFE_INTEGER), {
      courtColor: welcome.courtColor || kit.primary,
      kitPrimary: kit.primary,
      kitSecondary: kit.secondary,
      start: { x: me.x, z: me.z, rotY: me.rotY },
      bestStreak: 0,
      jersey: { name: me.name, number: me.number, chest: displayTeamCode(me.teamCode) },
      logoUrl: welcome.courtLogoUrl ? cdnImage(welcome.courtLogoUrl, 240).src : null,
      courtTeam: welcome.courtTeam.id
        ? { name: welcome.courtTeam.name, code: displayTeamCode(welcome.courtTeam.teamCode), secondary: welcome.courtTeam.secondary || "#0b1220" }
        : null,
    });
    void this.loadJumbotron(welcome.courtTeam.id);
    this.engine?.setMoveSink((m) => net.sendMove(m));
    this.engine?.setShotNet({ takeSeed: () => net.takeSeed(), send: (m) => net.sendShoot(m) });
  }

  private async startEngine(
    callbacks: EngineCallbacks,
    opts: Omit<EngineOptions, "cameraPreset" | "muted">
  ): Promise<void> {
    const engine = new GameEngine(
      {
        container: this.host.nativeElement,
        meter: this.meter.nativeElement,
        meterFill: this.meterFill.nativeElement,
        joystickZone: this.touch ? this.joystickZone.nativeElement : null,
      },
      callbacks,
      { ...opts, cameraPreset: this.prefs().camera, muted: this.prefs().muted }
    );
    this.engine = engine;
    try {
      await this.zone.runOutsideAngular(() => engine.start());
      if (this.engine === engine) {
        this.state.set("ready");
        this.refreshJumbotron();
      }
    } catch (err) {
      console.error("[court] engine failed to start", err);
      if (this.engine === engine) this.state.set("error");
    }
  }

  /** Room state -> remote avatars. Runs ~20x a second, outside Angular. */
  private syncPlayers(players: Map<string, NetPlayer>): void {
    const engine = this.engine;
    const me = this.net?.sessionId;
    let connected = 0;
    players.forEach((p) => {
      if (p.connected) connected++;
    });
    if (connected !== this.playerCount()) this.playerCount.set(connected);
    if (!engine) return;
    players.forEach((p, id) => {
      if (id === me) return;
      if (!engine.hasRemote(id)) {
        const kit = kitColors(p.teamColorPrimary, p.teamColorSecondary);
        const jersey: JerseyText = { name: p.name, number: p.number, chest: displayTeamCode(p.teamCode) };
        engine.addRemote(id, { name: p.name, primary: kit.primary, secondary: kit.secondary, jersey }, p.x, p.z, p.rotY);
      }
      engine.pushRemote(id, p.x, p.z, p.rotY, p.anim);
      engine.setRemoteConnected(id, p.connected);
    });
    for (const id of engine.remoteIds()) {
      if (!players.has(id)) engine.removeRemote(id);
    }
  }

  /** Room state -> H-O-R-S-E HUD and engine gate. Signals only change when the derived values do. */
  private syncHorse(players: Map<string, NetPlayer>, view: HorseView): void {
    const me = this.net?.sessionId ?? "";
    players.forEach((p, id) => {
      this.names.set(id, p.name);
      if (view.order.includes(id)) this.lastLetters.set(id, p.letters);
    });

    // Who may press Start: the owner if present, else the earliest-joined connected player.
    const starters = [...players.entries()].map(([id, p]) => ({ id, joinOrder: p.joinedAt, connected: p.connected }));
    const ownerSession = [...players.entries()].find(([, p]) => p.userId === view.ownerId && p.connected)?.[0] ?? "";
    const eligible = canStart([...starters, { id: "__probe__", joinOrder: Number.MAX_SAFE_INTEGER, connected: true }], ownerSession, me);
    const ready = view.phase === "free" && canStart(starters, ownerSession, me);

    const hud: HorseHudPlayer[] = view.order.map((id) => {
      const p = players.get(id);
      return {
        id,
        name: p?.name ?? this.names.get(id) ?? "?",
        letters: p?.letters ?? this.lastLetters.get(id) ?? "",
        eliminated: p ? p.eliminated : true,
        connected: p?.connected ?? false,
        isTurn: id === view.turnId,
        isMe: id === me,
      };
    });
    const key = JSON.stringify([view.phase, view.turnId, view.setterId, view.spot, view.order, hud, eligible, ready, me]);
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.horseView.set(view);
      this.horsePlayers.set(hud);
      this.refreshJumbotron();
      this.isStarter.set(eligible && view.phase === "free");
      this.canStartHorse.set(ready);
      this.mySessionId.set(me);
      if (view.phase === "free" || view.phase === "over") this.turnEndsAt.set(null);
    }

    // Engine: gate our own shots and show the ring while matching.
    const gateKey = JSON.stringify([view.phase, view.turnId, view.spot]);
    if (gateKey !== this.gateKey && this.engine) {
      this.gateKey = gateKey;
      const inGame = view.phase === "setting" || view.phase === "matching";
      this.engine.setShotGate(inGame ? (x, z) => shotGate({ phase: view.phase, turnId: view.turnId, spot: view.spot, resolving: false }, me, x, z) : null);
      this.engine.setSpotRing(view.phase === "matching" ? view.spot : null);
    }
  }

  private onHorseEvent(m: HorseEventMessage): void {
    const name = (m.playerId && this.names.get(m.playerId)) || "";
    switch (m.kind) {
      case "turn":
        if (m.remainingMs !== undefined) this.turnEndsAt.set(performance.now() + m.remainingMs);
        break;
      case "letter":
        this.showFlash(`${name}: ${(m.letters ?? "").slice(-1)}!`, "bad");
        break;
      case "eliminated":
        this.showFlash(this.i18n.t("court.horse.eliminated").replace("{name}", name), "bad");
        break;
      case "winner": {
        // The server's ranking, exactly as saved (the state patch with the
        // final letters may still be on its way, so don't rebuild it here).
        const standings = (m.standings ?? []).map((st) => ({ name: this.names.get(st.id) ?? "?", letters: st.letters, placement: st.placement }));
        this.horseWinner.set({ name, standings });
        this.showFlash(this.i18n.t("court.horse.wins").replace("{name}", name), "fire");
        this.engine?.cheer(2);
        if (this.winnerTimer) clearTimeout(this.winnerTimer);
        this.winnerTimer = setTimeout(() => this.horseWinner.set(null), HORSE_RETURN_MS);
        break;
      }
    }
  }

  /** The signed-in user's club (null for guests or no pick). Never throws. */
  private async favoriteTeam(): Promise<Team | null> {
    const themed = this.theme.favoriteTeam();
    if (themed) return themed;
    await firstValueFrom(this.auth.restoreSession().pipe(timeout(6000), catchError(() => of(false))));
    const teamId = this.auth.currentUser()?.favoriteTeamId;
    if (!teamId) return null;
    const teams = await firstValueFrom(this.api.getTeams().pipe(timeout(6000), catchError(() => of([] as Team[]))));
    return teams.find((t) => t.id === teamId) ?? null;
  }

  private teardown(): void {
    this.net?.leave();
    this.net = null;
    this.engine?.dispose();
    this.engine = null;
    this.reactOpen.set(false);
    this.stopHoldTimer();
    this.reconnecting.set(false);
  }

  private showRelease(grade: ReleaseGrade, layup = false): void {
    const map: Record<ReleaseGrade, Flash["tone"]> = { perfect: "perfect", good: "good", early: "bad", late: "bad" };
    // A well-timed layup says so; a mistimed one still says early / late.
    const key = layup && (grade === "perfect" || grade === "good") ? `court.release.layup.${grade}` : `court.release.${grade}`;
    this.showFlash(this.i18n.t(key), map[grade]);
  }

  private showFlash(text: string, tone: Flash["tone"]): void {
    const id = ++this.flashId;
    this.flash.set({ id, text, tone });
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      if (this.flash()?.id === id) this.flash.set(null);
    }, 1100);
  }

  private showNotice(m: ToastMessage): void {
    const id = ++this.noticeId;
    const text = this.i18n.t(`court.toast.${m.kind}`).replace("{name}", m.name);
    this.notices.update((list) => [...list.slice(-2), { id, text }]);
    setTimeout(() => this.notices.update((list) => list.filter((n) => n.id !== id)), 3500);
  }
}
