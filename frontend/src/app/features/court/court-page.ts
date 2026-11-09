import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { EngineCallbacks, GameEngine, PracticeStats, ReleaseGrade } from "./engine/game-engine";

const PREFS_KEY = "court.prefs";
const BEST_KEY = "court.practice.best";

interface Prefs {
  camera: number;
  muted: boolean;
}

type LoadState = "loading" | "ready" | "error" | "contextLost";

interface Flash {
  id: number;
  text: string;
  tone: "perfect" | "good" | "bad" | "make" | "fire";
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

/** Clutch Court practice mode (/court/practice): single player, local physics. */
@Component({
  selector: "app-court-page",
  standalone: true,
  imports: [RouterLink],
  templateUrl: "./court-page.html",
  styleUrl: "./court-page.css",
})
export class CourtPageComponent implements OnInit, OnDestroy {
  protected i18n = inject(I18nService);
  private zone = inject(NgZone);
  private navHistory = inject(NavHistoryService);

  @ViewChild("host", { static: true }) private host!: ElementRef<HTMLElement>;
  @ViewChild("meter", { static: true }) private meter!: ElementRef<HTMLElement>;
  @ViewChild("meterFill", { static: true }) private meterFill!: ElementRef<HTMLElement>;
  @ViewChild("joystickZone", { static: true }) private joystickZone!: ElementRef<HTMLElement>;

  protected readonly backUrl = this.navHistory.previousUrl() ?? "/";
  protected readonly touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  protected readonly state = signal<LoadState>("loading");
  protected readonly stats = signal<PracticeStats>({ makes: 0, attempts: 0, streak: 0, best: 0 });
  protected readonly flash = signal<Flash | null>(null);
  protected readonly prefs = signal<Prefs>(readJson<Prefs>(PREFS_KEY, { camera: 0, muted: false }));

  private engine: GameEngine | null = null;
  private flashId = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.boot();
  }

  ngOnDestroy(): void {
    this.teardown();
    if (this.flashTimer) clearTimeout(this.flashTimer);
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

  private async boot(): Promise<void> {
    this.state.set("loading");
    const { primary, secondary } = this.teamColors();
    const best = Number(readJson<{ best: number }>(BEST_KEY, { best: 0 }).best) || 0;
    const callbacks: EngineCallbacks = {
      onStats: (s) => {
        if (s.best > this.stats().best && s.best > best) writeStorage(BEST_KEY, JSON.stringify({ best: s.best }));
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
    };
    const engine = new GameEngine(
      {
        container: this.host.nativeElement,
        meter: this.meter.nativeElement,
        meterFill: this.meterFill.nativeElement,
        joystickZone: this.touch ? this.joystickZone.nativeElement : null,
      },
      callbacks,
      { teamPrimary: primary, teamSecondary: secondary, cameraPreset: this.prefs().camera, muted: this.prefs().muted, bestStreak: best }
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

  private teardown(): void {
    this.engine?.dispose();
    this.engine = null;
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
}
