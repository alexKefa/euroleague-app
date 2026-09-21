import { Component, HostListener, inject, input, signal } from "@angular/core";
import { I18nService } from "../core/i18n.service";
import { FantasyLeaderboardEntry, FantasySquadPreviewPlayer } from "../core/models";
import { PlayerPhotoComponent } from "./player-photo";
import { rankBadgeClasses, rankRowClasses } from "./rank-badge";
import { CollectibleCardComponent } from "../features/store/collectible-card";
import { CourtBackgroundComponent } from "./court-background";
import { COURT_POSITION_TOP, spreadCourtX } from "./court-position";

// Shared premium row + detail-modal rendering for a Fantasy Five leaderboard
// — used identically by the Fantasy Five page's own Leaderboard tab and by
// League Detail's Fantasy tab, so the "team preview icon (locked pre-round,
// coach badge once revealed) + Round/Total PIR + fantasy points" design
// only needs to exist and be maintained once, in one place, rather than
// copy-pasted into two feature templates that would inevitably drift.
@Component({
  selector: "app-fantasy-leaderboard-list",
  standalone: true,
  imports: [PlayerPhotoComponent, CollectibleCardComponent, CourtBackgroundComponent],
  templateUrl: "./fantasy-leaderboard-list.html",
})
export class FantasyLeaderboardListComponent {
  protected i18n = inject(I18nService);

  readonly entries = input<FantasyLeaderboardEntry[]>([]);
  readonly emptyLabel = input<string>("");

  readonly selectedEntry = signal<FantasyLeaderboardEntry | null>(null);
  protected readonly rankBadgeClasses = rankBadgeClasses;
  protected readonly rankRowClasses = rankRowClasses;

  openEntry(entry: FantasyLeaderboardEntry): void {
    this.selectedEntry.set(entry);
  }

  closeEntry(): void {
    this.selectedEntry.set(null);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.closeEntry();
  }

  protected posAbbrev(position: string | null): string {
    switch (position) {
      case "Guard":
        return this.i18n.t("fantasy.posGuardAbbrev");
      case "Forward":
        return this.i18n.t("fantasy.posForwardAbbrev");
      case "Center":
        return this.i18n.t("fantasy.posCenterAbbrev");
      default:
        return "";
    }
  }

  protected starters(squad: FantasySquadPreviewPlayer[]): FantasySquadPreviewPlayer[] {
    return squad.filter((p) => p.slotRole === "starter");
  }

  protected sixthMan(squad: FantasySquadPreviewPlayer[]): FantasySquadPreviewPlayer | null {
    return squad.find((p) => p.slotRole === "sixth_man") ?? null;
  }

  protected bench(squad: FantasySquadPreviewPlayer[]): FantasySquadPreviewPlayer[] {
    return squad.filter((p) => p.slotRole === "bench");
  }

  // Cosmetic court coordinates for the 5 starters, grouped by real position
  // (not by a formation index — see court-position.ts's doc comment on why
  // another user's saved squad can't be assumed to fit one of this app's 5
  // named formations the way the viewer's own roster-builder squad can).
  protected starterCourtPositions(squad: FantasySquadPreviewPlayer[]): { left: number; top: number }[] {
    const starters = this.starters(squad);
    const totalByPos: Record<string, number> = {};
    for (const p of starters) {
      const key = p.position ?? "Unknown";
      totalByPos[key] = (totalByPos[key] ?? 0) + 1;
    }
    const seenByPos: Record<string, number> = {};
    return starters.map((p) => {
      const key = p.position ?? "Unknown";
      const top = COURT_POSITION_TOP[key] ?? 50;
      const xs = spreadCourtX(totalByPos[key]);
      const idx = seenByPos[key] ?? 0;
      seenByPos[key] = idx + 1;
      return { left: xs[idx], top };
    });
  }
}
