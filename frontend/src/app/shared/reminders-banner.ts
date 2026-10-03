import { Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { Reminders } from "../core/models";
import { NavIconComponent } from "./nav-icon";

const DISMISS_KEY_PREFIX = "clutch-reminder-dismissed-";
const RECHECK_MS = 10 * 60 * 1000;

function todayAthensDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date());
}

/**
 * "Before it locks" reminder toast (2026-10-01, in-app only — no emails):
 * no Fantasy squad for a round locking within 24h, or games in the next
 * 12h without a pick (backend routes/reminders.ts). Shows one at a time,
 * Fantasy first; dismissing hides it for that round / that day. Hidden on
 * the page it points to.
 */
@Component({
  selector: "app-reminders-banner",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    @if (shown(); as r) {
      <div class="toast-pop toast-pill pointer-events-auto mb-2" role="status">
        <div class="flex items-center gap-2.5">
          <span class="toast-pill-icon"><app-nav-icon [name]="r.icon" [size]="18" /></span>
          <p class="min-w-0 flex-1 text-[13px] font-semibold leading-snug line-clamp-2">{{ r.text }}</p>
          <button type="button" (click)="go(r)" class="toast-action">{{ r.cta }}</button>
          <button type="button" (click)="dismiss(r)" class="toast-x" [attr.aria-label]="i18n.t('hint.dismiss')">&times;</button>
        </div>
      </div>
    }
  `,
})
export class RemindersBannerComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  private readonly data = signal<Reminders | null>(null);
  private readonly dismissed = signal<Set<string>>(new Set());
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  readonly shown = computed(() => {
    const d = this.data();
    if (!d) return null;
    const url = this.url() ?? "";
    const gone = this.dismissed();
    if (d.fantasy && !url.startsWith("/fantasy")) {
      const key = `fantasy-${d.fantasy.round}`;
      if (!gone.has(key) && !this.storedDismiss(key)) {
        return {
          key,
          icon: "trophy" as const,
          link: "/fantasy",
          cta: this.i18n.t("reminders.fantasyCta"),
          text: this.i18n
            .t("reminders.fantasy")
            .replace("{round}", String(d.fantasy.round))
            .replace("{time}", this.timeUntil(d.fantasy.lockAt)),
        };
      }
    }
    if (d.picks && !url.startsWith("/predictions")) {
      const key = `picks-${todayAthensDateKey()}`;
      if (!gone.has(key) && !this.storedDismiss(key)) {
        return {
          key,
          icon: "picks" as const,
          link: "/predictions",
          cta: this.i18n.t("reminders.picksCta"),
          text: this.i18n
            .t(d.picks.unpicked === 1 ? "reminders.picksOne" : "reminders.picksMany")
            .replace("{n}", String(d.picks.unpicked))
            .replace("{time}", this.timeUntil(d.picks.firstTipoff)),
        };
      }
    }
    return null;
  });

  constructor() {
    let timer: ReturnType<typeof setInterval> | null = null;
    // React to the token (not ngOnInit) — same bootstrap race as
    // jump-ball-toast.ts: the session restores after this mounts.
    effect(() => {
      const token = this.auth.accessToken();
      if (timer) clearInterval(timer);
      timer = null;
      if (!token) {
        this.data.set(null);
        return;
      }
      this.load();
      timer = setInterval(() => this.loadIfVisible(), RECHECK_MS);
    });
    // A background tab polling every 10 minutes keeps Neon's compute from
    // ever auto-suspending, so hidden tabs skip the poll and catch up on
    // return instead.
    const onVisible = () => {
      if (!document.hidden && this.auth.accessToken() && Date.now() - this.lastLoadAt >= RECHECK_MS) this.load();
    };
    document.addEventListener("visibilitychange", onVisible);
    inject(DestroyRef).onDestroy(() => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    });
  }

  private lastLoadAt = 0;

  private loadIfVisible(): void {
    if (!document.hidden) this.load();
  }

  private load(): void {
    this.lastLoadAt = Date.now();
    this.api.getReminders().subscribe({ next: (r) => this.data.set(r), error: () => {} });
  }

  private storedDismiss(key: string): boolean {
    try {
      return localStorage.getItem(DISMISS_KEY_PREFIX + key) === "1";
    } catch {
      return false;
    }
  }

  private timeUntil(iso: string): string {
    const mins = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
    return mins < 90
      ? this.i18n.t("reminders.minutes").replace("{n}", String(mins))
      : this.i18n.t("reminders.hours").replace("{n}", String(Math.round(mins / 60)));
  }

  go(r: { key: string; link: string }): void {
    this.dismiss(r);
    this.router.navigateByUrl(r.link);
  }

  dismiss(r: { key: string }): void {
    this.dismissed.update((s) => new Set(s).add(r.key));
    try {
      localStorage.setItem(DISMISS_KEY_PREFIX + r.key, "1");
    } catch {
      // No persistence — it'll just show again next load.
    }
  }
}
