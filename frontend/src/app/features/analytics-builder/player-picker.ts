import { Component, EventEmitter, Output, computed, inject, signal } from "@angular/core";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { DialogComponent } from "../../shared/dialog";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SearchInputComponent } from "../../shared/search-input";
import { loose } from "../../shared/search-match";
import { BuilderStore, QuickSetId } from "./builder-store";
import { MAX_PLAYERS } from "./workspace";

/**
 * Add-players sheet: quick sets (which replace the selection) and a search
 * that adds one player at a time, matching accents and Greek spellings.
 */
@Component({
  selector: "app-player-picker",
  standalone: true,
  imports: [DialogComponent, ButtonDirective, RetryImgDirective, SearchInputComponent],
  template: `
    <app-dialog [title]="i18n.t('builder.addPlayers')" icon="sliders" [closeLabel]="i18n.t('hint.dismiss')" (closed)="closed.emit()">
      <p class="text-[11px] text-muted font-bold uppercase tracking-wider mb-2">{{ i18n.t("builder.templatesLabel") }}</p>
      <div class="grid grid-cols-2 gap-2 mb-1">
        @for (set of store.quickSets(); track set.id) {
          <button
            type="button"
            appButton="outline"
            appButtonSize="sm"
            [disabled]="!!set.disabledReasonKey || !set.playerIds.length"
            [attr.title]="set.disabledReasonKey ? i18n.t(set.disabledReasonKey) : null"
            (click)="apply(set.id)"
          >
            {{ i18n.t(set.labelKey) }}
          </button>
        }
      </div>
      @for (line of reasons(); track line) {
        <p class="text-[11px] text-muted mt-1">{{ line }}</p>
      }
      <p class="text-[11px] text-muted mt-1 mb-4">{{ i18n.t("builder.templateHint") }}</p>

      <div class="flex items-center justify-between mb-1.5">
        <p class="text-[11px] text-muted font-bold uppercase tracking-wider">{{ i18n.t("builder.playersLabel") }}</p>
        <p class="text-[11px] text-muted tabular-nums">{{ i18n.t("builder.playersMax").replace("{n}", "" + store.workspace().playerIds.length).replace("{max}", "" + max) }}</p>
      </div>
      <app-search-input class="block w-full" surface="page" [value]="query()" (valueChange)="query.set($event)" [placeholder]="i18n.t('builder.searchPlaceholder')" />
      <ul class="mt-2">
        @for (row of matches(); track row.player.id) {
          <li>
            <button
              type="button"
              (click)="store.addPlayer(row.player.id); query.set('')"
              [disabled]="full()"
              class="w-full flex items-center gap-2 px-2 py-2 rounded-xl text-sm font-semibold text-left hover:bg-page transition-colors disabled:opacity-50"
            >
              @if (row.team.logoUrl) {
                <img [src]="row.team.logoUrl" [alt]="row.team.name" loading="lazy" decoding="async" appRetryImg class="w-5 h-5 object-contain shrink-0 team-logo" />
              }
              <span class="truncate">{{ row.player.name }}</span>
              <span class="ml-auto text-team-primary text-lg leading-none">+</span>
            </button>
          </li>
        }
      </ul>
    </app-dialog>
  `,
})
export class PlayerPickerComponent {
  protected store = inject(BuilderStore);
  protected i18n = inject(I18nService);

  @Output() closed = new EventEmitter<void>();

  protected readonly max = MAX_PLAYERS;
  protected readonly query = signal("");
  protected readonly full = computed(() => this.store.workspace().playerIds.length >= MAX_PLAYERS);

  protected readonly matches = computed(() => {
    const q = loose(this.query());
    if (!q) return [];
    const selected = new Set(this.store.workspace().playerIds);
    return this.store
      .rows()
      .filter((r) => !selected.has(r.player.id) && loose(r.player.name).includes(q))
      .slice(0, 8);
  });

  // One line per unavailable quick set; a guest gets a single login line.
  protected readonly reasons = computed(() => {
    const disabled = this.store.quickSets().filter((s) => s.disabledReasonKey);
    if (disabled.some((s) => s.disabledReasonKey === "builder.quick.loginNeeded")) return [this.i18n.t("builder.quick.loginNeeded")];
    return disabled.map((s) => `${this.i18n.t(s.labelKey)}: ${this.i18n.t(s.disabledReasonKey!)}`);
  });

  protected apply(id: QuickSetId): void {
    this.store.applyQuickSet(id);
    this.closed.emit();
  }
}
