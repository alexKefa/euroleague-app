import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, computed, inject, signal, viewChild } from "@angular/core";
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  CircleGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,

  WebGLRenderer,
} from "three";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { ThemeService } from "../../core/theme.service";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHeaderComponent } from "../../shared/page-header";
import { displayTeamCode } from "../../shared/team-display-code";
import {
  HAIR_COLOR_COUNT,
  HAIR_STYLES,
  SKIN_TONE_COUNT,
  type AvatarLook,
  type HairStyle,
  parseAvatar,
} from "../../../../../shared/court/avatar";
import { JERSEY_FONT, createBall, releaseBallTexture, releaseShadowTexture } from "./engine/avatar-factory";
import { AvatarBatch, AvatarRig, HAIR_HEX, SKIN_HEX } from "./engine/avatar-rig";
import { disposeObject } from "./engine/scene-builder";

/**
 * /court/locker: pick your look on the court (skin tone, haircut, hair
 * colour, beard, shirt number) with a live turntable preview in your club's
 * kit. Saved to your account; everyone on a court sees it.
 */
@Component({
  selector: "app-locker-room",
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, ButtonDirective, PageHeaderComponent],
  template: `
    <div class="max-w-4xl mx-auto p-4 sm:p-6">
      <a [routerLink]="backLink" class="text-sm font-bold text-team-primary">← {{ i18n.t("court.locker.back") }}</a>
      <app-page-header [title]="i18n.t('court.locker.title')" [subtitle]="i18n.t('court.locker.subtitle')" icon="ball" />

      @if (!auth.isAuthenticated()) {
        <section class="rounded-3xl border border-line bg-card p-5 shadow-card">
          <p class="text-sm text-muted">{{ i18n.t("court.locker.loginToEdit") }}</p>
          <a routerLink="/login" appButton appButtonSize="sm" class="mt-4 inline-block">{{ i18n.t("court.hub.loginToPlay") }}</a>
        </section>
      } @else {
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <!-- Preview -->
          <section
            class="relative overflow-hidden rounded-3xl shadow-card aspect-square md:aspect-auto md:min-h-[460px] touch-none select-none cursor-grab"
            style="background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--accent-primary) 35%, #1a2230), #0b1018 75%)"
            (pointerdown)="dragStart($event)"
            (pointermove)="dragMove($event)"
            (pointerup)="dragEnd()"
            (pointercancel)="dragEnd()"
          >
            <canvas #canvas class="absolute inset-0 h-full w-full"></canvas>
            <p class="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-white/70">{{ i18n.t("court.locker.dragHint") }}</p>
          </section>

          <!-- Options -->
          <form [formGroup]="form" class="rounded-3xl border border-line bg-card p-5 shadow-card flex flex-col gap-5" (submit)="$event.preventDefault(); save()">
            <fieldset>
              <legend class="text-sm font-bold">{{ i18n.t("court.locker.skin") }}</legend>
              <div class="mt-2 flex flex-wrap gap-2">
                @for (c of skinSwatches; track $index) {
                  <button
                    type="button"
                    class="h-10 w-10 rounded-full border-2 transition"
                    [class.border-team-primary]="form.controls.skin.value === $index"
                    [class.scale-110]="form.controls.skin.value === $index"
                    [class.border-line]="form.controls.skin.value !== $index"
                    [style.background]="c"
                    [attr.aria-label]="i18n.t('court.locker.skin') + ' ' + ($index + 1)"
                    [attr.aria-pressed]="form.controls.skin.value === $index"
                    (click)="form.controls.skin.setValue($index)"
                  ></button>
                }
              </div>
            </fieldset>

            <fieldset>
              <legend class="text-sm font-bold">{{ i18n.t("court.locker.hair") }}</legend>
              <div class="mt-2 grid grid-cols-4 gap-2">
                @for (h of hairStyles; track h) {
                  <button
                    type="button"
                    class="rounded-full border px-2 py-2 text-sm font-bold transition"
                    [class.bg-team-primary]="form.controls.hair.value === h"
                    [class.text-team-secondary]="form.controls.hair.value === h"
                    [class.border-team-primary]="form.controls.hair.value === h"
                    [class.border-line]="form.controls.hair.value !== h"
                    [attr.aria-pressed]="form.controls.hair.value === h"
                    (click)="form.controls.hair.setValue(h)"
                  >
                    {{ i18n.t("court.locker.hair." + h) }}
                  </button>
                }
              </div>
            </fieldset>

            <fieldset>
              <legend class="text-sm font-bold">{{ i18n.t("court.locker.hairColor") }}</legend>
              <div class="mt-2 flex flex-wrap gap-2">
                @for (c of hairSwatches; track $index) {
                  <button
                    type="button"
                    class="h-9 w-9 rounded-full border-2 transition"
                    [class.border-team-primary]="form.controls.hairColor.value === $index"
                    [class.scale-110]="form.controls.hairColor.value === $index"
                    [class.border-line]="form.controls.hairColor.value !== $index"
                    [style.background]="c"
                    [attr.aria-label]="i18n.t('court.locker.hairColor') + ' ' + ($index + 1)"
                    [attr.aria-pressed]="form.controls.hairColor.value === $index"
                    (click)="form.controls.hairColor.setValue($index)"
                  ></button>
                }
              </div>
            </fieldset>

            <fieldset>
              <legend class="text-sm font-bold">{{ i18n.t("court.locker.beard") }}</legend>
              <div class="mt-2 grid grid-cols-2 gap-2">
                @for (opt of [false, true]; track opt) {
                  <button
                    type="button"
                    class="rounded-full border px-2 py-2 text-sm font-bold transition"
                    [class.bg-team-primary]="form.controls.beard.value === opt"
                    [class.text-team-secondary]="form.controls.beard.value === opt"
                    [class.border-team-primary]="form.controls.beard.value === opt"
                    [class.border-line]="form.controls.beard.value !== opt"
                    [attr.aria-pressed]="form.controls.beard.value === opt"
                    (click)="form.controls.beard.setValue(opt)"
                  >
                    {{ i18n.t(opt ? "court.locker.beardOn" : "court.locker.beardOff") }}
                  </button>
                }
              </div>
            </fieldset>

            <label class="block">
              <span class="text-sm font-bold">{{ i18n.t("court.locker.number") }}</span>
              <input
                type="number"
                inputmode="numeric"
                min="0"
                max="99"
                formControlName="number"
                class="mt-2 w-28 rounded-full border border-line bg-page px-4 py-2 font-display text-2xl outline-none focus:border-team-primary"
              />
              @if (form.controls.number.invalid) {
                <span class="mt-1 block text-xs text-muted">{{ i18n.t("court.locker.numberHint") }}</span>
              }
            </label>

            <div class="mt-auto flex flex-wrap items-center gap-2">
              <button type="submit" appButton [disabled]="form.invalid || saving() || loading()">
                {{ saving() ? i18n.t("court.locker.saving") : i18n.t("court.locker.save") }}
              </button>
              <button type="button" appButton="outline" (click)="randomize()">{{ i18n.t("court.locker.random") }}</button>
              @if (status(); as s) {
                <span class="text-sm" [class.text-muted]="s === 'error'" role="status">{{ i18n.t(s === "saved" ? "court.locker.saved" : "court.locker.error") }}</span>
              }
            </div>
          </form>
        </div>
      }
    </div>
  `,
})
export class LockerRoomComponent implements OnInit, AfterViewInit, OnDestroy {
  protected i18n = inject(I18nService);
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private zone = inject(NgZone);
  private navHistory = inject(NavHistoryService);

