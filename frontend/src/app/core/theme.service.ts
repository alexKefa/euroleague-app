import { Injectable, signal } from "@angular/core";
import { Team } from "./models";

const DEFAULT_PRIMARY = "#3E7CB1";
const DEFAULT_SECONDARY = "#0B1220";
const DEFAULT_THEME_COLOR = "#0b1220";

export type ColorScheme = "dark" | "light";
const COLOR_SCHEME_KEY = "clutch-color-scheme";
const ACCENT_COLORS_KEY = "clutch-accent-colors";
const PINCH_ZOOM_KEY = "clutch-pinch-zoom-enabled";
// Mirrors index.html's own static default (viewport-meta) — kept here too
// so re-enabling can restore the exact original content, not a guess.
const VIEWPORT_ZOOM_DISABLED = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
const VIEWPORT_ZOOM_ENABLED = "width=device-width, initial-scale=1, viewport-fit=cover";

@Injectable({ providedIn: "root" })
export class ThemeService {
  readonly favoriteTeam = signal<Team | null>(null);

  // Dark is the app's designed-for default (see CLAUDE.md's dark "Scoreboard"
  // theme) — only switch to light if the user explicitly chose it before.
  readonly colorScheme = signal<ColorScheme>(this.loadColorScheme());

  // Pinch/double-tap zoom is disabled by default (index.html's static
  // viewport meta already ships that way, so this only ever needs to
  // *loosen* it, never tighten it, before this service's constructor runs)
  // — opt-in re-enable from Profile, not opt-out.
  readonly pinchZoomEnabled = signal<boolean>(this.loadPinchZoomEnabled());

  constructor() {
    this.applyColorScheme(this.colorScheme());
    this.applyPinchZoom(this.pinchZoomEnabled());
    // applyTeam() only ever gets called once Dashboard loads and resolves
    // the user's favorite team, so a refresh landing anywhere else showed
    // the default blue accent/ambient glow until you visited Dashboard.
    // Re-apply the last-known colors immediately on boot so every page
    // starts correctly themed; Dashboard's own applyTeam() call still fires
    // afterward with fresh data and overwrites this if needed. Team/player
    // detail pages deliberately do NOT call applyTeam() with the team being
    // viewed (that used to reskin the whole app, including this ambient
    // glow, to whatever team you were just browsing) — they render their
    // own hero directly from that team's colors instead, so the global
    // accent only ever reflects the user's actual favorite team.
    this.applyCachedAccentColors();
  }

  applyTeam(team: Team | null): void {
    this.favoriteTeam.set(team);
    const primary = team?.primaryColor ?? DEFAULT_PRIMARY;
    const secondary = team?.secondaryColor ?? DEFAULT_SECONDARY;
    const root = document.documentElement;
    root.style.setProperty("--accent-primary", primary);
    root.style.setProperty("--accent-secondary", secondary);
    this.applyThemeColor(team ? primary : null);

    if (team) {
      try {
        localStorage.setItem(ACCENT_COLORS_KEY, JSON.stringify({ primary, secondary }));
      } catch {
        // Private-browsing/storage-disabled — theming still works for the
        // current session, it just won't be cached for the next boot.
      }
    }
  }

  private applyCachedAccentColors(): void {
    try {
      const cached = localStorage.getItem(ACCENT_COLORS_KEY);
      if (!cached) return;
      const { primary, secondary } = JSON.parse(cached);
      if (typeof primary !== "string" || typeof secondary !== "string") return;
      const root = document.documentElement;
      root.style.setProperty("--accent-primary", primary);
      root.style.setProperty("--accent-secondary", secondary);
      this.applyThemeColor(primary);
    } catch {
      // Malformed/inaccessible cache — falls back to the CSS defaults,
      // same as before this cache existed.
    }
  }

  // Tints the mobile browser chrome (address bar, "recent apps" card) to
  // the team's accent — kept even though the favicon swap it originally
  // shipped alongside was reverted (the app keeps its own logo as favicon).
  private applyThemeColor(primary: string | null): void {
    document
      .getElementById("theme-color-meta")
      ?.setAttribute("content", primary ?? DEFAULT_THEME_COLOR);
  }

  setColorScheme(scheme: ColorScheme): void {
    this.colorScheme.set(scheme);
    this.applyColorScheme(scheme);
    try {
      localStorage.setItem(COLOR_SCHEME_KEY, scheme);
    } catch {
      // Private-browsing/storage-disabled — the toggle still works for the
      // current session, it just won't persist across reloads.
    }
  }

  private applyColorScheme(scheme: ColorScheme): void {
    document.documentElement.setAttribute("data-theme", scheme);
  }

  private loadColorScheme(): ColorScheme {
    try {
      return localStorage.getItem(COLOR_SCHEME_KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  }

  setPinchZoomEnabled(enabled: boolean): void {
    this.pinchZoomEnabled.set(enabled);
    this.applyPinchZoom(enabled);
    try {
      localStorage.setItem(PINCH_ZOOM_KEY, enabled ? "true" : "false");
    } catch {
      // Private-browsing/storage-disabled — the toggle still works for the
      // current session, it just won't persist across reloads.
    }
  }

  private applyPinchZoom(enabled: boolean): void {
    document
      .getElementById("viewport-meta")
      ?.setAttribute("content", enabled ? VIEWPORT_ZOOM_ENABLED : VIEWPORT_ZOOM_DISABLED);
  }

  private loadPinchZoomEnabled(): boolean {
    try {
      return localStorage.getItem(PINCH_ZOOM_KEY) === "true";
    } catch {
      return false;
    }
  }
}
