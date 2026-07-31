import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { Team, RosterEntry } from "../../core/models";

@Component({
  selector: "app-team-roster",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./roster.html",
})
export class TeamRosterComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private theme = inject(ThemeService);

  readonly team = signal<Team | null>(null);
  readonly roster = signal<RosterEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const teamId = this.route.snapshot.paramMap.get("id");
    if (!teamId) {
      this.error.set("No team specified.");
      this.loading.set(false);
      return;
    }

    // Team list doesn't have a single-team-by-id endpoint yet, so pull
    // it from the full list — fine at 20 teams, worth a dedicated
    // GET /api/teams/:id if this ever needs to scale.
    this.api.getTeams().subscribe({
      next: (teams) => {
        const team = teams.find((t) => t.id === teamId) ?? null;
        this.team.set(team);
        this.theme.applyTeam(team);
      },
    });

    this.api.getRoster(teamId).subscribe({
      next: (rows) => {
        this.roster.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Couldn't load the roster.");
        this.loading.set(false);
      },
    });
  }
}