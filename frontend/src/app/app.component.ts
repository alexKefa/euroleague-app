import { Component, OnInit, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterOutlet, RouterLink } from "@angular/router";
import { filter, map } from "rxjs";
import { AuthService } from "./core/auth.service";
import { NavIconComponent, NavIconName } from "./shared/nav-icon";
import { SplashComponent } from "./shared/splash";

// Matches the ball-fall/wordmark-in animation duration in splash.css —
// the fade-out starts once the animation has actually finished playing,
// not on some unrelated timer.
const SPLASH_DURATION_MS = 1600;
const SPLASH_FADE_MS = 400;

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

const NAV_LINKS: NavLink[] = [
  { path: "/", label: "Home", icon: "home", exact: true },
  { path: "/news", label: "News", icon: "news" },
  { path: "/predictions", label: "Picks", icon: "picks" },
  {
    path: "/store",
    label: "Store",
    icon: "store",
    activePrefixes: ["/wheel", "/trades", "/inventory", "/packs"],
  },
];

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, NavIconComponent, SplashComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit {
  protected auth = inject(AuthService);
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
