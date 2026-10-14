import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";
import { DialogComponent } from "../../shared/dialog";
import { PageHeaderComponent } from "../../shared/page-header";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { StatLegendComponent, StatLegendEntry } from "../../shared/stat-legend";
import { BuilderStore, ResolvedColumn } from "./builder-store";
import { ColumnPickerComponent } from "./column-picker";
import { PlayerPickerComponent } from "./player-picker";
import { ResultsChartComponent } from "./results-chart";
import { ResultsTableComponent } from "./results-table";
import { ViewSwitcherComponent } from "./view-switcher";

type Display = "table" | "chart";

/**
 * Analytics Builder (2026-10-14 redesign): one live workspace. Players and
 * columns sit above a table/chart that updates on every change; saved
 * views are snapshots of the workspace. All state lives in BuilderStore.
 */
@Component({
  selector: "app-analytics-builder",
  standalone: true,
  imports: [
    RouterLink,
    ButtonDirective,
    ChipDirective,
    ConfirmDialogComponent,
    DialogComponent,
    PageHeaderComponent,
    RetryImgDirective,
    SkeletonComponent,
    StatLegendComponent,
    ColumnPickerComponent,
    PlayerPickerComponent,
    ResultsChartComponent,
    ResultsTableComponent,
    ViewSwitcherComponent,
  ],
  providers: [BuilderStore],
  templateUrl: "./analytics-builder.html",
})
export class AnalyticsBuilderComponent implements OnInit {
  protected store = inject(BuilderStore);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  protected readonly display = signal<Display>("table");
  protected readonly playerPickerOpen = signal(false);
  protected readonly columnPickerOpen = signal(false);
  protected readonly editingFormulaId = signal<string | null>(null);
  protected readonly columnMenu = signal<ResolvedColumn | null>(null);
  protected readonly naming = signal(false);
  protected readonly nameValue = signal("");

  protected readonly legend = computed<StatLegendEntry[]>(() => this.store.columns().map((c) => ({ code: c.label, label: c.legend })));

  ngOnInit(): void {
    this.store.load();
  }

  requestLeave(): Promise<boolean> {
    return this.store.confirmDiscardIfDirty();
  }

  protected columnIndex(col: ResolvedColumn): number {
    return this.store.columns().findIndex((c) => c.id === col.id);
  }

  protected move(col: ResolvedColumn, dir: -1 | 1): void {
    this.store.moveColumn(col.id, dir);
    this.columnMenu.set(null);
  }

  protected remove(col: ResolvedColumn): void {
    this.store.removeColumn(col.id);
    this.columnMenu.set(null);
  }

  protected edit(col: ResolvedColumn): void {
    if (col.ref.kind !== "formula") return;
    this.columnMenu.set(null);
    this.editingFormulaId.set(col.ref.id);
  }

  protected save(): void {
    if (this.store.activeViewId()) {
      this.store.save();
      return;
    }
    this.nameValue.set("");
    this.naming.set(true);
  }

  protected submitName(): void {
    if (!this.nameValue().trim()) return;
    this.store.save(this.nameValue());
    this.naming.set(false);
  }
}
