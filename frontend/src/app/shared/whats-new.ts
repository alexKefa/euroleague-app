import { Component, effect, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { Announcement } from "../core/models";
import { NavIconComponent, NavIconName } from "./nav-icon";

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
 * One-time "what's new" toasts, rendered inside the shared toast stack in
 * app.component.html. Announcements are written from the admin Tools page
 * (backend routes/announcements.ts); the API only returns live ones
 * (active, published, not expired), newest first. Every live one this
 * device hasn't seen shows as its own toast (2026-09-29, "when 2 or more
 * announcements are active we should show all of them"), and each is
 * marked seen on its own when dismissed or followed. Seen state is per
 * device (localStorage).
 */
@Component({
  selector: "app-whats-new",
  standalone: true,
  imports: [NavIconComponent],
  templateUrl: "./whats-new.html",
  styleUrl: "./battle-challenge-toast.css",
})
export class WhatsNewComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  private fetched = false;
  readonly pending = signal<Announcement[]>([]);
  // Which announcement (if any) is expanded to show its body.
  readonly expandedId = signal<string | null>(null);
  toggle(id: string): void {
    this.expandedId.update((cur) => (cur === id ? null : id));
  }

  constructor() {
    // Waits on the access token rather than checking once at init — this
    // mounts at the app root, before restoreSession() has resolved (same
    // bootstrap race jump-ball-toast.ts documents).
    effect(() => {
      if (!this.auth.accessToken() || this.fetched) return;
      this.fetched = true;
      this.api.getAnnouncements().subscribe({
        next: (rows) => {
          const seen = readSeen();
          this.pending.set(rows.filter((a) => !seen.has(a.id)));
        },
        error: () => {},
      });
    });
  }

  title(a: Announcement): string {
    return this.i18n.lang() === "el" ? a.titleEl : a.titleEn;
  }

  body(a: Announcement): string {
    return this.i18n.lang() === "el" ? a.bodyEl : a.bodyEn;
  }

  cta(a: Announcement): string {
    return (this.i18n.lang() === "el" ? a.ctaEl : a.ctaEn) ?? "";
  }

  icon(a: Announcement): NavIconName {
    return a.icon as NavIconName;
  }

  open(a: Announcement): void {
    this.dismiss(a);
    if (a.link) this.router.navigateByUrl(a.link);
  }

  dismiss(a: Announcement): void {
    const seen = readSeen();
    seen.add(a.id);
    writeSeen(seen);
    this.pending.update((list) => list.filter((x) => x.id !== a.id));
  }
}
