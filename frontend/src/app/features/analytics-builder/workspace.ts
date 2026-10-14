import type { AnalyticsView, AnalyticsViewCustomColumn } from "../../core/models";
import { statByKey, type StatKey } from "../../shared/stat-catalog";

/**
 * The builder's working state and how it maps onto a saved view without
 * any backend change: `customColumns` holds formula definitions and
 * `columns` holds the full display order, stat keys as-is and formulas as
 * "f:<id>". Views saved before 2026-10-14 have no "f:" entries and load as
 * their stats followed by their formulas.
 */
export type ColumnRef = { kind: "stat"; key: StatKey } | { kind: "formula"; id: string; label: string; expression: string };

export interface Workspace {
  playerIds: string[];
  columns: ColumnRef[];
  sort: { columnId: string; desc: boolean } | null;
}

export interface ViewBody {
  name: string;
  playerIds: string[];
  columns: string[];
  customColumns: AnalyticsViewCustomColumn[];
  sortKey: string | null;
  sortDesc: boolean;
}

export const DEFAULT_COLUMNS: StatKey[] = ["pointsPerGame", "reboundsPerGame", "assistsPerGame", "valuation", "trueShootingPct"];
export const MAX_PLAYERS = 10;
export const MAX_FORMULAS = 3;
export const MAX_VIEWS = 5;

const FORMULA_PREFIX = "f:";
// The pre-2026-10-14 builder keyed formula columns "custom:<id>".
const LEGACY_FORMULA_PREFIX = "custom:";

export function columnId(c: ColumnRef): string {
  return c.kind === "stat" ? c.key : FORMULA_PREFIX + c.id;
}

export function decodeView(view: AnalyticsView): Workspace {
  const formulas = new Map(view.customColumns.map((cc) => [cc.id, cc]));
  const placed = new Set<string>();
  const columns: ColumnRef[] = [];
  for (const entry of view.columns) {
    if (entry.startsWith(FORMULA_PREFIX)) {
      const cc = formulas.get(entry.slice(FORMULA_PREFIX.length));
      if (cc && !placed.has(cc.id)) {
        placed.add(cc.id);
        columns.push({ kind: "formula", id: cc.id, label: cc.label, expression: cc.expression });
      }
    } else {
      const stat = statByKey(entry);
      if (stat) columns.push({ kind: "stat", key: stat.key });
    }
  }
  for (const cc of view.customColumns) {
    if (!placed.has(cc.id)) columns.push({ kind: "formula", id: cc.id, label: cc.label, expression: cc.expression });
  }

  let sortId = view.sortKey;
  if (sortId?.startsWith(LEGACY_FORMULA_PREFIX)) sortId = FORMULA_PREFIX + sortId.slice(LEGACY_FORMULA_PREFIX.length);
  const ids = columns.map(columnId);
  if (!sortId || !ids.includes(sortId)) sortId = ids[0] ?? null;

  return {
    playerIds: [...view.playerIds],
    columns,
    sort: sortId ? { columnId: sortId, desc: view.sortDesc } : null,
  };
}

export function encodeWorkspace(ws: Workspace, name: string): ViewBody {
  return {
    name,
    playerIds: [...ws.playerIds],
    columns: ws.columns.map(columnId),
    customColumns: ws.columns.flatMap((c) => (c.kind === "formula" ? [{ id: c.id, label: c.label, expression: c.expression }] : [])),
    sortKey: ws.sort?.columnId ?? (ws.columns[0] ? columnId(ws.columns[0]) : null),
    sortDesc: ws.sort?.desc ?? true,
  };
}

export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  return JSON.stringify(encodeWorkspace(a, "")) === JSON.stringify(encodeWorkspace(b, ""));
}
