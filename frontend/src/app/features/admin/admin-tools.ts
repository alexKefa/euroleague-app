import { Component, viewChild, effect, inject, signal, computed } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { Team, Collectible } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { NavIconComponent } from "../../shared/nav-icon";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { SearchInputComponent } from "../../shared/search-input";
import { UserSearchComponent, UserSearchResult } from "../../shared/user-search";
import { TeamCodePipe, displayTeamCode } from "../../shared/team-display-code";

// Admin-only "Tools" page (2026-09-18, "before pushing on tools of admin
// add an icon and inside split into an admin-tools component which has
// buttons for tools") — a home for general-purpose admin utilities that
// aren't tied to any one feature page (unlike schedule.html's own
// reset-game/reset-round buttons, which live right next to the games they
// act on). Split out of admin-users.ts specifically because "Sync images"
// had no natural feature-page home of its own. Structured as one card per
// tool so adding a future tool is a copy-paste of a card block in the
// template plus whatever state/handler that tool needs here — not a
// generic data-driven "tools list", since each tool's own state/action
// shape differs too much to usefully share one.
// Grant points / grant card / add collectible moved in from profile.ts
// (2026-09-18, "Maybe since this is an admin tool transfer into admin
// tools component we added earlier? and the points and the add card
// below") — same "general-purpose admin utility, not a profile setting"
// reasoning Sync images already established; they used to sit on Profile
// purely because that's where isAdmin-gated UI already existed before
// this page did.
@Component({
  selector: "app-admin-tools",
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    ButtonDirective,
    LogoSpinnerComponent,
    NavIconComponent,
    DropdownComponent,
    SearchInputComponent,
    UserSearchComponent,
    TeamCodePipe,
  ],
  templateUrl: "./admin-tools.html",
})
export class AdminToolsComponent {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);
  private fb = inject(FormBuilder);

  // "Sync images" — pulls new real player/coach photos from EuroLeague's
  // live feed, then pushes any that changed into their matching
  // collectible card. See routes/admin.ts's own comment on what this
  // actually runs. syncResult holds the last run's counts until the next
  // click or a page reload; null before ever clicked.
  readonly syncing = signal(false);
  readonly syncResult = signal<{ playersUpdated: number; coachCardsUpdated: number; collectiblesUpdated: number } | null>(null);
  readonly syncError = signal(false);

  syncImages(): void {
    this.syncing.set(true);
    this.syncError.set(false);
    this.api.syncImages().subscribe({
      next: (result) => {
        this.syncResult.set(result);
        this.syncing.set(false);
      },
      error: () => {
        this.syncError.set(true);
        this.syncing.set(false);
      },
    });
  }

  // --- Grant points / grant card / add collectible (moved from profile.ts) ---

  readonly teams = signal<Team[]>([]);
  readonly collectibles = signal<Collectible[]>([]);
  readonly teamDropdownOptions = computed<DropdownOption[]>(() =>
    this.teams().map((t) => ({ value: t.id, label: displayTeamCode(t.code), logoUrl: t.logoUrl }))
  );
  readonly tierDropdownOptions = computed<DropdownOption[]>(() => [
    { value: "common", label: this.i18n.t("store.tierCommon") },
    { value: "rare", label: this.i18n.t("store.tierRare") },
    { value: "legendary", label: this.i18n.t("store.tierLegendary") },
  ]);

  // Search-to-pick card list ("have a search for players to give not just
  // list") — a type-to-filter search over the already-fetched
  // `collectibles` list rather than a dropdown over the whole catalog
  // (650+ entries at the time this was written). Capped at 20 results — a
  // picker, not a full listing. Empty query shows nothing rather than the
  // whole catalog, same "start narrow" UX as app-user-search.
  readonly cardSearchQuery = signal("");
  readonly cardResultsOpen = signal(false);
  readonly filteredCollectibles = computed<Collectible[]>(() => {
    const q = this.cardSearchQuery().trim().toLowerCase();
    if (!q) return [];
    return this.collectibles()
      .filter((c) => c.name.toLowerCase().includes(q) || displayTeamCode(c.team.code).toLowerCase().includes(q))
      .slice(0, 20);
  });

  readonly pointsSubmitting = signal(false);
  readonly pointsError = signal<string | null>(null);
  readonly pointsSuccess = signal<string | null>(null);
  readonly pointsForm = this.fb.nonNullable.group({
    userId: ["", [Validators.required]],
    points: [10, [Validators.required]],
    reason: ["", [Validators.required]],
  });

  readonly cardSubmitting = signal(false);
  readonly cardError = signal<string | null>(null);
  readonly cardSuccess = signal<string | null>(null);
  // finish defaults to "standard"; the template only shows the foil toggle
  // once a legendary is picked (see selectedCard below) — see
  // routes/collectibles.ts's own "foil requires legendary" validation.
  readonly cardForm = this.fb.nonNullable.group({
    userId: ["", [Validators.required]],
    collectibleId: ["", [Validators.required]],
    finish: ["standard" as "standard" | "foil"],
  });
  // A real signal, not a computed() over cardForm.value — computed() only
  // re-runs when a SIGNAL it read changes, and FormGroup/FormControl
  // values aren't signals, so a computed() reading cardForm.value never
  // re-triggers when selectCard() calls patchValue (a real bug hit once
  // already on profile.ts before this moved here — see that file's git
  // history if curious). Set directly wherever the pick changes instead.
  readonly selectedCard = signal<Collectible | null>(null);

  private readonly pointsUserSearch = viewChild<UserSearchComponent>("pointsUserSearch");
  private readonly cardUserSearch = viewChild<UserSearchComponent>("cardUserSearch");

  readonly addSubmitting = signal(false);
  readonly addError = signal<string | null>(null);
  readonly addForm = this.fb.nonNullable.group({
    name: ["", [Validators.required]],
    teamId: ["", [Validators.required]],
    tier: ["common", [Validators.required]],
    pointsCost: [50, [Validators.required, Validators.min(1)]],
    imageUrl: [""],
  });

  // Guards against re-fetching every time currentUser() changes for an
  // unrelated reason once already fetched for this page load.
  private dataFetchedForAdmin = false;

  constructor() {
    // Reactive, not a one-time ngOnInit check — this page is itself
    // isAdmin-gated the same way profile.ts's admin section used to be,
    // and inherits the exact bootstrap-race risk that caused a real bug
    // there ("autocomplete does not work for players now"):
    // AuthService.restoreSession() resolves the logged-in user
    // asynchronously off the httpOnly refresh cookie, so on a fresh page
    // load currentUser() can still read null/non-admin at the exact
    // moment a one-time check would run. An effect() re-runs whenever
    // currentUser() actually changes, catching the session resolving late.
    effect(() => {
      if (this.auth.currentUser()?.isAdmin && !this.dataFetchedForAdmin) {
        this.dataFetchedForAdmin = true;
        this.api.getTeams().subscribe({ next: (rows) => this.teams.set(rows), error: () => {} });
        this.refreshCollectibles();
      }
    });
  }

  private refreshCollectibles(): void {
    this.api.getCollectibles().subscribe({ next: (rows) => this.collectibles.set(rows), error: () => {} });
  }

  // Backend responses carry a stable `code` alongside their English
  // `error` text (see trades.ts's tradeErrorMessage() for the original
  // pattern this mirrors) so the frontend can translate without the
  // server needing to know about languages at all.
  private adminErrorMessage(err: unknown, fallbackKey: string): string {
    const body = (err as { error?: { code?: string; error?: string } } | undefined)?.error;
    const key = body?.code ? `profile.adminErr.${body.code}` : undefined;
    const translated = key ? this.i18n.t(key) : undefined;
    if (translated && translated !== key) return translated;
    return body?.error ?? this.i18n.t(fallbackKey);
  }

  onPointsUserSelected(user: UserSearchResult): void {
    this.pointsForm.patchValue({ userId: user.id });
  }

  onCardUserSelected(user: UserSearchResult): void {
    this.cardForm.patchValue({ userId: user.id });
  }

  onCardSearchInput(value: string): void {
    this.cardSearchQuery.set(value);
    this.cardResultsOpen.set(true);
    // Typing again after a pick invalidates that pick — same "must
    // re-select" behavior a plain <select> would give you for free, which
    // this search-based picker doesn't get automatically since the text
    // box no longer mirrors a dropdown's own selected option.
    if (this.cardForm.value.collectibleId) {
      this.cardForm.patchValue({ collectibleId: "", finish: "standard" });
      this.selectedCard.set(null);
    }
  }

  selectCard(card: Collectible): void {
    this.cardForm.patchValue({ collectibleId: card.id });
    this.selectedCard.set(card);
    this.cardSearchQuery.set(`${card.name} — ${displayTeamCode(card.team.code)} (${card.tier})`);
    this.cardResultsOpen.set(false);
  }

  submitPointsGrant(): void {
    if (this.pointsForm.invalid || this.pointsForm.value.points === 0) return;
    this.pointsSubmitting.set(true);
    this.pointsError.set(null);
    this.pointsSuccess.set(null);

    const { userId, points, reason } = this.pointsForm.getRawValue();
    this.api.adjustPoints(userId, Number(points), reason).subscribe({
      next: (res) => {
        this.pointsSubmitting.set(false);
        this.pointsSuccess.set(
          `${this.i18n.t("profile.grantedPrefix")} ${points} ${this.i18n.t("profile.grantedPointsTo")} ${res.username}.`
        );
        this.pointsForm.reset({ userId: "", points: 10, reason: "" });
        this.pointsUserSearch()?.reset();
      },
      error: (err) => {
        this.pointsSubmitting.set(false);
        this.pointsError.set(this.adminErrorMessage(err, "profile.grantPointsFailed"));
      },
    });
  }

  submitCardGrant(): void {
    if (this.cardForm.invalid) return;
    this.cardSubmitting.set(true);
    this.cardError.set(null);
    this.cardSuccess.set(null);

    const { userId, collectibleId, finish } = this.cardForm.getRawValue();
    this.api.grantCard(userId, collectibleId, finish).subscribe({
      next: (res) => {
        this.cardSubmitting.set(false);
        this.cardSuccess.set(
          `${this.i18n.t("profile.grantedPrefix")} ${res.collectible.name} ${this.i18n.t("profile.grantedCardTo")} ${res.username}.`
        );
        this.cardForm.reset({ userId: "", collectibleId: "", finish: "standard" });
        this.cardUserSearch()?.reset();
        this.cardSearchQuery.set("");
        this.selectedCard.set(null);
      },
      error: (err) => {
        this.cardSubmitting.set(false);
        this.cardError.set(this.adminErrorMessage(err, "profile.grantCardFailed"));
      },
    });
  }

  submitAddCollectible(): void {
    if (this.addForm.invalid) return;
    this.addSubmitting.set(true);
    this.addError.set(null);

    const { name, teamId, tier, pointsCost, imageUrl } = this.addForm.getRawValue();
    this.api.addCollectible(name, teamId, tier, Number(pointsCost), imageUrl || undefined).subscribe({
      next: () => {
        this.addSubmitting.set(false);
        this.addForm.patchValue({ name: "", imageUrl: "" });
        this.refreshCollectibles();
      },
      error: (err) => {
        this.addSubmitting.set(false);
        this.addError.set(this.adminErrorMessage(err, "profile.addCollectibleFailed"));
      },
    });
  }
}
