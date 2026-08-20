import { Injectable, signal } from "@angular/core";
import { Team } from "./models";

const DEFAULT_PRIMARY = "#3E7CB1";
const DEFAULT_SECONDARY = "#0B1220";

export type ColorScheme = "dark" | "light";
const COLOR_SCHEME_KEY = "clutch-color-scheme";
const ACCENT_COLORS_KEY = "clutch-accent-colors";

@Injectable({ providedIn: "root" })
export class ThemeService {
  readonly favoriteTeam = signal<Team | null>(null);

  // Dark is the app's designed-for default (see CLAUDE.md's dark "Scoreboard"
  // theme) — only switch to light if the user explicitly chose it before.
  readonly colorScheme = signal<ColorScheme>(this.loadColorScheme());

  constructor() {
    this.applyColorScheme(this.colorScheme());
    // applyTeam() only ever gets called once Dashboard (or a player page)
    // loads and resolves the favorite team, so a refresh landing anywhere
    // else showed the default blue accent/ambient glow until you visited
    // Dashboard. Re-apply the last-known colors immediately on boot so
    // every page starts correctly themed; Dashboard's own applyTeam() call
    // still fires afterward with fresh data and overwrites this if needed.
    this.applyCachedAccentColors();
  }

  applyTeam(team: Team | null): void {
    this.favoriteTeam.set(team);
    const primary = team?.primaryColor ?? DEFAULT_PRIMARY;
    const secondary = team?.secondaryColor ?? DEFAULT_SECONDARY;
    const root = document.documentElement;
    root.style.setProperty("--accent-primary", primary);
    root.style.setProperty("--accent-secondary", secondary);

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
    } catch {
      // Malformed/inaccessible cache — falls back to the CSS defaults,
      // same as before this cache existed.
    }
  }

  toggleColorScheme(): void {
    this.setColorScheme(this.colorScheme() === "dark" ? "light" : "dark");
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
}
