import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { AdminUserRow } from "../../core/models";
import { TeamCodePipe } from "../../shared/team-display-code";

interface ColumnDef {
  key: string;
  labelKey: string;
  get: (row: AdminUserRow) => number | string;
}

const COLUMNS: ColumnDef[] = [
  { key: "username", labelKey: "admin.colUser", get: (r) => r.username },
  { key: "email", labelKey: "admin.colEmail", get: (r) => r.email },
  { key: "createdAt", labelKey: "admin.colJoined", get: (r) => r.createdAt },
  { key: "points", labelKey: "admin.colPoints", get: (r) => r.totalPoints },
  { key: "cards", labelKey: "admin.colCards", get: (r) => r.cardsOwned },
  { key: "predictions", labelKey: "admin.colPredictions", get: (r) => r.predictionsMade },
  { key: "referrals", labelKey: "admin.colReferrals", get: (r) => r.referralsCount },
];

const DAY_MS = 24 * 60 * 60 * 1000;
// How many trailing days the bar chart plots — recent trend, not the whole
// app lifetime (which could span many months and squash every bar flat).
const CHART_WINDOW_DAYS = 30;

@Component({
  selector: "app-admin-users",
  standalone: true,
  imports: [CommonModule, RouterLink, TeamCodePipe],
  templateUrl: "./admin-users.html",
})
export class AdminUsersComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  readonly columns = COLUMNS;
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly allUsers = signal<AdminUserRow[]>([]);
  readonly signupsByDay = signal<{ date: string; count: number }[]>([]);
  readonly search = signal("");

  readonly sortKey = signal("createdAt");
  readonly sortDesc = signal(true);

  readonly filteredUsers = computed(() => {
    const q = this.search().trim().toLowerCase();
    const users = q
      ? this.allUsers().filter(
          (u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
        )
      : this.allUsers();

    const col = COLUMNS.find((c) => c.key === this.sortKey()) ?? COLUMNS[2];
    const desc = this.sortDesc();
    return [...users].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
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
  }

  setSort(key: string): void {
    if (this.sortKey() === key) {
      this.sortDesc.update((d) => !d);
    } else {
      this.sortKey.set(key);
      this.sortDesc.set(key !== "username" && key !== "email");
    }
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