  protected readonly backLink = this.navHistory.previousUrl() ?? "/court";
  protected readonly skinSwatches = SKIN_HEX.slice(0, SKIN_TONE_COUNT);
  protected readonly hairSwatches = HAIR_HEX.slice(0, HAIR_COLOR_COUNT);
  protected readonly hairStyles = HAIR_STYLES;
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly status = signal<"saved" | "error" | null>(null);

  protected readonly form = new FormGroup({
    skin: new FormControl(0, { nonNullable: true }),
    hair: new FormControl<HairStyle>("short", { nonNullable: true }),
    hairColor: new FormControl(0, { nonNullable: true }),
    beard: new FormControl(false, { nonNullable: true }),
    number: new FormControl<number | null>(7, [Validators.required, Validators.min(0), Validators.max(99), Validators.pattern(/^\d{1,2}$/)]),
  });

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>("canvas");
  private readonly name = computed(() => this.auth.currentUser()?.username ?? "");

  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private batch: AvatarBatch | null = null;
  private rig: AvatarRig | null = null;
  private ball: Mesh | null = null;
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;
  private rotY = 0.5;
  private spin = 0.5;
  private dragX: number | null = null;
  private lastTime = 0;
  private destroyed = false;
  private lastLook = "";


  async ngOnInit(): Promise<void> {
    this.form.valueChanges.subscribe(() => {
      this.status.set(null);
      this.rebuildRig();
    });
    if (!this.auth.isAuthenticated()) return;
    try {
      const { avatar } = await firstValueFrom(this.api.getMyAvatar());
      if (this.destroyed) return;
      this.form.setValue({ ...avatar });
    } catch {
      this.status.set("error");
    } finally {
      this.loading.set(false);
    }
  }

