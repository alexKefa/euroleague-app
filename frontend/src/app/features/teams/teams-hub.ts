import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { Team } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ButtonDirective } from "../../shared/button.directive";
import { NavIconComponent } from "../../shared/nav-icon";
import { SearchInputComponent } from "../../shared/search-input";
import { TeamCodePipe, displayTeamCode } from "../../shared/team-display-code";

@Component({
  selector: "app-teams-hub",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, SkeletonComponent, ButtonDirective, NavIconComponent, SearchInputComponent, TeamCodePipe],
  templateUrl: "./teams-hub.html",
})
export class TeamsHubComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly loading = signal(true);
  readonly allTeams = signal<Team[]>([]);
  readonly searchQuery = signal("");

  // Only the lightweight team list loads here (21 rows, no player data) —
  // a given team's roster loads on demand when its card is clicked, via
  // the existing GET /api/teams/:id/roster on the roster page itself.
  readonly teams = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const rows = this.allTeams();
    if (!q) return rows;
    return rows.filter(
      (t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || displayTeamCode(t.code).toLowerCase().includes(q)
    );
  });

  ngOnInit(): void {
    this.api.getTeams().subscribe({
      next: (rows) => {
        this.allTeams.set([...rows].sort((a, b) => a.name.localeCompare(b.name)));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
