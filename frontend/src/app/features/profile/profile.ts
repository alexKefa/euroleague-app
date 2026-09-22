import { Component, OnInit, OnDestroy, ElementRef, viewChild, effect, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { forkJoin } from "rxjs";
import { AuthService } from "../../core/auth.service";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { ThemeService } from "../../core/theme.service";
import { Team, Collectible, CollectibleFinish } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { CollectibleCardComponent } from "../store/collectible-card";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { SkeletonComponent } from "../../shared/skeleton";
import { TeamPickDialogComponent } from "../../shared/team-pick-dialog";
import { TeamCodePipe } from "../../shared/team-display-code";
import { NavIconComponent } from "../../shared/nav-icon";

const MAX_SHOWCASE_CARDS = 3;
// Matches inventory.ts's own PAGE_SIZE — same "reveal a page at a time"
// reasoning: a collector with a few hundred owned cards rendering every
// app-collectible-card in the picker at once got laggy, same DOM-size
// problem inventory.ts already solved this way, not a fetch-size one
// (the full owned list is already fetched in one shot either way).
const PAGE_SIZE = 20;

@Component({
  selector: "app-profile",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    RetryImgDirective,
    ButtonDirective,
    ChipDirective,
    CollectibleCardComponent,
    LogoSpinnerComponent,
    SkeletonComponent,
    TeamPickDialogComponent,
    TeamCodePipe,
    NavIconComponent,
  ],
  templateUrl: "./profile.html",
})
export class ProfileComponent implements OnInit, OnDestroy {
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected theme = inject(ThemeService);
  private api = inject(ApiService);
  private router = inject(Router);

  readonly teams = signal<Team[]>([]);
  // Team picking now goes through the same modal register.ts uses
  // (shared/team-pick-dialog.ts, 2026-09-15) instead of this page's own
  // inline chip grid — the dialog owns its own saving/error state, this
  // page just needs to know whether it's open and which team is current.
  readonly showTeamDialog = signal(false);
  readonly currentFavoriteTeam = computed(
    () => this.teams().find((t) => t.id === this.auth.currentUser()?.favoriteTeamId) ?? null
  );

  // Editing the auto-generated "clutch-user-######" handle every account
  // gets at registration (services/username.ts) — same validation rules
  // the register form already enforces, reused here via the same error
  // codes (INVALID_USERNAME/USERNAME_TAKEN) the backend returns.
  readonly editingUsername = signal(false);
  readonly usernameInput = signal("");
  readonly usernameSaving = signal(false);
  readonly usernameError = signal<string | null>(null);

  startEditingUsername(): void {
    this.usernameInput.set(this.auth.currentUser()?.username ?? "");
    this.usernameError.set(null);
    this.editingUsername.set(true);
  }

  cancelEditingUsername(): void {
    this.editingUsername.set(false);
    this.usernameError.set(null);
  }

  saveUsername(): void {
    const trimmed = this.usernameInput().trim();
    if (this.usernameSaving() || !trimmed || trimmed === this.auth.currentUser()?.username) {
      if (trimmed === this.auth.currentUser()?.username) this.editingUsername.set(false);
      return;
    }

    this.usernameSaving.set(true);
    this.usernameError.set(null);

    this.auth.updateUsername(trimmed).subscribe({
      next: () => {
        this.usernameSaving.set(false);
        this.editingUsername.set(false);
      },
      error: (err) => {
        this.usernameSaving.set(false);
        const code = (err as { error?: { code?: string } } | undefined)?.error?.code;
        this.usernameError.set(
          code === "USERNAME_TAKEN"
            ? this.i18n.t("auth.usernameTaken")
            : code === "INVALID_USERNAME"
              ? this.i18n.t("auth.usernameInvalid")
              : this.i18n.t("profile.usernameSaveFailed")
        );
      },
    });
  }

  readonly referralLink = computed(() => {
    const code = this.auth.currentUser()?.referralCode;
    return code ? `${location.origin}/register?ref=${code}` : null;
  });
  readonly referralCopied = signal(false);

  // Showcase cards — which of the user's owned collectibles show up next to
  // their name on a league leaderboard (routes/leagues.ts). allCollectibles
  // + ownedIds mirror inventory.ts's exact "fetch the full catalog, cross-
  // reference against GET /collectibles/me" pattern, since a showcase pick
  // needs the same name/tier/team/imageUrl inventory shows, not just an id.
  private readonly allCollectibles = signal<Collectible[]>([]);
  private readonly ownedCollectibleIds = signal<ReadonlySet<string>>(new Set());
  // Catalog rows (allCollectibles) don't carry a per-user finish — see
  // Collectible.finish's doc comment — so it's tracked separately from the
  // same GET /collectibles/me response ownedCollectibleIds is built from,
  // same "cross-reference the catalog against my owned copies" split as
  // inventory.ts's finishByCollectibleId/finishFor.
  private readonly finishByCollectibleId = signal<ReadonlyMap<string, CollectibleFinish>>(new Map());
  finishFor(card: { id: string }): CollectibleFinish {
    return this.finishByCollectibleId().get(card.id) ?? "standard";
  }

