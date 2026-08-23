import { Component, ElementRef, OnInit, ViewChild, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterOutlet, RouterLink } from "@angular/router";
import { filter, map } from "rxjs";
import { AuthService } from "./core/auth.service";
import { ThemeService } from "./core/theme.service";
import { I18nService } from "./core/i18n.service";
import { EventsService } from "./core/events.service";
import { NavIconComponent, NavIconName } from "./shared/nav-icon";
import { SplashComponent } from "./shared/splash";
import { ButtonDirective } from "./shared/button.directive";
import { TourOverlayComponent } from "./shared/tour-overlay";

// Covers splash.css's bar-rise/wordmark-in animation (finishes ~950ms)
// plus a short hold — the fade-out starts once the mark has actually
// settled, not on some unrelated timer.
const SPLASH_DURATION_MS = 1200;
const SPLASH_FADE_MS = 400;

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
const NAV_LINKS: NavLink[] = [
  { path: "/", label: "nav.home", icon: "home", exact: true },
  { path: "/news", label: "nav.news", icon: "news" },
  { path: "/schedule", label: "nav.schedule", icon: "schedule" },
  { path: "/predictions", label: "nav.picks", icon: "picks" },
  {
    path: "/inventory",
    label: "nav.cards",
    icon: "cards",
    activePrefixes: ["/store", "/wheel", "/trades", "/packs", "/album"],
  },
];

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, NavIconComponent, SplashComponent, ButtonDirective, TourOverlayComponent],
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
  private router = inject(Router);
  protected readonly navLinks = NAV_LINKS;

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
}
