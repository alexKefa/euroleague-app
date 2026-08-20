import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { Team } from "../../core/models";

@Component({
  selector: "app-profile",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./profile.html",
})
export class ProfileComponent implements OnInit {
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private api = inject(ApiService);
  private router = inject(Router);

  readonly teams = signal<Team[]>([]);
  readonly savingTeamId = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getTeams().subscribe({ next: (rows) => this.teams.set(rows), error: () => {} });
  }

  setFavoriteTeam(teamId: string): void {
    if (this.savingTeamId()) return;
    const current = this.auth.currentUser()?.favoriteTeamId;
    const next = current === teamId ? null : teamId;

    this.savingTeamId.set(teamId);
    this.saveError.set(null);

    this.auth.updateFavoriteTeam(next).subscribe({
      next: () => this.savingTeamId.set(null),
      error: () => {
        this.savingTeamId.set(null);
        this.saveError.set("Couldn't update your favorite team — try again.");
      },
    });
  }

  logout(): void {
    this.auth.logout().subscribe({ next: () => this.router.navigateByUrl("/") });
  }
}