  // True until both requests behind myOwnedCollectibles resolve (2026-09-22,
  // "cards i own come as async... it loads with the container and page goes
  // up or down") — the showcase card was gated on
  // `myOwnedCollectibles().length > 0`, which is also false while still
  // loading (both source signals start empty), so nothing at all reserved
  // the space this section eventually takes. The section popping in fully
  // formed once the fetch resolved is what shifted the rest of the page up
  // or down under the reader's scroll position. profile.html now renders a
  // same-shaped skeleton while this is true instead of rendering nothing.
  readonly ownedCollectiblesLoading = signal(true);
  readonly myOwnedCollectibles = computed(() =>
    this.allCollectibles().filter((c) => this.ownedCollectibleIds().has(c.id))
  );

  // Windowed reveal of myOwnedCollectibles — see PAGE_SIZE's doc comment.
  // The picker scrolls inside its own fixed-height box (not the page), so
  // the IntersectionObserver below is rooted at that container element
  // rather than the viewport (inventory.ts's page-level version leaves
  // `root` unset for exactly the opposite reason).
  readonly visibleCount = signal(PAGE_SIZE);
  readonly loadingMoreOwned = signal(false);
  readonly visibleOwnedCollectibles = computed(() => this.myOwnedCollectibles().slice(0, this.visibleCount()));
  readonly hasMoreOwned = computed(() => this.visibleCount() < this.myOwnedCollectibles().length);

  private readonly ownedScrollContainer = viewChild<ElementRef<HTMLDivElement>>("ownedScrollContainer");
  private readonly ownedSentinel = viewChild<ElementRef<HTMLDivElement>>("ownedScrollSentinel");
  private ownedObserver?: IntersectionObserver;

  readonly showcaseSelected = signal<ReadonlySet<string>>(new Set());
  readonly showcaseSaving = signal(false);
  readonly showcaseSaved = signal(false);
  readonly showcaseError = signal<string | null>(null);
  readonly showcaseDirty = computed(() => {
    const saved = new Set(this.auth.currentUser()?.showcaseCollectibleIds ?? []);
    const selected = this.showcaseSelected();
    return saved.size !== selected.size || [...selected].some((id) => !saved.has(id));
  });

  constructor() {
    effect(() => {
      const root = this.ownedScrollContainer()?.nativeElement;
      const sentinel = this.ownedSentinel()?.nativeElement;
      this.ownedObserver?.disconnect();
      if (!root || !sentinel) return;
      this.ownedObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) this.loadMoreOwned();
        },
        { root, rootMargin: "200px" }
      );
      this.ownedObserver.observe(sentinel);
    });
  }

  loadMoreOwned(): void {
    if (this.loadingMoreOwned() || !this.hasMoreOwned()) return;
    this.loadingMoreOwned.set(true);
    // Deferred a tick so the loader actually gets to paint before the
    // comparatively expensive DOM work of revealing the next page runs —
    // same reasoning as inventory.ts's loadMore().
    setTimeout(() => {
      this.visibleCount.update((n) => n + PAGE_SIZE);
      this.loadingMoreOwned.set(false);
    });
  }

  ngOnDestroy(): void {
    this.ownedObserver?.disconnect();
  }

  ngOnInit(): void {
    this.api.getTeams().subscribe({ next: (rows) => this.teams.set(rows), error: () => {} });

    if (this.auth.isAuthenticated()) {
      forkJoin({
        collectibles: this.api.getCollectibles(),
        mine: this.api.getMyCollectibles(),
      }).subscribe({
        next: ({ collectibles, mine }) => {
          this.allCollectibles.set(collectibles);
          this.ownedCollectibleIds.set(new Set(mine.map((r) => r.collectibleId)));
          this.finishByCollectibleId.set(new Map(mine.map((r) => [r.collectibleId, r.finish])));
          this.ownedCollectiblesLoading.set(false);
        },
        error: () => this.ownedCollectiblesLoading.set(false),
      });
      this.showcaseSelected.set(new Set(this.auth.currentUser()?.showcaseCollectibleIds ?? []));
    } else {
      this.ownedCollectiblesLoading.set(false);
    }
  }

  toggleShowcase(collectibleId: string): void {
    const next = new Set(this.showcaseSelected());
    if (next.has(collectibleId)) {
      next.delete(collectibleId);
    } else {
      if (next.size >= MAX_SHOWCASE_CARDS) {
        this.showcaseError.set(this.i18n.t("profile.showcaseMaxReached"));
        return;
      }
      next.add(collectibleId);
    }
    this.showcaseError.set(null);
    this.showcaseSelected.set(next);
  }

  saveShowcase(): void {
    if (this.showcaseSaving()) return;
    this.showcaseSaving.set(true);
    this.showcaseError.set(null);
    this.showcaseSaved.set(false);

    this.auth.updateShowcase(Array.from(this.showcaseSelected())).subscribe({
      next: () => {
        this.showcaseSaving.set(false);
        this.showcaseSaved.set(true);
        setTimeout(() => this.showcaseSaved.set(false), 2000);
      },
      error: () => {
        this.showcaseSaving.set(false);
        this.showcaseError.set(this.i18n.t("profile.showcaseSaveFailed"));
      },
    });
  }

  logout(): void {
    this.auth.logout().subscribe({ next: () => this.router.navigateByUrl("/") });
  }

  copyReferralLink(): void {
    const link = this.referralLink();
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      this.referralCopied.set(true);
      setTimeout(() => this.referralCopied.set(false), 2000);
    });
  }

}
