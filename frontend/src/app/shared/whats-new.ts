import { Component, computed, effect, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { Announcement } from "../core/models";
import { NavIconComponent, NavIconName } from "./nav-icon";
import { ButtonDirective } from "./button.directive";

const SEEN_KEY = "clutch-whats-new-seen";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    // Private browsing / blocked storage — it'll just show again next load.
  }
}

/**
 * One-time "what's new" toast, mounted globally in app.component.html next
 * to the battle-challenge/jump-ball toasts. Announcements are written from
 * the admin Tools page (2026-09-29; backend routes/announcements.ts) — the
 * API only returns live ones (active, published, not expired), newest first.
 * Each logged-in user sees the newest one they haven't seen, once;
 * dismissing or following it marks it and everything older as seen, so
 * nobody gets a backlog of toasts. Seen state is per device (localStorage).
 */
@Component({
  selector: "app-whats-new",
  standalone: true,
  imports: [NavIconComponent, ButtonDirective],
  templateUrl: "./whats-new.html",
  styleUrl: "./battle-challenge-toast.css",
})
export class WhatsNewComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  private live: Announcement[] = [];
  private fetched = false;
  private readonly current = signal<Announcement | null>(null);
  readonly announcement = this.current.asReadonly();

  readonly title = computed(() => this.pick(this.current(), "title"));
  readonly body = computed(() => this.pick(this.current(), "body"));
  readonly cta = computed(() => this.pick(this.current(), "cta"));
  readonly icon = computed(() => (this.current()?.icon ?? "bell") as NavIconName);

  constructor() {
    // Waits on the access token rather than checking once at init — this
    // mounts at the app root, before restoreSession() has resolved (same
    // bootstrap race jump-ball-toast.ts documents).
    effect(() => {
      if (!this.auth.accessToken() || this.fetched) return;
      this.fetched = true;
      this.api.getAnnouncements().subscribe({
        next: (rows) => {
          this.live = rows;
          const seen = readSeen();
          this.current.set(rows.find((a) => !seen.has(a.id)) ?? null);
        },
        error: () => {},
      });
    });
  }

  private pick(a: Announcement | null, field: "title" | "body" | "cta"): string {
    if (!a) return "";
    const el = this.i18n.lang() === "el";
    if (field === "title") return el ? a.titleEl : a.titleEn;
    if (field === "body") return el ? a.bodyEl : a.bodyEn;
    return (el ? a.ctaEl : a.ctaEn) ?? "";
  }

  open(): void {
    const a = this.current();
    this.dismiss();
    if (a?.link) this.router.navigateByUrl(a.link);
  }

  dismiss(): void {
    const a = this.current();
    if (!a) return;
    // Marks this one and everything older seen, so a returning user only
    // ever gets the latest news, never a queue of stale toasts.
    const seen = readSeen();
    for (const other of this.live) if (other.publishAt <= a.publishAt) seen.add(other.id);
    seen.add(a.id);
    writeSeen(seen);
    this.current.set(null);
  }
}
