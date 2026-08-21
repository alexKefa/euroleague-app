import { Component, OnInit, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterOutlet, RouterLink } from "@angular/router";
import { filter, map } from "rxjs";
import { AuthService } from "./core/auth.service";
import { ThemeService } from "./core/theme.service";
import { I18nService } from "./core/i18n.service";
import { NavIconComponent, NavIconName } from "./shared/nav-icon";
import { SplashComponent } from "./shared/splash";
import { ButtonDirective } from "./shared/button.directive";

// Matches the ball-fall/wordmark-in animation duration in splash.css —
// the fade-out starts once the animation has actually finished playing,
// not on some unrelated timer.
const SPLASH_DURATION_MS = 1600;
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
    activePrefixes: ["/store", "/wheel", "/trades", "/packs"],
  },
];

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, NavIconComponent, SplashComponent, ButtonDirective],
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
  private router = inject(Router);
  protected readonly navLinks = NAV_LINKS;

  protected readonly showSplash = signal(true);
  protected readonly splashHiding = signal(false);

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
