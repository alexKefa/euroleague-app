import { Component, EventEmitter, OnInit, Output, computed, inject, input, signal } from "@angular/core";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { DialogComponent } from "../../shared/dialog";
import { STAT_CATALOG, STAT_GROUPS, statByAlias, type StatGroup } from "../../shared/stat-catalog";
import { BuilderStore } from "./builder-store";
import { FORMULA_PRESETS, FormulaError, compileFormula, evaluateFormula } from "./formula";
import { MAX_FORMULAS } from "./workspace";

const ALIASES = STAT_CATALOG.map((s) => s.alias);

// The identifier the cursor sits in or at the end of; null on an operator,
// space or number literal (nothing to complete).
function currentWordRange(text: string, cursor: number): { start: number; end: number } | null {
  let start = cursor;
  while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) start--;
  let end = cursor;
  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) end++;
  if (start === end || /^[0-9.]+$/.test(text.slice(start, end))) return null;
  return { start, end };
}

/**
 * Add-columns sheet: every catalog stat as a toggle, grouped; one-tap
 * formula presets; and a formula editor with alias autocomplete, translated
 * errors and a live value for the first selected player. With
 * `editFormulaId` set, only the editor shows, prefilled.
 */
@Component({
  selector: "app-column-picker",
  standalone: true,
  imports: [DialogComponent, ButtonDirective, ChipDirective],
  template: `
    <app-dialog [title]="i18n.t(editFormulaId() ? 'builder.editFormula' : 'builder.addColumns')" icon="sliders" [closeLabel]="i18n.t('hint.dismiss')" (closed)="closed.emit()">
      @if (!editFormulaId()) {
        @for (group of groups; track group.id) {
          <p class="text-xs text-muted font-bold uppercase tracking-wider mb-1.5">{{ i18n.t("builder.group." + group.id) }}</p>
          <div class="flex flex-wrap gap-1.5 mb-3">
            @for (stat of group.stats; track stat.key) {
              <button type="button" [appChip]="selected().has(stat.key)" [attr.title]="i18n.t(stat.legendKey)" (click)="store.toggleStat(stat.key)">
                {{ i18n.t(stat.labelKey) }}
              </button>
            }
          </div>
        }

        <p class="text-xs text-muted font-bold uppercase tracking-wider mb-1.5 mt-2">{{ i18n.t("builder.customColumnsLabel") }}</p>
        @if (atLimit()) {
          <p class="text-xs text-muted mb-2">{{ i18n.t("builder.formulaLimit").replace("{max}", "" + maxFormulas) }}</p>
        } @else {
          <div class="flex flex-wrap gap-1.5 mb-3">
            @for (preset of presets; track preset.id) {
              @if (preset.id !== "per40") {
                <button type="button" appButton="outline" appButtonSize="sm" (click)="addPreset(preset.labelKey, preset.expression)">{{ i18n.t(preset.labelKey) }}</button>
              }
            }
            <span class="inline-flex items-center gap-1">
              <select
                class="h-8 px-2 rounded-lg bg-page border border-line text-xs font-semibold"
                [attr.aria-label]="i18n.t('builder.per40Pick')"
                (change)="per40Stat.set($any($event.target).value)"
              >
                @for (alias of per40Options; track alias) {
                  <option [value]="alias" [selected]="alias === per40Stat()">{{ aliasLabel(alias) }}</option>
                }
              </select>
              <button type="button" appButton="outline" appButtonSize="sm" (click)="addPer40()">{{ i18n.t("builder.preset.per40") }}</button>
            </span>
          </div>
        }
      }

      @if (!atLimit() || editFormulaId()) {
        <div class="bg-page rounded-lg border border-line p-3">
          <input
            type="text"
            [value]="label()"
            (input)="label.set($any($event.target).value)"
            [placeholder]="i18n.t('builder.formulaLabel')"
            maxlength="40"
            class="w-full px-2.5 py-1.5 rounded-lg bg-card border-2 border-line text-sm font-semibold focus:border-team-primary outline-none mb-2"
          />
          <div class="relative">
            <input
              #expr
              type="text"
              [value]="expression()"
              (input)="onExpressionInput($event)"
              (blur)="suggestions.set(null)"
              [placeholder]="i18n.t('builder.formulaExpression')"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              class="w-full px-2.5 py-1.5 rounded-lg bg-card border-2 border-line text-sm font-mono focus:border-team-primary outline-none"
            />
            @if (suggestions(); as sugg) {
              <ul class="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-lg bg-card border-2 border-line shadow-pop py-1">
                @for (alias of sugg.options; track alias) {
                  <li
                    (mousedown)="$event.preventDefault()"
                    (click)="pickSuggestion(alias, expr)"
                    class="px-2.5 py-1.5 text-xs cursor-pointer hover:bg-page transition-colors flex justify-between gap-2"
                  >
                    <span class="font-mono">{{ alias }}</span>
                    <span class="text-muted">{{ aliasLabel(alias) }}</span>
                  </li>
                }
              </ul>
            }
          </div>
          <p class="text-xs mt-2 min-h-[1.25rem]" [class.text-red-500]="!!preview().error" [class.text-muted]="!preview().error">{{ preview().text }}</p>
          <button type="button" appButton appButtonSize="sm" class="w-full mt-1" [disabled]="!canSubmit()" (click)="submit()">
            {{ i18n.t(editFormulaId() ? "builder.formulaUpdate" : "builder.formulaAdd") }}
          </button>
        </div>
      }
    </app-dialog>
  `,
})
export class ColumnPickerComponent implements OnInit {
  protected store = inject(BuilderStore);
  protected i18n = inject(I18nService);

