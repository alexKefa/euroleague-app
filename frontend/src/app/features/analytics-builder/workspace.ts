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

// Session snapshot of the open workspace, so drilling into a player page
// and coming back reopens the same view with any unsaved edits intact.
export interface WorkspaceSnapshot {
  activeViewId: string | null;
  workspace: Workspace;
  baseline: Workspace;
}

export function snapshotWorkspace(activeViewId: string | null, workspace: Workspace, baseline: Workspace): string {
  return JSON.stringify({ v: 1, activeViewId, workspace, baseline });
}

function isWorkspace(value: unknown): value is Workspace {
  const ws = value as Workspace | null;
  return (
    !!ws &&
    Array.isArray(ws.playerIds) &&
    ws.playerIds.every((id) => typeof id === "string") &&
    Array.isArray(ws.columns) &&
    ws.columns.every((c) => (c?.kind === "stat" && !!statByKey(c.key)) || (c?.kind === "formula" && typeof c.id === "string" && typeof c.label === "string" && typeof c.expression === "string")) &&
    (ws.sort === null || (typeof ws.sort?.columnId === "string" && typeof ws.sort?.desc === "boolean"))
  );
}

// Null for anything unusable, including a snapshot of a view that has
// since been deleted.
export function parseSnapshot(raw: string | null, views: readonly AnalyticsView[]): WorkspaceSnapshot | null {
  if (!raw) return null;
  let data: { v?: number; activeViewId?: unknown; workspace?: unknown; baseline?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data?.v !== 1 || !isWorkspace(data.workspace) || !isWorkspace(data.baseline)) return null;
  const activeViewId = typeof data.activeViewId === "string" ? data.activeViewId : null;
  if (activeViewId !== null && !views.some((v) => v.id === activeViewId)) return null;
  return { activeViewId, workspace: data.workspace, baseline: data.baseline };
}
