import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterOutlet, RouterLink } from "@angular/router";
import { filter, map } from "rxjs";
import { AuthService } from "./core/auth.service";
import { ThemeService } from "./core/theme.service";
import { I18nService } from "./core/i18n.service";
import { EventsService } from "./core/events.service";
import { TradesNotificationService } from "./core/trades-notification.service";
import { NavIconComponent, NavIconName } from "./shared/nav-icon";
import { SplashComponent } from "./shared/splash";
import { ButtonDirective } from "./shared/button.directive";
import { TourOverlayComponent } from "./shared/tour-overlay";
import { TourService } from "./core/tour/tour.service";
import { InstallBannerComponent } from "./shared/install-banner";
import { TourFabComponent } from "./shared/tour-fab";

// 2026-09-08: bumped from 1200ms — the old duration was timed to just the
// splash's own entrance animation (cards fan in, then the C+ball+wordmark
// settle, ~750ms total), not to whether the destination route had actually
// rendered yet. On a real network round trip (dashboard fires several
// parallel API calls — standings, leaders, news, predictions — see the
// round-trip-cost notes in CLAUDE.md) that let the splash disappear before
// the dashboard had painted anything, showing a bare skeleton/blank flash
// underneath for a beat. This isn't wired to real readiness (no shared
// "is the destination route done loading" signal exists across
// components, and building one just for this felt like the wrong amount
// of coupling for a startup animation) — it's a longer flat hold instead,
// generous enough to comfortably cover a normal cold load, with the extra
// time doubling as room for the card-fan animation (splash.css) to
// actually be seen rather than being cut off mid-entrance like before.
const SPLASH_DURATION_MS = 2600;
const SPLASH_FADE_MS = 450;

// The PWA service worker (added, then pulled 2026-08-21 — see project
// memory) was implicated in cross-origin resources — Google Fonts, the
// EuroLeague image CDN, both otherwise-unrelated — intermittently 504ing in
// production. Removing the registration call in new app code doesn't
// retroactively affect a visitor whose browser already installed the old
// service worker from a previous visit; it stays active until explicitly
// unregistered. This cleans that up for anyone still carrying it, and is
// cheap to leave in permanently as a safety net.
function unregisterStaleServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((reg) => reg.unregister()))
    .catch(() => {});
  if ("caches" in window) {
    caches
      .keys()
      .then((keys) => keys.filter((k) => k.startsWith("ngsw:")).forEach((k) => caches.delete(k)))
      .catch(() => {});
  }
}

interface NavLink {
  path: string;
  label: string;
  icon: NavIconName;
  exact?: boolean;
  // Other route prefixes that should also count as this tab being active —
  // /wheel, /trades and /inventory are reached from Store but live as
  // sibling top-level routes, not nested under /store.
  activePrefixes?: string[];
}

// label is an i18n translation key, not display text — resolved via
// i18n.t() in the template so nav labels follow the language toggle.
// Desktop's rail has the vertical room for all eight, so it uses this list
// directly, in this order — deliberately matching mobile's own full order
// now (2026-09-19, explicit ask: "should be like mobile order" — an
// earlier pass that same day only fixed Cards/Fantasy's relative order,
// which wasn't enough): Home, Predictions, Cards, Fantasy (mobile's four
// direct tabs, see MOBILE_NAV_LINKS below), then Schedule, Teams,
// Standings, News (mobile's "More" overflow, in that same order, News
// last). Fantasy Five itself joined this list 2026-09-07, by request — it
// used to be mobile/dashboard-only, deliberately left off the rail's
// then-documented 7-item max; that cap wasn't load-bearing enough to keep
// it off once asked for directly.
const NAV_LINKS: NavLink[] = [
  { path: "/", label: "nav.home", icon: "home", exact: true },
  { path: "/predictions", label: "nav.picks", icon: "picks" },
  {
    path: "/inventory",
    label: "nav.cards",
    icon: "cards",
    activePrefixes: ["/store", "/wheel", "/trades", "/packs", "/album", "/legendary-vote"],
  },
  { path: "/fantasy", label: "fantasy.navLink", icon: "trophy" },
  { path: "/schedule", label: "nav.schedule", icon: "schedule" },
  { path: "/teams", label: "nav.teams", icon: "teams" },
  { path: "/standings", label: "nav.standings", icon: "standings" },
  { path: "/news", label: "nav.news", icon: "news" },
];

// Mobile-only: the four most-used destinations as direct tabs; Schedule,
// Teams, Standings, News, and profile/login all live one tap further away
// (More overflow / the top bar) instead of crowding a fifth+ bottom tab.
// Order here is deliberately its own list, not NAV_LINKS.filter() (which
// would just inherit NAV_LINKS' own desktop-rail order) — Fantasy swapped
// in for News as a direct tab (2026-09-19, explicit ask: "Bring fantasy...
// order should be Home, Predictions, Cards, Fantasy"), landing Cards
// before Fantasy here even though the desktop rail keeps Fantasy before
// Cards; this list is intentionally independent of that one.
const MOBILE_OVERFLOW_PATHS = new Set(["/schedule", "/teams", "/standings", "/news"]);
function findNavLink(path: string): NavLink {
  const link = NAV_LINKS.find((l) => l.path === path);
  if (!link) throw new Error(`app.component.ts: no NAV_LINKS entry for "${path}"`);
  return link;
}
const MOBILE_NAV_LINKS: NavLink[] = ["/", "/predictions", "/inventory", "/fantasy"].map(findNavLink);