  readonly editFormulaId = input<string | null>(null);
  @Output() closed = new EventEmitter<void>();

  protected readonly maxFormulas = MAX_FORMULAS;
  protected readonly presets = FORMULA_PRESETS;
  protected readonly per40Options = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "PIR"];
  protected readonly groups = STAT_GROUPS.map((id: StatGroup) => ({ id, stats: STAT_CATALOG.filter((s) => s.group === id) }));

  protected readonly label = signal("");
  protected readonly expression = signal("");
  protected readonly per40Stat = signal("PTS");
  protected readonly suggestions = signal<{ options: string[]; start: number; end: number } | null>(null);

  protected readonly selected = computed(() => new Set(this.store.workspace().columns.flatMap((c) => (c.kind === "stat" ? [c.key] : []))));
  protected readonly atLimit = computed(() => this.store.formulaCount() >= MAX_FORMULAS);

  protected readonly preview = computed<{ text: string; error: FormulaError | null }>(() => {
    if (!this.expression().trim()) return { text: "", error: null };
    const compiled = compileFormula(this.expression());
    if ("error" in compiled) return { text: this.errorText(compiled.error), error: compiled.error };
    const first = this.store.sortedRows()[0];
    if (!first) return { text: "", error: null };
    const v = evaluateFormula(compiled.node, first.stats as unknown as Record<string, number | null>);
    return { text: `${first.player.name}: ${v == null ? "—" : v.toFixed(2)}`, error: null };
  });

  protected readonly canSubmit = computed(() => {
    const label = this.label().trim();
    return label.length > 0 && label.length <= 40 && !!this.expression().trim() && !this.preview().error;
  });

  ngOnInit(): void {
    const id = this.editFormulaId();
    const existing = id ? this.store.workspace().columns.find((c) => c.kind === "formula" && c.id === id) : null;
    if (existing?.kind === "formula") {
      this.label.set(existing.label);
      this.expression.set(existing.expression);
    }
  }

  protected aliasLabel(alias: string): string {
    const stat = statByAlias(alias);
    return stat ? this.i18n.t(stat.labelKey) : alias;
  }

  protected addPreset(labelKey: string, expression: string): void {
    this.store.upsertFormula({ label: this.i18n.t(labelKey), expression });
  }

  protected addPer40(): void {
    const alias = this.per40Stat();
    const preset = FORMULA_PRESETS.find((p) => p.id === "per40")!;
    this.store.upsertFormula({ label: `${this.aliasLabel(alias)}/40`, expression: preset.expression.replace("{X}", alias) });
  }

  protected onExpressionInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    this.expression.set(el.value);
    const range = currentWordRange(el.value, el.selectionStart ?? el.value.length);
    if (!range) {
      this.suggestions.set(null);
      return;
    }
    const word = el.value.slice(range.start, range.end).toUpperCase();
    const options = ALIASES.filter((a) => a.startsWith(word) && a !== word);
    this.suggestions.set(options.length ? { options, ...range } : null);
  }

  protected pickSuggestion(alias: string, el: HTMLInputElement): void {
    const s = this.suggestions();
    if (!s) return;
    const text = this.expression();
    this.expression.set(text.slice(0, s.start) + alias + text.slice(s.end));
    this.suggestions.set(null);
    const cursor = s.start + alias.length;
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    this.store.upsertFormula({ id: this.editFormulaId() ?? undefined, label: this.label(), expression: this.expression() });
    if (this.editFormulaId()) {
      this.closed.emit();
      return;
    }
    this.label.set("");
    this.expression.set("");
  }

  private errorText(error: FormulaError): string {
    return this.i18n.t("builder.formulaError." + error.code).replace("{text}", error.params?.text ?? "");
  }
}
