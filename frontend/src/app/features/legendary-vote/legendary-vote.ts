import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { LegendaryPoll, LegendaryPollCandidateOption } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHintComponent } from "../../shared/page-hint";
import { SkeletonComponent } from "../../shared/skeleton";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";

@Component({
  selector: "app-legendary-vote",
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonDirective, PageHintComponent, SkeletonComponent, ConfirmDialogComponent],
  templateUrl: "./legendary-vote.html",
})
export class LegendaryVoteComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly loading = signal(true);
  readonly polls = signal<LegendaryPoll[]>([]);
  readonly openPolls = computed(() => this.polls().filter((p) => p.status === "open"));
  readonly closedPolls = computed(() => this.polls().filter((p) => p.status === "closed"));

  // Per-poll in-flight/error state, keyed by poll id — several polls can be
  // open at once and each votes independently.
  readonly votingPollId = signal<string | null>(null);
  readonly voteErrorByPoll = signal<Record<string, string>>({});
  readonly closingPollId = signal<string | null>(null);
  readonly confirmingClosePollId = signal<string | null>(null);

  // Admin-only "create a poll" panel.
  readonly showCreate = signal(false);
  readonly newTitle = signal("");
  readonly candidateSearch = signal("");
  readonly candidateOptions = signal<LegendaryPollCandidateOption[]>([]);
  readonly selectedCandidateIds = signal<string[]>([]);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  static readonly MAX_CANDIDATES = 8;

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }
    this.refresh();
  }

  private refresh(): void {
    this.api.getLegendaryPolls().subscribe({
      next: (rows) => {
        this.polls.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Backend returns a stable `code` alongside its English `error` text, same
  // pattern as leagues.ts's errorMessage.
  private errorMessage(err: unknown, fallbackKey: string): string {
    const body = (err as { error?: { code?: string; error?: string } } | undefined)?.error;
    const key = body?.code ? `legendaryVote.err.${body.code}` : undefined;
    const translated = key ? this.i18n.t(key) : undefined;
    if (translated && translated !== key) return translated;
    return body?.error ?? this.i18n.t(fallbackKey);
  }

  votePercent(voteCount: number, poll: LegendaryPoll): number {
    return poll.totalVotes > 0 ? Math.round((voteCount / poll.totalVotes) * 100) : 0;
  }

  private replacePoll(updated: LegendaryPoll): void {
    this.polls.set(this.polls().map((p) => (p.id === updated.id ? updated : p)));
  }

  private clearVoteError(pollId: string): void {
    const { [pollId]: _removed, ...rest } = this.voteErrorByPoll();
    this.voteErrorByPoll.set(rest);
  }

  vote(poll: LegendaryPoll, candidateId: string): void {
    if (this.votingPollId()) return;
    this.votingPollId.set(poll.id);
    this.clearVoteError(poll.id);
    this.api.voteLegendaryPoll(poll.id, candidateId).subscribe({
      next: (updated) => {
        this.votingPollId.set(null);
        this.replacePoll(updated);
      },
      error: (err) => {
        this.votingPollId.set(null);
        this.voteErrorByPoll.set({ ...this.voteErrorByPoll(), [poll.id]: this.errorMessage(err, "legendaryVote.voteFailed") });
      },
    });
  }

  removeVote(poll: LegendaryPoll): void {
    if (this.votingPollId()) return;
    this.votingPollId.set(poll.id);
    this.clearVoteError(poll.id);
    this.api.removeLegendaryPollVote(poll.id).subscribe({
      next: (updated) => {
        this.votingPollId.set(null);
        this.replacePoll(updated);
      },
      error: (err) => {
        this.votingPollId.set(null);
        this.voteErrorByPoll.set({ ...this.voteErrorByPoll(), [poll.id]: this.errorMessage(err, "legendaryVote.voteFailed") });
      },
    });
  }

  // --- Admin: create a poll ---

  toggleCreate(): void {
    const next = !this.showCreate();
    this.showCreate.set(next);
    if (next && this.candidateOptions().length === 0) this.searchCandidates();
  }

  searchCandidates(): void {
    this.api.getLegendaryPollCandidateOptions(this.candidateSearch().trim() || undefined).subscribe({
      next: (rows) => this.candidateOptions.set(rows),
      error: () => this.candidateOptions.set([]),
    });
  }

  isSelected(id: string): boolean {
    return this.selectedCandidateIds().includes(id);
  }

  toggleCandidate(id: string): void {
    const current = this.selectedCandidateIds();
    if (current.includes(id)) {
      this.selectedCandidateIds.set(current.filter((c) => c !== id));
    } else if (current.length < LegendaryVoteComponent.MAX_CANDIDATES) {
      this.selectedCandidateIds.set([...current, id]);
    }
  }

  get canCreate(): boolean {
    return this.newTitle().trim().length > 0 && this.selectedCandidateIds().length >= 2 && !this.creating();
  }

  createPoll(): void {
    if (!this.canCreate) return;
    this.creating.set(true);
    this.createError.set(null);
    this.api.createLegendaryPoll(this.newTitle().trim(), this.selectedCandidateIds()).subscribe({
      next: (poll) => {
        this.creating.set(false);
        this.polls.set([poll, ...this.polls()]);
        this.newTitle.set("");
        this.selectedCandidateIds.set([]);
        this.candidateSearch.set("");
        this.showCreate.set(false);
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(this.errorMessage(err, "legendaryVote.createFailed"));
      },
    });
  }

  requestClose(pollId: string): void {
    this.confirmingClosePollId.set(pollId);
  }

  closePoll(poll: LegendaryPoll): void {
    this.confirmingClosePollId.set(null);
    this.closingPollId.set(poll.id);
    this.api.closeLegendaryPoll(poll.id).subscribe({
      next: (updated) => {
        this.closingPollId.set(null);
        this.replacePoll(updated);
      },
      error: () => this.closingPollId.set(null),
    });
  }
}
