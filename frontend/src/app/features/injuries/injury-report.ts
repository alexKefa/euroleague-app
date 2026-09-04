import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { InjuryReportEntry, InjuryStatus, RosterEntry, Team } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { TeamCodePipe, displayTeamCode } from "../../shared/team-display-code";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { ButtonDirective } from "../../shared/button.directive";
import { injuryStatusLabel, injuryStatusClass } from "../../shared/injury-status";

interface TeamGroup {
  teamId: string;
  teamName: string;
  teamCode: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  entries: InjuryReportEntry[];
}

const STATUS_ORDER: Record<InjuryStatus, number> = { out: 0, doubtful: 1, questionable: 2, probable: 3 };
const STATUSES: InjuryStatus[] = ["out", "doubtful", "questionable", "probable"];

@Component({
  selector: "app-injury-report",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    RetryImgDirective,
    SkeletonComponent,
    PlayerPhotoComponent,
    TeamCodePipe,
    DropdownComponent,
    ButtonDirective,
  ],
  templateUrl: "./injury-report.html",
})
export class InjuryReportComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly entries = signal<InjuryReportEntry[]>([]);

  // Grouped by team (basketnews.com's own layout this mirrors groups the
  // same way) — worst-first within a team, since "who's actually out"
  // matters more than alphabetical order.
  readonly groups = computed<TeamGroup[]>(() => {
    const byTeam = new Map<string, TeamGroup>();
    for (const e of this.entries()) {
      let g = byTeam.get(e.teamId);
      if (!g) {
        g = {
          teamId: e.teamId,
          teamName: e.teamName,
          teamCode: e.teamCode,
          teamLogoUrl: e.teamLogoUrl,
          teamPrimaryColor: e.teamPrimaryColor,
          entries: [],
        };
        byTeam.set(e.teamId, g);
      }
      g.entries.push(e);
    }
    for (const g of byTeam.values()) {
      g.entries.sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.playerName.localeCompare(b.playerName)
      );
    }
    return [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
  });

  statusLabel(status: InjuryStatus): string {
    return injuryStatusLabel(this.i18n, status);
  }

  statusClass(status: InjuryStatus): string {
    return injuryStatusClass(status);
  }

  // --- Admin tools: report a new injury, or edit/remove one inline ---
  // Team picked first, then its roster loads on demand for the player
  // dropdown (same "fetch a team's roster only when needed" spirit as the
  // Teams hub), rather than loading all ~200 players across the league up
  // front just for this form. Moved here from Profile 2026-09-04 so admin
  // tools live on the page they act on, not a separate settings page.
  readonly adminTeams = signal<Team[]>([]);
  readonly adminRoster = signal<RosterEntry[]>([]);
  readonly adminSubmitting = signal(false);
  readonly adminError = signal<string | null>(null);
  readonly adminSuccess = signal<string | null>(null);
  readonly adminForm = this.fb.nonNullable.group({
    teamId: ["", [Validators.required]],
    playerId: ["", [Validators.required]],
    status: ["out", [Validators.required]],
    note: [""],
  });
  readonly adminTeamDropdownOptions = computed<DropdownOption[]>(() =>
    this.adminTeams().map((t) => ({ value: t.id, label: displayTeamCode(t.code), logoUrl: t.logoUrl }))
  );
  readonly adminPlayerDropdownOptions = computed<DropdownOption[]>(() =>
    this.adminRoster().map((r) => ({ value: r.player.id, label: r.player.name }))
  );
  readonly statusDropdownOptions = computed<DropdownOption[]>(() =>
    STATUSES.map((s) => ({ value: s, label: this.statusLabel(s) }))
  );

  // Inline edit — at most one row editing at a time, keyed by playerId.
  readonly editingPlayerId = signal<string | null>(null);
  readonly editForm = this.fb.nonNullable.group({
    status: ["out", [Validators.required]],
    note: [""],
  });
  readonly editSaving = signal(false);

  ngOnInit(): void {
    this.refreshInjuries();
    if (this.auth.currentUser()?.isAdmin) {
      this.api.getTeams().subscribe({ next: (rows) => this.adminTeams.set(rows), error: () => {} });
    }
  }

  private refreshInjuries(): void {
    this.loading.set(true);
    this.api.getInjuries().subscribe({
      next: (rows) => {
        this.entries.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  onAdminTeamSelected(teamId: string | null): void {
    this.adminForm.patchValue({ teamId: teamId ?? "", playerId: "" });
    if (!teamId) {
      this.adminRoster.set([]);
      return;
    }
    this.api.getRoster(teamId).subscribe({ next: (rows) => this.adminRoster.set(rows), error: () => {} });
  }

  submitReport(): void {
    if (this.adminForm.invalid) return;
    this.adminSubmitting.set(true);
    this.adminError.set(null);
    this.adminSuccess.set(null);

    const { playerId, status, note } = this.adminForm.getRawValue();
    const injuryStatus = status as InjuryStatus;
    const player = this.adminRoster().find((r) => r.player.id === playerId)?.player;
    this.api.setInjury(playerId, injuryStatus, note || undefined).subscribe({
      next: () => {
        this.adminSubmitting.set(false);
        this.adminSuccess.set(
          `${this.i18n.t("injuries.adminSetFor")} ${player?.name ?? ""} (${this.statusLabel(injuryStatus)}).`
        );
        this.adminForm.patchValue({ playerId: "", note: "" });
        this.refreshInjuries();
      },
      error: (err) => {
        this.adminSubmitting.set(false);
        this.adminError.set(
          (err as { error?: { error?: string } })?.error?.error ?? this.i18n.t("injuries.adminSetFailed")
        );
      },
    });
  }

  startEdit(entry: InjuryReportEntry): void {
    this.editingPlayerId.set(entry.playerId);
    this.editForm.setValue({ status: entry.status, note: entry.note ?? "" });
  }

  cancelEdit(): void {
    this.editingPlayerId.set(null);
  }

  saveEdit(entry: InjuryReportEntry): void {
    if (this.editForm.invalid) return;
    this.editSaving.set(true);
    const { status, note } = this.editForm.getRawValue();
    this.api.setInjury(entry.playerId, status as InjuryStatus, note || undefined).subscribe({
      next: () => {
        this.editSaving.set(false);
        this.editingPlayerId.set(null);
        this.refreshInjuries();
      },
      error: () => {
        this.editSaving.set(false);
      },
    });
  }

  removeReport(entry: InjuryReportEntry): void {
    this.api.clearInjury(entry.playerId).subscribe({
      next: () => {
        if (this.editingPlayerId() === entry.playerId) this.editingPlayerId.set(null);
        this.refreshInjuries();
      },
      error: () => {},
    });
  }
}
