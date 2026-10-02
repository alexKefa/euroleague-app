import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { AdminActivityEvent, AdminLeague, AdminUserLeague, AdminUserRow, Collectible } from "../../core/models";
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";
import { displayTeamCode } from "../../shared/team-display-code";
import { formatPlayerName } from "../../shared/player-name";
import { PageHeaderComponent } from "../../shared/page-header";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { DialogComponent } from "../../shared/dialog";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { SkeletonComponent } from "../../shared/skeleton";
import { ButtonDirective } from "../../shared/button.directive";

type SortKey = "lastSeen" | "createdAt" | "points" | "cards" | "predictions" | "referrals" | "username";

const SORTS: { key: SortKey; labelKey: string; get: (r: AdminUserRow) => number | string }[] = [
  // Online users first, then most recently seen; never-seen last.
  { key: "lastSeen", labelKey: "admin.colLastSeen", get: (r) => (r.online ? Number.MAX_SAFE_INTEGER : r.lastSeenAt ? new Date(r.lastSeenAt).getTime() : 0) },
  { key: "createdAt", labelKey: "admin.colJoined", get: (r) => r.createdAt },
  { key: "points", labelKey: "admin.colPoints", get: (r) => r.totalPoints },
  { key: "cards", labelKey: "admin.colCards", get: (r) => r.cardsOwned },
  { key: "predictions", labelKey: "admin.colPredictions", get: (r) => r.predictionsMade },
  { key: "referrals", labelKey: "admin.colReferrals", get: (r) => r.referralsCount },
  { key: "username", labelKey: "admin.colUser", get: (r) => r.username },
];

const DAY_MS = 24 * 60 * 60 * 1000;
// How many trailing days the bar chart plots — recent trend, not the whole
// app lifetime (which could span many months and squash every bar flat).
const CHART_WINDOW_DAYS = 30;

/**
 * Admin Users page. Restyled 2026-10-02 ("less vanilla, scrollable"): KPI
 * hero with the signup chart, a card list that scrolls inside its own
 * panel, and league membership management — tap a user for their sheet
 * (leagues, add/remove), or tick several and add them to a league at once.
 */
