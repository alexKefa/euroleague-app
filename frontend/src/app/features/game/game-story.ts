import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { Subscription } from "rxjs";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { StorySummary } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { NavIconComponent } from "../../shared/nav-icon";

type ShareState = "idle" | "working" | "needsTap" | "downloaded" | "copied" | "error";

/**
 * "Story of the game" (2026-10-09, docs/superpowers/specs/2026-10-09-game-story-cards-design.md):
 * the server-rendered 1080x1350 card for a final game, with Share (image +
 * text + link through the phone's share sheet), Download and Copy link.
 * Hidden if the card can't load.
 */
@Component({
  selector: "app-game-story",
  standalone: true,
  imports: [ButtonDirective, NavIconComponent],
  template: `
    @if (!failed()) {
      <div class="bg-card rounded-3xl border border-line shadow-card p-4 mb-5">
        <div class="card-head">
          <span class="card-head-icon"><app-nav-icon name="share" [size]="18" /></span>
          <p class="font-display text-base flex-1 min-w-0 truncate">{{ i18n.t('story.title') }}</p>
        </div>
        <div class="relative w-full rounded-2xl overflow-hidden border border-line bg-page" style="aspect-ratio: 1080 / 1350">
          @if (!loaded()) {
            <div class="absolute inset-0 animate-pulse bg-line/50" aria-hidden="true"></div>
          }
          @if (imageUrl(); as src) {
          <img
            [src]="src"
            [alt]="summary()?.headline ?? i18n.t('story.alt')"
            class="w-full h-full object-contain transition-opacity"
            [class.opacity-0]="!loaded()"
            (load)="loaded.set(true)"
            (error)="failed.set(true)"
          />
          }
        </div>
        <div class="grid grid-cols-2 gap-2 mt-3">
          <button type="button" appButton appButtonSize="sm" class="col-span-2" [disabled]="!loaded() || state() === 'working'" (click)="share()">
            {{ state() === 'needsTap' ? i18n.t('story.tapAgain') : i18n.t('story.share') }}
          </button>
          <button type="button" appButton="outline" appButtonSize="sm" [disabled]="!loaded()" (click)="download()">{{ i18n.t('story.download') }}</button>
          <button type="button" appButton="outline" appButtonSize="sm" (click)="copyLink()">{{ i18n.t('story.copyLink') }}</button>
        </div>
        @if (note(); as n) {
          <p class="text-xs text-center mt-2" [class.text-red-500]="state() === 'error'" [class.text-muted]="state() !== 'error'">{{ n }}</p>
        }
      </div>
    }
  `,
})
export class GameStoryComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(I18nService);

  readonly gameId = input.required<string>();
  readonly homeCode = input.required<string>();
  readonly awayCode = input.required<string>();

  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  protected readonly state = signal<ShareState>("idle");
  protected readonly summary = signal<StorySummary | null>(null);
  // A file rendered for a share the browser refused (too long after the tap).
  private pendingFile: File | null = null;
  private sub?: Subscription;

  private readonly lang = computed<"en" | "el">(() => (this.i18n.lang() === "en" ? "en" : "el"));
  // Built from the summary's version so a changed card gets a fresh URL.
  protected readonly imageUrl = computed(() => {
    const s = this.summary();
    return s ? this.api.gameStoryImageUrl(this.gameId(), this.lang(), s.version) : null;
  });

  protected readonly note = computed(() => {
    switch (this.state()) {
      case "downloaded": return this.i18n.t("story.downloaded");
      case "copied": return this.i18n.t("story.linkCopied");
      case "error": return this.i18n.t("story.error");
      default: return null;
    }
  });

  constructor() {
    effect(() => {
      const id = this.gameId();
      const lang = this.lang();
      untracked(() => {
        this.loaded.set(false);
        this.failed.set(false);
        this.state.set("idle");
        this.pendingFile = null;
        this.summary.set(null);
        this.sub?.unsubscribe();
        this.sub = this.api.getGameStory(id, lang).subscribe({ next: (s) => this.summary.set(s), error: () => this.failed.set(true) });
      });
    });
  }

  private gameUrl(): string {
    return `${location.origin}/games/${this.gameId()}`;
  }

  private fileName(): string {
    return `clutch-${this.homeCode()}-${this.awayCode()}-${this.summary()?.angle ?? "story"}.png`.toLowerCase();
  }

  private async fetchFile(): Promise<File> {
    const url = this.imageUrl();
    if (!url) throw new Error("story not loaded");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`story.png ${res.status}`);
    return new File([await res.blob()], this.fileName(), { type: "image/png" });
  }

  private saveFile(file: File): void {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected async share(): Promise<void> {
    try {
      const file = this.pendingFile ?? (this.state.set("working"), await this.fetchFile());
      this.pendingFile = null;
      // The server writes the production link; share this site's instead
      // (so a dev share links to dev).
      const text = (this.summary()?.shareText ?? this.gameUrl()).replace(/(https?:\/\/)?getclutchapp\.com\/games\/\S+/, this.gameUrl());
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
          this.state.set("idle");
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") this.state.set("idle");
          else if (err instanceof DOMException && err.name === "NotAllowedError") {
            // Phones only allow share() shortly after a tap: keep the file
            // and let the next tap share it straight away.
            this.pendingFile = file;
            this.state.set("needsTap");
          } else throw err;
        }
        return;
      }
      this.saveFile(file);
      this.state.set("downloaded");
    } catch {
      this.state.set("error");
    }
  }

  protected async download(): Promise<void> {
    try {
      this.saveFile(await this.fetchFile());
      this.state.set("downloaded");
    } catch {
      this.state.set("error");
    }
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.gameUrl());
      this.state.set("copied");
    } catch {
      this.state.set("error");
    }
  }
}