// Mobile-only overflow behind the "More" tab (always last) — a spot for
// destinations checked occasionally rather than every session. Schedule/
// Teams/Standings keep their existing order; News moved here and placed
// last (2026-09-19, explicit ask), not first, since it's the newest
// addition to this list rather than one of its established members.
const MORE_LINKS: NavLink[] = ["/schedule", "/teams", "/standings", "/news"].map(findNavLink);

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    NavIconComponent,
    SplashComponent,
    ButtonDirective,
    TourOverlayComponent,
    InstallBannerComponent,
    TourFabComponent,
  ],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit {
  protected auth = inject(AuthService);
  // Injected here (not just where it's used) so its constructor — which
  // stamps the persisted color scheme onto <html> — runs as early as
  // possible in the app's lifecycle, minimizing any flash of the wrong
  // theme for a returning visitor who chose light.
  protected theme = inject(ThemeService);
  protected i18n = inject(I18nService);
  protected events = inject(EventsService);
  protected trades = inject(TradesNotificationService);
  protected tour = inject(TourService);
  private router = inject(Router);
  protected readonly navLinks = NAV_LINKS;
  protected readonly mobileNavLinks = MOBILE_NAV_LINKS;
  protected readonly moreLinks = MORE_LINKS;
  protected readonly moreOpen = signal(false);

  protected readonly showSplash = signal(true);
  protected readonly splashHiding = signal(false);

  // The mobile bottom tab bar is plain `fixed bottom-0` CSS with no JS
  // repositioning it — normally correct, but after the on-screen keyboard
  // opens (tapping a search box, a login/register field) and closes again,
  // some mobile browsers cache the shrunk viewport height and don't fully
  // recompute a fixed element's position until something forces a reflow,
  // leaving the nav stranded partway up the screen instead of pinned to
  // the true bottom edge until the page is reloaded. visualViewport's
  // resize event fires on keyboard show/hide and orientation change;
  // toggling display off and back on the next frame forces the browser to
  // recompute the nav's position fresh against the current real viewport.
  @ViewChild("bottomNav") private bottomNavRef?: ElementRef<HTMLElement>;

  private readonly resnapBottomNav = () => {
    const el = this.bottomNavRef?.nativeElement;
    if (!el) return;
    el.style.display = "none";
    requestAnimationFrame(() => {
      el.style.display = "";
    });
  };

  protected readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0])
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] }
  );

  // /welcome is a standalone public pitch page (QR/shared-link cold
  // traffic) — it renders its own header and has no use for the logged-in
  // app shell's top bar, desktop rail, or mobile tab bar around it.
  protected readonly hideChrome = computed(() => this.currentUrl() === "/welcome");

  ngOnInit(): void {
    this.auth.restoreSession().subscribe();
    unregisterStaleServiceWorker();

    setTimeout(() => this.splashHiding.set(true), SPLASH_DURATION_MS);
    setTimeout(() => this.showSplash.set(false), SPLASH_DURATION_MS + SPLASH_FADE_MS);

    window.visualViewport?.addEventListener("resize", this.resnapBottomNav);
    window.addEventListener("orientationchange", this.resnapBottomNav);
  }

  logout(): void {
    this.auth.logout().subscribe();
  }

  isActive(link: NavLink): boolean {
    const url = this.currentUrl();
    if (link.exact) return url === link.path;
    return [link.path, ...(link.activePrefixes ?? [])].some(
      (p) => url === p || url.startsWith(p + "/")
    );
  }

  // Profile/login live in the top bar, not as a NAV_LINKS entry (see the
  // Frontend architecture notes), so they don't go through isActive() above
  // — this is that same "is the current route this" check for the mobile
  // top bar's own profile icon.
  isProfileActive(): boolean {
    return this.currentUrl() === "/profile";
  }

  isMoreActive(): boolean {
    return this.moreLinks.some((l) => this.isActive(l));
  }

  toggleMore(): void {
    this.moreOpen.update((v) => !v);
  }

  closeMore(): void {
    this.moreOpen.set(false);
  }

  // Closes the popover on any click outside it — the trigger buttons stop
  // propagation in the template (see app.component.html) so toggleMore()'s
  // own click doesn't immediately re-close what it just opened.
  @HostListener("document:click")
  onDocumentClick(): void {
    if (this.moreOpen()) this.closeMore();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.closeMore();
  }

  // Shrinks the floating bottom tab bar 10% while scrolling down (less
  // visually competing with whatever content the user is actually
  // reading), back to full size on any upward scroll — same "give ground
  // to the content, come back on demand" idea as a browser's own
  // auto-hiding toolbar, just a resize instead of a hide since this nav is
  // the primary way to navigate on mobile and disappearing entirely would
  // cost more than it saves. rAF-throttled to at most one recompute per
  // frame; the 4px delta ignores sub-pixel/bounce-scroll noise so the bar
  // doesn't flicker on a stationary page, and near the very top (<=24px)
  // it's always full size regardless of direction, so the first scroll of
  // a session never starts shrunk.
  protected readonly bottomNavShrunk = signal(false);
  private lastScrollY = 0;
  private scrollRaf: number | null = null;

  @HostListener("window:scroll")
  onWindowScroll(): void {
    if (this.scrollRaf !== null) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = null;
      const y = window.scrollY;
      const delta = y - this.lastScrollY;
      if (y <= 24) {
        this.bottomNavShrunk.set(false);
      } else if (delta > 4) {
        this.bottomNavShrunk.set(true);
      } else if (delta < -4) {
        this.bottomNavShrunk.set(false);
      }
      this.lastScrollY = y;
    });
  }
}