@Component({
  selector: "app-admin-users",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    PageHeaderComponent,
    NavIconComponent,
    DialogComponent,
    DropdownComponent,
    SkeletonComponent,
    ButtonDirective,
    ReactiveFormsModule,
  ],
  templateUrl: "./admin-users.html",
})
export class AdminUsersComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  readonly sorts = SORTS;
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly allUsers = signal<AdminUserRow[]>([]);
  readonly signupsByDay = signal<{ date: string; count: number }[]>([]);
  readonly search = signal("");

  readonly sortKey = signal<SortKey>("lastSeen");
  readonly sortDesc = signal(true);

  readonly filteredUsers = computed(() => {
    const q = this.search().trim().toLowerCase();
    const users = q
      ? this.allUsers().filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : this.allUsers();

    const sort = SORTS.find((s) => s.key === this.sortKey()) ?? SORTS[0];
    const desc = this.sortDesc();
    return [...users].sort((a, b) => {
      const av = sort.get(a);
      const bv = sort.get(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
  });

  readonly kpis = computed(() => {
    const users = this.allUsers();
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return {
      total: users.length,
      today: users.filter((u) => new Date(u.createdAt).getTime() >= startOfToday.getTime()).length,
      last7: users.filter((u) => now - new Date(u.createdAt).getTime() <= 7 * DAY_MS).length,
      last30: users.filter((u) => now - new Date(u.createdAt).getTime() <= 30 * DAY_MS).length,
      admins: users.filter((u) => u.isAdmin).length,
      online: users.filter((u) => u.online).length,
      activeToday: users.filter((u) => u.online || (u.lastSeenAt && now - new Date(u.lastSeenAt).getTime() <= DAY_MS)).length,
    };
  });

  // Zero-filled trailing 30-day series — signupsByDay only carries rows for
  // days that actually had a signup, so a quiet stretch would otherwise
  // silently vanish from the chart instead of showing as a real gap.
  readonly chartDays = computed(() => {
    const byDate = new Map(this.signupsByDay().map((d) => [d.date, d.count]));
    const days: { date: string; count: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = CHART_WINDOW_DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, count: byDate.get(key) ?? 0 });
    }
    return days;
  });

  readonly chartMax = computed(() => Math.max(1, ...this.chartDays().map((d) => d.count)));

  // ── League membership ────────────────────────────────────────────────
  readonly leagues = signal<AdminLeague[]>([]);
  readonly leagueOptions = computed<DropdownOption[]>(() =>
    this.leagues().map((l) => ({ value: l.id, label: `${l.name} · ${l.memberCount}` }))
  );

  // Bulk selection on the list.
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly bulkLeagueId = signal<string | null>(null);
  readonly bulkBusy = signal(false);
  readonly flash = signal<string | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  readonly allVisibleSelected = computed(() => {
    const visible = this.filteredUsers();
    const sel = this.selectedIds();
    return visible.length > 0 && visible.every((u) => sel.has(u.id));
  });

  // User sheet.
  readonly openUser = signal<AdminUserRow | null>(null);
  readonly userLeagues = signal<AdminUserLeague[]>([]);
  readonly userLeaguesLoading = signal(false);
  readonly sheetLeagueId = signal<string | null>(null);
  readonly sheetBusy = signal(false);
  // Remove is two taps: the first arms it, the second confirms.
  readonly armedRemoveId = signal<string | null>(null);

  readonly sheetTab = signal<"overview" | "activity">("overview");
  // Result line under the actions ("+50 points granted", errors).
  readonly sheetMsg = signal<string | null>(null);

  // Activity tab, loaded on first open of the tab. null = not loaded yet.
  readonly activity = signal<AdminActivityEvent[] | null>(null);
  readonly activityLoading = signal(false);

  readonly pointsForm = new FormGroup({
    points: new FormControl<number | null>(null, [Validators.required, (c) => (Number(c.value) === 0 ? { zero: true } : null)]),
    reason: new FormControl("", { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
  });

  readonly armedReset = signal(false);

  // Grant-card picker: the catalog loads on first search (null = not yet).
  private readonly catalog = signal<Collectible[] | null>(null);
  readonly cardQuery = signal("");
  readonly grantCardPick = signal<Collectible | null>(null);
  readonly grantFoil = signal(false);
  readonly cardMatches = computed(() => {
    const q = this.cardQuery().trim().toLowerCase();
    if (q.length < 2 || this.grantCardPick()) return [];
    return (this.catalog() ?? [])
      .filter((c) => c.name.toLowerCase().includes(q) || displayTeamCode(c.team.code).toLowerCase().includes(q))
      .slice(0, 8);
  });

  // Leagues the open user isn't in yet — the sheet's "add" picker.
  readonly sheetLeagueOptions = computed<DropdownOption[]>(() => {
    const mine = new Set(this.userLeagues().map((l) => l.id));
    return this.leagueOptions().filter((o) => !mine.has(o.value));
  });

  ngOnInit(): void {
    if (!this.auth.currentUser()?.isAdmin) {
      this.loading.set(false);
      return;
    }
    this.api.getAdminUsers().subscribe({
      next: (res) => {
        this.allUsers.set(res.users);
        this.signupsByDay.set(res.signupsByDay);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
    this.loadLeagues();
  }

  private loadLeagues(): void {
    this.api.getAdminLeagues().subscribe({ next: (rows) => this.leagues.set(rows), error: () => {} });
  }

  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDesc.update((d) => !d);
    } else {
      this.sortKey.set(key);
      this.sortDesc.set(key !== "username");
    }
  }

  toggleSelected(id: string, event: Event): void {
    event.stopPropagation();
    this.selectedIds.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleAllVisible(): void {
    const visible = this.filteredUsers().map((u) => u.id);
    if (this.allVisibleSelected()) {
      this.selectedIds.update((s) => {
        const next = new Set(s);
        visible.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      this.selectedIds.update((s) => new Set([...s, ...visible]));
    }
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
    this.bulkLeagueId.set(null);
  }

  bulkAdd(): void {
    const leagueId = this.bulkLeagueId();
    const ids = [...this.selectedIds()];
    if (!leagueId || ids.length === 0) return;
    this.bulkBusy.set(true);
    this.api.addLeagueMembers(leagueId, ids).subscribe({
      next: ({ added }) => {
        this.bulkBusy.set(false);
        this.showFlash(this.addedMessage(added, ids.length, leagueId));
        this.clearSelection();
        this.loadLeagues();
      },
      error: () => {
        this.bulkBusy.set(false);
        this.showFlash(this.i18n.t("admin.leagueActionFailed"));
      },
    });
  }

  openSheet(user: AdminUserRow): void {
    this.openUser.set(user);
    this.sheetTab.set("overview");
    this.activity.set(null);
    this.sheetMsg.set(null);
    this.armedReset.set(false);
    this.pointsForm.reset({ points: null, reason: "" });
    this.cardQuery.set("");
    this.grantCardPick.set(null);
    this.grantFoil.set(false);
    this.sheetLeagueId.set(null);
    this.armedRemoveId.set(null);
    this.userLeagues.set([]);
    this.userLeaguesLoading.set(true);
    this.api.getAdminUserLeagues(user.id).subscribe({
      next: (rows) => {
        this.userLeagues.set(rows);
        this.userLeaguesLoading.set(false);
      },
      error: () => this.userLeaguesLoading.set(false),
    });
  }

  closeSheet(): void {
    this.openUser.set(null);
  }

  setSheetTab(tab: "overview" | "activity"): void {
    this.sheetTab.set(tab);
    if (tab === "activity" && this.activity() === null) this.loadActivity();
  }

  private loadActivity(): void {
    const user = this.openUser();
    if (!user) return;
    this.activityLoading.set(true);
    this.api.getAdminUserActivity(user.id).subscribe({
      next: (rows) => {
        if (this.openUser()?.id === user.id) this.activity.set(rows);
        this.activityLoading.set(false);
      },
      error: () => {
        this.activity.set([]);
        this.activityLoading.set(false);
      },
    });
  }

  // ── Actions (grant points / card, reset email) ──────────────────────
  // Same endpoints as /admin/tools, just already scoped to this user.

  grantPoints(): void {
    const user = this.openUser();
    const { points, reason } = this.pointsForm.getRawValue();
    if (!user || this.pointsForm.invalid || !points) return;
    this.sheetBusy.set(true);
    this.api.adjustPoints(user.id, points, reason.trim()).subscribe({
      next: () => {
        this.sheetBusy.set(false);
        this.patchUser(user.id, { totalPoints: user.totalPoints + points });
        this.pointsForm.reset({ points: null, reason: "" });
        this.sheetMsg.set(this.i18n.t("admin.pointsGranted").replace("{n}", (points > 0 ? "+" : "") + points));
        if (this.activity() !== null) this.loadActivity();
      },
      error: () => {
        this.sheetBusy.set(false);
        this.sheetMsg.set(this.i18n.t("admin.actionFailed"));
      },
    });
  }

  onCardQuery(value: string): void {
    this.cardQuery.set(value);
    this.grantCardPick.set(null);
    // The catalog is only needed once someone actually searches it.
    if (this.catalog() === null) {
      this.catalog.set([]);
      this.api.getCollectibles().subscribe({ next: (rows) => this.catalog.set(rows), error: () => {} });
    }
  }

  pickGrantCard(card: Collectible): void {
    this.grantCardPick.set(card);
    this.grantFoil.set(false);
    this.cardQuery.set(card.name);
  }

  grantCard(): void {
    const user = this.openUser();
    const card = this.grantCardPick();
    if (!user || !card) return;
    this.sheetBusy.set(true);
    this.api.grantCard(user.id, card.id, card.tier === "legendary" && this.grantFoil() ? "foil" : "standard").subscribe({
      next: () => {
        this.sheetBusy.set(false);
        this.patchUser(user.id, { cardsOwned: user.cardsOwned + 1 });
        this.sheetMsg.set(this.i18n.t("admin.cardGranted").replace("{card}", card.name));
        this.grantCardPick.set(null);
        this.cardQuery.set("");
      },
      error: () => {
        this.sheetBusy.set(false);
        this.sheetMsg.set(this.i18n.t("admin.actionFailed"));
      },
    });
  }

  // Two taps, like Remove: the first arms it. Sends the normal
  // forgot-password email (in the admin's current UI language).
  sendReset(): void {
    const user = this.openUser();
    if (!user) return;
    if (!this.armedReset()) {
      this.armedReset.set(true);
      return;
    }
    this.armedReset.set(false);
    this.sheetBusy.set(true);
    this.auth.forgotPassword(user.email, this.i18n.lang() === "en" ? "en" : "el").subscribe({
      next: () => {
        this.sheetBusy.set(false);
        this.sheetMsg.set(this.i18n.t("admin.resetSent").replace("{email}", user.email));
      },
      error: () => {
        this.sheetBusy.set(false);
        this.sheetMsg.set(this.i18n.t("admin.actionFailed"));
      },
    });
  }

  private patchUser(id: string, patch: Partial<AdminUserRow>): void {
    this.allUsers.update((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const open = this.openUser();
    if (open?.id === id) this.openUser.set({ ...open, ...patch });
  }

  activityIcon(e: AdminActivityEvent): NavIconName {
    switch (e.kind) {
      case "pick":
        return "picks";
      case "top_scorer":
        return "flame";
      case "spin":
        return "wheel";
      case "trade":
        return "trade";
      default:
        return (e.points ?? 0) < 0 ? "packs" : "star";
    }
  }

  // Short label for a pick/trade status chip; null for none.
  activityStatus(e: AdminActivityEvent): { text: string; cls: string } | null {
    if (!e.status) return null;
    const map: Record<string, string> = {
      won: "bg-emerald-500/15 text-emerald-500",
      accepted: "bg-emerald-500/15 text-emerald-500",
      lost: "bg-red-500/15 text-red-500",
      declined: "bg-red-500/15 text-red-500",
      live: "bg-team-primary/15 text-team-primary",
    };
    return { text: this.i18n.t(`admin.status.${e.status}`), cls: map[e.status] ?? "bg-line text-muted" };
  }

  activityTitle(e: AdminActivityEvent): string {
    const title = e.title ?? "—";
    if (e.kind === "pick") return this.i18n.t("admin.act.pick").replace("{team}", title);
    if (e.kind === "top_scorer") return this.i18n.t("admin.act.topScorer").replace("{player}", formatPlayerName(title));
    if (e.kind === "spin") return this.i18n.t("admin.act.spin").replace("{card}", title);
    if (e.kind === "trade") return this.i18n.t("admin.act.trade").replace("{card}", title);
    return title;
  }

  activityDetail(e: AdminActivityEvent): string | null {
    if (e.kind === "adjustment" && e.detail) return this.i18n.t("admin.act.by").replace("{admin}", e.detail);
    return e.detail;
  }

  formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString(this.i18n.lang() === "el" ? "el-GR" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  sheetAdd(): void {
    const user = this.openUser();
    const leagueId = this.sheetLeagueId();
    if (!user || !leagueId) return;
    this.sheetBusy.set(true);
    this.api.addLeagueMembers(leagueId, [user.id]).subscribe({
      next: () => {
        this.sheetBusy.set(false);
        this.sheetLeagueId.set(null);
        this.refreshSheetLeagues(user.id);
        this.loadLeagues();
      },
      error: () => {
        this.sheetBusy.set(false);
        this.showFlash(this.i18n.t("admin.leagueActionFailed"));
      },
    });
  }

  sheetRemove(league: AdminUserLeague): void {
    const user = this.openUser();
    if (!user) return;
    if (this.armedRemoveId() !== league.id) {
      this.armedRemoveId.set(league.id);
      return;
    }
    this.armedRemoveId.set(null);
    this.sheetBusy.set(true);
    this.api.removeLeagueMember(league.id, user.id).subscribe({
      next: () => {
        this.sheetBusy.set(false);
        this.userLeagues.update((rows) => rows.filter((l) => l.id !== league.id));
        this.loadLeagues();
      },
      error: () => {
        this.sheetBusy.set(false);
        this.showFlash(this.i18n.t("admin.leagueActionFailed"));
      },
    });
  }

  private refreshSheetLeagues(userId: string): void {
    this.api.getAdminUserLeagues(userId).subscribe({
      next: (rows) => {
        if (this.openUser()?.id === userId) this.userLeagues.set(rows);
      },
      error: () => {},
    });
  }

  private addedMessage(added: number, requested: number, leagueId: string): string {
    const name = this.leagues().find((l) => l.id === leagueId)?.name ?? "";
    const skipped = requested - added;
    let msg = this.i18n.t("admin.addedToLeague").replace("{n}", String(added)).replace("{league}", name);
    if (skipped > 0) msg += " " + this.i18n.t("admin.alreadyMembers").replace("{n}", String(skipped));
    return msg;
  }

  private showFlash(message: string): void {
    this.flash.set(message);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 4000);
  }

  // "Online", "5m ago", "3h ago", "2d ago", else the date.
  lastSeenLabel(user: AdminUserRow): string {
    if (user.online) return this.i18n.t("admin.online");
    if (!user.lastSeenAt) return this.i18n.t("admin.neverSeen");
    const mins = Math.floor((Date.now() - new Date(user.lastSeenAt).getTime()) / 60000);
    const rtf = new Intl.RelativeTimeFormat(this.i18n.lang() === "el" ? "el" : "en", { numeric: "auto", style: "narrow" });
    if (mins < 1) return this.i18n.t("admin.justNow");
    if (mins < 60) return rtf.format(-mins, "minute");
    if (mins < 24 * 60) return rtf.format(-Math.floor(mins / 60), "hour");
    if (mins < 7 * 24 * 60) return rtf.format(-Math.floor(mins / 1440), "day");
    return this.formatDate(user.lastSeenAt);
  }

  initial(user: AdminUserRow): string {
    return user.username.charAt(0).toUpperCase();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.lang() === "el" ? "el-GR" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  formatChartDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.lang() === "el" ? "el-GR" : "en-US", {
      month: "short",
      day: "numeric",
    });
  }
}
