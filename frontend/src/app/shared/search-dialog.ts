import { Component, ElementRef, HostListener, afterNextRender, computed, inject, signal, viewChild } from "@angular/core";
import { Router } from "@angular/router";
import { NgTemplateOutlet } from "@angular/common";
import { FormControl, ReactiveFormsModule } from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { SearchService } from "../core/search.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";
import { PlayerPhotoComponent } from "./player-photo";
import { RetryImgDirective } from "./retry-img.directive";
import { SearchKind, SearchResult, search } from "./search-match";

const GROUP_ORDER: SearchKind[] = ["player", "team", "game", "referee"];
const GROUP_LABEL: Record<SearchKind, string> = {
  player: "search.players",
  team: "search.teams",
  game: "search.games",
  referee: "search.referees",
};

/**
 * Global search dialog (2026-10-12): full screen on phones, a centred panel
 * from sm up. Results grouped by kind; arrows move, Enter opens, Esc closes.
 * An empty query shows this device's recent picks.
 */
@Component({
  selector: "app-search-dialog",
  standalone: true,
  imports: [NgTemplateOutlet, ReactiveFormsModule, NavIconComponent, PlayerPhotoComponent, RetryImgDirective],
  template: `
    <div class="fixed inset-0 z-50 flex sm:items-start sm:justify-center sm:pt-[12vh] bg-black/60 backdrop-blur-sm" (click)="close()">
      <div
        class="w-full h-full sm:h-auto sm:max-h-[70vh] sm:max-w-[560px] bg-card sm:rounded-2xl sm:border sm:border-line shadow-pop flex flex-col pt-[env(safe-area-inset-top)] sm:pt-0"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="i18n.t('search.open')"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center gap-2 px-3 py-3 border-b border-line">
          <app-nav-icon name="search" [size]="18" class="text-muted shrink-0" />
          <input
            #box
            type="search"
            [formControl]="query"
            [placeholder]="i18n.t('search.placeholder')"
            (keydown)="onKey($event)"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            class="flex-1 min-w-0 bg-transparent outline-none text-base font-semibold placeholder:text-muted placeholder:font-normal"
          />
          <button type="button" (click)="close()" class="tap-target shrink-0 px-2 h-8 rounded-lg text-muted text-[12px] font-bold hover:text-ink">Esc</button>
        </div>

        <div class="flex-1 overflow-y-auto p-2">
          @if (!trimmed()) {
            @if (recent().length) {
              <p class="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted">{{ i18n.t('search.recent') }}</p>
              @for (r of recent(); track r.kind + r.id; let i = $index) {
                <ng-container *ngTemplateOutlet="row; context: { $implicit: r, i: i }" />
              }
            }
          } @else if (svc.loading() && !svc.index()) {
            <p class="px-3 py-4 text-sm text-muted">{{ i18n.t('search.loading') }}</p>
          } @else if (results().length === 0) {
            <p class="px-3 py-4 text-sm text-muted">{{ i18n.t('search.none').replace('{q}', trimmed()) }}</p>
          } @else {
            @for (g of groups(); track g.kind) {
              <p class="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted">{{ i18n.t(groupLabel[g.kind]) }}</p>
              @for (r of g.items; track r.kind + r.id) {
                <ng-container *ngTemplateOutlet="row; context: { $implicit: r, i: flat().indexOf(r) }" />
              }
            }
          }
        </div>
      </div>
    </div>

    <ng-template #row let-r let-i="i">
      <button
        type="button"
        (click)="pick(r)"
        (mouseenter)="active.set(i)"
        class="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors"
        [class.bg-page]="active() === i"
      >
        @if (r.kind === 'player') {
          <app-player-photo [name]="r.title" [photoUrl]="r.imageUrl" [teamCode]="r.subtitle" [size]="32" class="shrink-0" />
        } @else if (r.imageUrl) {
          <img [src]="r.imageUrl" alt="" loading="lazy" decoding="async" appRetryImg class="w-8 h-8 object-contain shrink-0 team-logo" />
        } @else {
          <span class="w-8 h-8 rounded-full bg-page border border-line flex items-center justify-center shrink-0 text-muted">
            <app-nav-icon [name]="r.kind === 'game' ? 'schedule' : 'user'" [size]="16" />
          </span>
        }
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold truncate">{{ r.title }}</span>
          @if (r.subtitle) {
            <span class="block text-[12px] text-muted truncate">{{ r.subtitle }}</span>
          }
        </span>
      </button>
    </ng-template>
  `,
})
export class SearchDialogComponent {
  protected readonly svc = inject(SearchService);
  protected readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>("box");

  protected readonly groupLabel = GROUP_LABEL;
  protected readonly query = new FormControl("", { nonNullable: true });
  private readonly value = toSignal(this.query.valueChanges, { initialValue: "" });
  protected readonly trimmed = computed(() => this.value().trim());
  protected readonly active = signal(0);
  protected readonly recent = signal<SearchResult[]>(this.svc.recent());

  protected readonly results = computed(() => {
    const idx = this.svc.index();
    return idx && this.trimmed() ? search(idx, this.trimmed()) : [];
  });
  protected readonly groups = computed(() =>
    GROUP_ORDER.map((kind) => ({ kind, items: this.results().filter((r) => r.kind === kind) })).filter((g) => g.items.length > 0)
  );
  // Rows in on-screen order, for arrow keys and Enter.
  protected readonly flat = computed(() => (this.trimmed() ? this.groups().flatMap((g) => g.items) : this.recent()));

  constructor() {
    afterNextRender(() => this.box()?.nativeElement.focus());
    this.query.valueChanges.subscribe(() => this.active.set(0));
  }

  protected onKey(e: KeyboardEvent): void {
    const rows = this.flat();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.active.set(Math.min(rows.length - 1, this.active() + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.active.set(Math.max(0, this.active() - 1));
    } else if (e.key === "Enter" && rows[this.active()]) {
      e.preventDefault();
      this.pick(rows[this.active()]);
    }
  }

  protected pick(r: SearchResult): void {
    this.svc.remember(r);
    this.close();
    this.router.navigate(r.route);
  }

  @HostListener("document:keydown.escape")
  close(): void {
    this.svc.hide();
  }
}
