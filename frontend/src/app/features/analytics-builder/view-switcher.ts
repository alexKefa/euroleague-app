import { Component, computed, inject, signal } from "@angular/core";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";
import { DialogComponent } from "../../shared/dialog";
import { BuilderStore } from "./builder-store";
import { MAX_VIEWS } from "./workspace";

const NEW_OPTION = "__unsaved__";

/**
 * Saved-view switcher: pick a view, start a new one, rename or delete the
 * open one. Switching away from unsaved changes asks first.
 */
@Component({
  selector: "app-view-switcher",
  standalone: true,
  imports: [ButtonDirective, ConfirmDialogComponent, DialogComponent],
  template: `
    <div class="flex items-center gap-2 mb-4">
      @if (auth.isAuthenticated()) {
        <select
          class="flex-1 min-w-0 h-10 px-3 rounded-lg bg-card border border-line shadow-card text-sm font-semibold truncate"
          [attr.aria-label]="i18n.t('builder.backToViews')"
          (change)="onSelect($event)"
        >
          @if (store.activeViewId() === null) {
            <option [value]="newOption" selected>{{ i18n.t("builder.unsavedView") }}</option>
          }
          @for (view of store.views(); track view.id) {
            <option [value]="view.id" [selected]="view.id === store.activeViewId()">{{ view.name }}</option>
          }
        </select>
        <button
          type="button"
          appButton="outline"
          appButtonSize="sm"
          [disabled]="atLimit()"
          [attr.title]="atLimit() ? i18n.t('builder.error.viewLimit') : null"
          (click)="startNew()"
        >
          + {{ i18n.t("builder.newView") }}
        </button>
        @if (store.activeView()) {
          <div class="relative">
            <button
              type="button"
              class="tap-target relative h-10 w-10 flex items-center justify-center rounded-lg border border-line bg-card text-lg leading-none"
              [attr.aria-label]="i18n.t('builder.viewActions')"
              [attr.aria-expanded]="menuOpen()"
              (click)="menuOpen.set(!menuOpen())"
            >
              ⋯
            </button>
            @if (menuOpen()) {
              <div class="absolute right-0 top-full mt-1 z-30 w-40 rounded-lg bg-card border border-line shadow-pop py-1">
                <button type="button" class="w-full text-left px-3 py-2 text-sm font-semibold hover:bg-page" (click)="openRename()">{{ i18n.t("builder.rename") }}</button>
                <button type="button" class="w-full text-left px-3 py-2 text-sm font-semibold text-red-500 hover:bg-page" (click)="menuOpen.set(false); confirmingDelete.set(true)">
                  {{ i18n.t("builder.delete") }}
                </button>
              </div>
            }
          </div>
        }
      } @else {
        <p class="flex-1 text-sm text-muted">{{ i18n.t("builder.guestHint") }}</p>
      }
    </div>

    @if (store.viewsState() === "error") {
      <div class="flex items-center justify-between gap-3 mb-4 text-sm">
        <p class="text-red-500 font-semibold">{{ i18n.t("builder.error.loadViews") }}</p>
        <button type="button" appButton="outline" appButtonSize="sm" (click)="store.retryViews()">{{ i18n.t("builder.retry") }}</button>
      </div>
    }

    @if (renaming()) {
      <app-dialog [title]="i18n.t('builder.renameTitle')" icon="sliders" [closeLabel]="i18n.t('builder.cancel')" (closed)="renaming.set(false)">
        <input
          type="text"
          [value]="renameValue()"
          (input)="renameValue.set($any($event.target).value)"
          maxlength="60"
          class="w-full px-3 py-2 rounded-lg bg-page border-2 border-line text-sm font-semibold focus:border-team-primary outline-none mb-3"
        />
        <button type="button" appButton appButtonSize="sm" class="w-full" [disabled]="!renameValue().trim()" (click)="submitRename()">
          {{ i18n.t("builder.save") }}
        </button>
      </app-dialog>
    }

    @if (confirmingDelete()) {
      <app-confirm-dialog
        [message]="i18n.t('builder.deleteConfirmPrompt')"
        [confirmLabel]="i18n.t('builder.deleteConfirmYes')"
        [cancelLabel]="i18n.t('builder.cancel')"
        (confirmed)="confirmingDelete.set(false); store.deleteActive()"
        (cancelled)="confirmingDelete.set(false)"
      />
    }
  `,
})
export class ViewSwitcherComponent {
  protected store = inject(BuilderStore);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  protected readonly newOption = NEW_OPTION;
  protected readonly menuOpen = signal(false);
  protected readonly renaming = signal(false);
  protected readonly renameValue = signal("");
  protected readonly confirmingDelete = signal(false);
  protected readonly atLimit = computed(() => this.store.views().length >= MAX_VIEWS);

  protected async onSelect(event: Event): Promise<void> {
    const el = event.target as HTMLSelectElement;
    const id = el.value;
    const current = this.store.activeViewId() ?? NEW_OPTION;
    if (id === current) return;
    // Snap back until the discard question is answered.
    el.value = current;
    if (!(await this.store.confirmDiscardIfDirty())) return;
    this.store.openView(id);
  }

  protected async startNew(): Promise<void> {
    if (!(await this.store.confirmDiscardIfDirty())) return;
    this.store.newWorkspace();
  }

  protected openRename(): void {
    this.menuOpen.set(false);
    this.renameValue.set(this.store.activeView()?.name ?? "");
    this.renaming.set(true);
  }

  protected submitRename(): void {
    this.store.rename(this.renameValue());
    this.renaming.set(false);
  }
}
