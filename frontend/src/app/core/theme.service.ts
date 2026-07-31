import { Injectable, signal } from "@angular/core";
import { Team } from "./models";

const DEFAULT_PRIMARY = "#3E7CB1";
const DEFAULT_SECONDARY = "#0B1220";

@Injectable({ providedIn: "root" })
export class ThemeService {
  readonly favoriteTeam = signal<Team | null>(null);

  applyTeam(team: Team | null): void {
    this.favoriteTeam.set(team);
    const root = document.documentElement;
    root.style.setProperty("--accent-primary", team?.primaryColor ?? DEFAULT_PRIMARY);
    root.style.setProperty("--accent-secondary", team?.secondaryColor ?? DEFAULT_SECONDARY);
  }
}