  async ngAfterViewInit(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    try {
      await Promise.race([document.fonts.load(`800 64px ${JERSEY_FONT}`, "ΑΒΓ ABC 0123"), new Promise((r) => setTimeout(r, 2500))]);
    } catch {
      /* fall back to whatever font is available */
    }
    if (this.destroyed) return;
    this.zone.runOutsideAngular(() => this.initScene(canvas));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.rig?.dispose();
    if (this.scene) disposeObject(this.scene);
    releaseBallTexture();
    releaseShadowTexture();
    this.renderer?.dispose();
  }

  /** The look in the form, or null while the number is invalid. */
  private look(): AvatarLook | null {
    const v = this.form.getRawValue();
    return parseAvatar({ ...v, number: v.number === null ? null : Number(v.number) });
  }

  protected randomize(): void {
    const r = (n: number) => Math.floor(Math.random() * n);
    this.form.patchValue({
      skin: r(SKIN_TONE_COUNT),
      hair: HAIR_STYLES[r(HAIR_STYLES.length)]!,
      hairColor: r(HAIR_COLOR_COUNT),
      beard: Math.random() < 0.4,
    });
  }

  protected async save(): Promise<void> {
    const look = this.look();
    if (!look) return;
    this.saving.set(true);
    this.status.set(null);
    try {
      await firstValueFrom(this.api.saveMyAvatar(look));
      this.status.set("saved");
    } catch {
      this.status.set("error");
    } finally {
      this.saving.set(false);
    }
  }

  // ---- turntable ----

  protected dragStart(e: PointerEvent): void {
    this.dragX = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.spin = 0;
  }

  protected dragMove(e: PointerEvent): void {
    if (this.dragX === null) return;
    this.rotY += (e.clientX - this.dragX) * 0.012;
    this.dragX = e.clientX;
  }

  protected dragEnd(): void {
    this.dragX = null;
    this.spin = 0.5;
  }

  private initScene(canvas: HTMLCanvasElement): void {
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return; // no WebGL: the pickers still work, just without a preview
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer = renderer;

    const scene = new Scene();
    scene.add(new HemisphereLight("#eef4ff", "#3a4250", 1.7));
    const key = new DirectionalLight("#fff3dc", 2.4);
    key.position.set(-2, 4, 4);
    scene.add(key);
    const rim = new DirectionalLight("#bcd4ff", 1.2);
    rim.position.set(3, 3, -4);
    scene.add(rim);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim() || "#FF6B35";
    const floor = new Mesh(new CircleGeometry(0.9, 48), new MeshStandardMaterial({ color: accent, roughness: 0.6, transparent: true, opacity: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    this.scene = scene;
    this.camera = new PerspectiveCamera(28, 1, 0.1, 50);
    this.camera.position.set(0, 1.15, 5);
    this.camera.lookAt(0, 0.95, 0);
    this.batch = new AvatarBatch(scene, 1);
    this.ball = createBall();
    scene.add(this.ball);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.rebuildRig();
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private resize(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.renderer || !this.camera) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** New rig for the current look (the jersey texture and colours are baked at creation). */
  private rebuildRig(): void {
    if (!this.batch || !this.scene) return;
    const look = this.look();
    if (!look) return;
    const key = JSON.stringify(look);
    if (key === this.lastLook && this.rig) return;
    this.lastLook = key;
    this.rig?.dispose();
    const slot = this.batch.alloc();
    if (slot === null) return;
    const css = getComputedStyle(document.documentElement);
    const primary = css.getPropertyValue("--accent-primary").trim() || "#FF6B35";
    const secondary = css.getPropertyValue("--accent-secondary").trim() || "#0B1220";
    const team = this.theme.favoriteTeam();
    this.rig = new AvatarRig(
      this.batch,
      this.scene,
      slot,
      primary,
      secondary,
      { name: this.name(), number: look.number, chest: team ? displayTeamCode(team.code) : "" },
      look
    );
  }

  private readonly loop = (time: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    if (!this.renderer || !this.scene || !this.camera || !this.rig || !this.batch) return;
    this.rotY += this.spin * dt;
    this.rig.update(performance.now(), dt, 0, 0, this.rotY, { moving: false, chargeSeconds: 0, charging: false, dribblePhase: 0, speed: 0 });
    this.batch.commit();
    if (this.ball) this.rig.ballWorld(this.ball.position);
    this.renderer.render(this.scene, this.camera);
  };
}
