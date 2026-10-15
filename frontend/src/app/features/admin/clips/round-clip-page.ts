import { Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../../core/api.service";
import { AuthService } from "../../../core/auth.service";
import { I18nService } from "../../../core/i18n.service";
import { NavHistoryService } from "../../../core/nav-history.service";
import type { RoundClipData } from "../../../core/models";
import { ButtonDirective } from "../../../shared/button.directive";
import { DropdownComponent, type DropdownOption } from "../../../shared/dropdown";
import { NavIconComponent } from "../../../shared/nav-icon";
import { roundLabel } from "../../../shared/round-label";
import { SkeletonComponent } from "../../../shared/skeleton";
import { CLIP_H, CLIP_W, drawClipFrame, ensureClipFonts, loadClipImages, type ClipImages } from "./clip-renderer";
import { ClipAbortedError, ClipHiddenError, pickRecorderFormat, recordClip } from "./clip-recorder";
import { buildTimeline, clipDuration, type Scene } from "./clip-timeline";
import type { ClipLang } from "./clip-text";

/**
 * /admin/clips (2026-10-15, docs/superpowers/specs/2026-10-15-round-clip-design.md):
 * pick a finished round and a language, watch the clip loop, export it.
 */
@Component({
  selector: "app-round-clip-page",
  standalone: true,
  imports: [RouterLink, ButtonDirective, DropdownComponent, NavIconComponent, SkeletonComponent],
  template: `
    <div class="max-w-3xl mx-auto p-4 sm:p-6">
      <a [routerLink]="navHistory.previousUrl() ?? '/admin/tools'" class="back-link">{{ i18n.t('nav.back') }}</a>

      @if (!auth.currentUser()?.isAdmin) {
        <div class="mt-6 rounded-2xl border border-line bg-card p-6 text-center">
          <p class="font-display text-lg">{{ i18n.t('admin.accessDenied') }}</p>
          <p class="text-sm text-muted mt-1">{{ i18n.t('admin.accessDeniedBody') }}</p>
        </div>
      } @else {
        <div class="flex items-center gap-2 mt-4 mb-1">
          <app-nav-icon name="share" [size]="20" class="text-team-primary" />
          <h1 class="font-display text-2xl tracking-wide">{{ i18n.t('admin.clips.title') }}</h1>
        </div>
        <p class="text-sm text-muted mb-5">{{ i18n.t('admin.clips.desc') }}</p>

        <div class="flex flex-wrap items-end gap-3 mb-4">
          <div class="min-w-[12rem] flex-1">
            <p class="text-[12px] font-semibold text-muted mb-1">{{ i18n.t('admin.clips.round') }}</p>
            <app-dropdown [disabled]="recording() !== null" [options]="roundOptions()" [value]="round() !== null ? '' + round() : null" (valueChange)="selectRound($event)" />
          </div>
          <div>
            <p class="text-[12px] font-semibold text-muted mb-1">{{ i18n.t('admin.clips.lang') }}</p>
            <div class="flex gap-1">
              <button type="button" [appButton]="lang() === 'en' ? 'primary' : 'outline'" appButtonSize="sm" [disabled]="recording() !== null" (click)="lang.set('en')">EN</button>
              <button type="button" [appButton]="lang() === 'el' ? 'primary' : 'outline'" appButtonSize="sm" [disabled]="recording() !== null" (click)="lang.set('el')">ΕΛ</button>
            </div>
          </div>
          <button type="button" appButton [disabled]="!canExport() || !ready() || recording() !== null" (click)="exportClip()">
            {{ i18n.t('admin.clips.export') }}
          </button>
        </div>

        @if (!canExport()) {
          <p class="text-sm text-muted font-semibold mb-3">{{ i18n.t('admin.clips.unsupported') }}</p>
        } @else if (exportFormat()?.ext === 'webm') {
          <p class="text-sm text-muted mb-3">{{ i18n.t('admin.clips.webmNote') }}</p>
        }
        @if (recording() !== null) {
          <div class="mb-3">
            <p class="text-sm font-semibold mb-1">{{ i18n.t('admin.clips.recording') }}</p>
            <div class="h-2 rounded-full bg-line overflow-hidden">
              <div class="h-full bg-team-primary" [style.width.%]="recording()! * 100"></div>
            </div>
          </div>
        }

        @if (error()) {
          <p class="text-sm text-red-500 font-semibold mb-3">{{ error() }}</p>
        }
        @if (noHook()) {
          <p class="text-sm text-amber-500 font-semibold mb-3">{{ i18n.t('admin.clips.noHook') }}</p>
        }

        <div class="flex justify-center">
          @if (!ready()) {
            <app-skeleton class="h-[70vh] aspect-[9/16] rounded-2xl" [icon]="false" />
          }
          <canvas
            #canvas
            [width]="width"
            [height]="height"
            [hidden]="!ready()"
            class="h-[70vh] max-w-full aspect-[9/16] rounded-2xl border border-line bg-black"
          ></canvas>
        </div>
      }
    </div>
  `,
})
export class RoundClipPageComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);
  private destroyRef = inject(DestroyRef);

  protected readonly width = CLIP_W;
  protected readonly height = CLIP_H;
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>("canvas");

  protected readonly season = signal<string | null>(null);
  protected readonly rounds = signal<number[]>([]);
  protected readonly round = signal<number | null>(null);
  protected readonly lang = signal<ClipLang>("en");
  protected readonly data = signal<RoundClipData | null>(null);
  protected readonly ready = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly timeline = computed<Scene[]>(() => {
    const d = this.data();
    return d ? buildTimeline(d) : [];
  });
  protected readonly noHook = computed(() => this.data() !== null && !this.timeline().some((s) => s.id === "hook"));
  protected readonly roundOptions = computed<DropdownOption[]>(() =>
    this.rounds().map((r) => ({ value: String(r), label: roundLabel(this.i18n, r) }))
  );

  /** The format this browser records, or null when it can't record at all. */
  protected readonly exportFormat = signal(
    typeof MediaRecorder === "undefined" ? null : pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m))
  );
  protected readonly canExport = computed(() => this.exportFormat() !== null);
  /** Recording progress 0..1, or null when not recording. */
  protected readonly recording = signal<number | null>(null);

  private images: ClipImages = new Map();
  /** Aborts a running export when the page closes, so no file downloads after leaving. */
  private exportAbort: AbortController | null = null;
  private frame = 0;
  private loopStart = 0;
  /** Set while exporting so the preview loop doesn't draw over the recording. */
  protected paused = false;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.frame);
      this.exportAbort?.abort();
    });
    if (!this.auth.currentUser()?.isAdmin) return;
    this.api.getRoundClipRounds().subscribe({
      next: ({ season, rounds }) => {
        this.season.set(season);
        this.rounds.set(rounds);
        if (rounds.length) this.selectRound(String(rounds[0]));
      },
      error: () => this.error.set("Failed to load rounds"),
    });
  }

  protected selectRound(value: string | null): void {
    const season = this.season();
    if (!value || !season) return;
    const round = Number(value);
    this.round.set(round);
    this.ready.set(false);
    this.error.set(null);
    this.api.getRoundClip(season, round).subscribe({
      next: async (data) => {
        try {
          const [images] = await Promise.all([loadClipImages(data), ensureClipFonts()]);
          if (this.round() !== round) return; // a newer pick won
          this.images = images;
          this.data.set(data);
          this.ready.set(true);
          this.startPreview();
        } catch {
          if (this.round() === round) this.error.set("Failed to prepare the clip (fonts or images)");
        }
      },
      error: (err) => {
        if (this.round() === round) this.error.set(err?.error?.error ?? "Failed to load the clip");
      },
    });
  }

  /** Draws the clip at `time` seconds onto the page's canvas. */
  protected drawAt(time: number): void {
    const ctx = this.canvas()?.nativeElement.getContext("2d");
    const data = this.data();
    if (ctx && data) drawClipFrame(ctx, data, this.timeline(), this.images, time, this.lang());
  }

  protected async exportClip(): Promise<void> {
    const canvas = this.canvas()?.nativeElement;
    const data = this.data();
    if (!canvas || !data) return;
    this.paused = true;
    this.error.set(null);
    this.recording.set(0);
    const lang = this.lang();
    try {
      this.exportAbort = new AbortController();
      const { blob, ext } = await recordClip(
        canvas,
        clipDuration(this.timeline()),
        (t) => this.drawAt(t),
        (p) => this.recording.set(p),
        this.exportAbort.signal
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clutch-${data.season}-round-${data.round}-${lang}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      if (err instanceof ClipAbortedError) return;
      this.error.set(err instanceof ClipHiddenError ? this.i18n.t("admin.clips.hidden") : String((err as Error)?.message ?? err));
    } finally {
      this.exportAbort = null;
      this.recording.set(null);
      this.paused = false;
      this.loopStart = performance.now();
    }
  }

  private startPreview(): void {
    cancelAnimationFrame(this.frame);
    this.loopStart = performance.now();
    const tick = (now: number) => {
      // Loop with a one-second hold on the final frame.
      if (!this.paused) this.drawAt(((now - this.loopStart) / 1000) % (clipDuration(this.timeline()) + 1));
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
