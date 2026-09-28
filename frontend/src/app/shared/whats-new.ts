import { Component, effect, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent, NavIconName } from "./nav-icon";
import { ButtonDirective } from "./button.directive";

interface Announcement {
  /** Stable, unique — it's what "seen" is keyed on. Convention: `<date>-<slug>`. */
  id: string;
  /** Release day (YYYY-MM-DD); the toast stops showing ANNOUNCEMENT_TTL_DAYS after it. */
  date: string;
  icon: NavIconName;
  /** i18n keys (core/i18n/whats-new.ts) — EN and EL both required. */
  titleKey: string;
  bodyKey: string;
  /** Optional in-app destination for the call-to-action button. */
  link?: string;
  ctaKey?: string;
}

/**
 * "What's new" announcements (2026-09-28, direct ask: "when we have new
 * features inform with a one time toast notifications users of what's
 * changed"). To announce a feature: add an entry at the TOP of this list
 * plus its title/body (and CTA) strings in core/i18n/whats-new.ts. Each
 * logged-in user sees the newest unseen, unexpired entry once; dismissing
 * or following it marks it and everything older as seen, so nobody gets a
 * backlog of toasts after a few releases.
 */
const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "2026-09-28-fantasy-screenshot-import",
    date: "2026-09-28",
    icon: "share",
    titleKey: "whatsNew.fantasyImport.title",
    bodyKey: "whatsNew.fantasyImport.body",
    link: "/fantasy",
    ctaKey: "whatsNew.fantasyImport.cta",
  },
];

// Long enough for an occasional user to still catch it, short enough that
// someone signing up weeks later isn't told old news is "new".
const ANNOUNCEMENT_TTL_DAYS = 14;
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

function isExpired(a: Announcement, now: number): boolean {
  return now > Date.parse(`${a.date}T00:00:00Z`) + ANNOUNCEMENT_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * One-time "what's new" toast, mounted globally in app.component.html next
 * to the battle-challenge/jump-ball toasts. Shares the battle toast's top
 * slot (that one only fires on a live challenge, so the two rarely meet);
 * jump-ball's own slot sits lower. Seen state is per device (localStorage)
 * — a user on two devices sees an announcement once on each, which is fine
 * for a one-off nudge and needs no server state.
 */
@Component({
  selector: "app-whats-new",
  standalone: true,
  imports: [NavIconComponent, ButtonDirective],
  templateUrl: "./whats-new.html",
  styleUrl: "./battle-challenge-toast.css",
})
export class WhatsNewComponent {
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  private readonly current = signal<Announcement | null>(null);
  readonly announcement = this.current.asReadonly();

  constructor() {
    // Waits on the access token rather than checking once at init — this
    // mounts at the app root, before restoreSession() has resolved (same
    // bootstrap race jump-ball-toast.ts documents).
    effect(() => {
      if (!this.auth.accessToken() || this.current()) return;
      const seen = readSeen();
      const now = Date.now();
      const next = ANNOUNCEMENTS.find((a) => !seen.has(a.id) && !isExpired(a, now));
      if (next) this.current.set(next);
    });
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
    const idx = ANNOUNCEMENTS.indexOf(a);
    for (const older of ANNOUNCEMENTS.slice(idx)) seen.add(older.id);
    writeSeen(seen);
    this.current.set(null);
  }
}
