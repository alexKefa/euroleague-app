import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from "@angular/core";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { ThemeService } from "../core/theme.service";
import { I18nService } from "../core/i18n.service";
import { Team } from "../core/models";
import { RetryImgDirective } from "./retry-img.directive";
import { TeamCodePipe } from "./team-display-code";
import { SkeletonComponent } from "./skeleton";
import { LogoSpinnerComponent } from "./logo-spinner";

// First shown once, right after a successful registration (register.
// component.ts, mounted on `showTeamDialog()` — never re-checked against
// any stored flag since it's driven directly by the register event itself,
// not a page load), then reused as-is by Profile's own "change team" button
// (2026-09-15, same day) so both entry points share one picking experience
// instead of Profile keeping its own separate wrapped-chip grid. Fetches
// its own team list rather than taking one as an input, so it stays a
// drop-in component wherever it's mounted — a caller only ever needs to
// pass `currentTeamId` (for the tap-to-clear highlight) and listen for
// `(closed)`.
@Component({
  selector: "app-team-pick-dialog",
  standalone: true,
  imports: [RetryImgDirective, TeamCodePipe, SkeletonComponent, LogoSpinnerComponent],
  templateUrl: "./team-pick-dialog.html",
  styleUrl: "./team-pick-dialog.css",
})
export class TeamPickDialogComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private theme = inject(ThemeService);
  protected i18n = inject(I18nService);

  // null from register (nothing picked yet). Profile passes the user's
  // existing favoriteTeamId so the grid can highlight it and tapping that
  // same team again clears it instead of just re-confirming it — the exact
  // toggle-off behavior profile.ts's old setFavoriteTeam had.
  @Input() currentTeamId: string | null = null;
  // Register's "Skip for now" doesn't fit Profile revisiting a choice it
  // already made — Profile passes the auth.pickTeamCancel key instead.
  @Input() dismissLabelKey = "auth.pickTeamSkip";
  @Output() closed = new EventEmitter<void>();

  readonly teams = signal<Team[]>([]);
  readonly loading = signal(true);
  readonly savingTeamId = signal<string | null>(null);
  readonly confirmedTeam = signal<Team | null>(null);
  readonly saveError = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getTeams().subscribe({
      next: (rows) => {
        this.teams.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  pick(team: Team): void {
    if (this.savingTeamId() || this.confirmedTeam()) return;
    const clearing = this.currentTeamId === team.id;

    this.savingTeamId.set(team.id);
    this.saveError.set(null);

    this.auth.updateFavoriteTeam(clearing ? null : team.id).subscribe({
      next: () => {
        // Reskin immediately, same "instant, not stale until the next
        // navigation" reasoning as profile.ts's old setFavoriteTeam.
        this.theme.applyTeam(clearing ? null : team);
        this.savingTeamId.set(null);
        if (clearing) {
          // Nothing to celebrate about removing a pick — close right away
          // rather than playing the "you're all set" success beat.
          this.closed.emit();
        } else {
          this.confirmedTeam.set(team);
          setTimeout(() => this.closed.emit(), 1500);
        }
      },
      error: () => {
        this.savingTeamId.set(null);
        this.saveError.set(this.i18n.t("profile.saveTeamFailed"));
      },
    });
  }

  skip(): void {
    if (this.confirmedTeam()) return;
    this.closed.emit();
  }
}
