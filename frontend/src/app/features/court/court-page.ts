import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject, signal } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { firstValueFrom, of, catchError, timeout } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Team } from "../../core/models";
import { NavHistoryService } from "../../core/nav-history.service";
import { ThemeService } from "../../core/theme.service";
import { cdnImage } from "../../shared/cdn-image";
import { stashPendingCourtJoin } from "../../shared/pending-court-join";
import { displayTeamCode } from "../../shared/team-display-codes";
import { jerseyNumber, kitColors } from "../../../../../shared/court/kit";
import { MAX_PLAYERS, isValidCourtCode, normalizeCourtCode, type ToastMessage } from "../../../../../shared/court/protocol";
import { JerseyText } from "./engine/avatar-factory";
import { EngineCallbacks, EngineOptions, GameEngine, PracticeStats, ReleaseGrade } from "./engine/game-engine";
import { CourtJoinError, CourtNet, JoinFailure, NetPlayer } from "./net/court-net";

const PREFS_KEY = "court.prefs";
const BEST_KEY = "court.practice.best";

interface Prefs {
  camera: number;
  muted: boolean;
}

type LoadState = "loading" | "ready" | "error" | "contextLost" | JoinFailure | "disconnected";

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
  imports: [RouterLink, NgTemplateOutlet],
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
  protected readonly notices = signal<Notice[]>([]);
  protected readonly inviteOpen = signal(false);
  protected readonly copied = signal(false);
  protected readonly canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  private engine: GameEngine | null = null;
  private net: CourtNet | null = null;
  private destroyed = false;
  private flashId = 0;
  private noticeId = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.boot();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
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
    this.teardown();
    void this.boot();
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
      onRelease: (grade) => this.showRelease(grade),
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
    if (this.code === null) await this.bootPractice();
    else await this.bootShared(this.code);
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
    });
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
      onState: (players) => this.syncPlayers(players),
      onToast: (m) => this.showNotice(m),
      onCorrection: (m) => this.engine?.applyCorrection(m.x, m.z),
      onShot: (m) => this.engine?.onServerShot(m, net.sessionId),
      onShotRejected: (m) => this.engine?.onShotRejected(m.clientShotId, m.reason),
      onHorseEvent: () => {},
      onDrop: () => this.reconnecting.set(true),
      onReconnect: () => this.reconnecting.set(false),
      onClosed: () => {
        this.reconnecting.set(false);
        this.engine?.setMoveSink(null);
        this.state.set("disconnected");
      },
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
    });
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
      if (this.engine === engine) this.state.set("ready");
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
    this.reconnecting.set(false);
  }

  private showRelease(grade: ReleaseGrade): void {
    const map: Record<ReleaseGrade, Flash["tone"]> = { perfect: "perfect", good: "good", early: "bad", late: "bad" };
    this.showFlash(this.i18n.t(`court.release.${grade}`), map[grade]);
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
