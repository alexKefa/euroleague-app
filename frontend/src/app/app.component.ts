import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, effect, inject, signal } from "@angular/core";
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
import { InstallBannerComponent } from "./shared/install-banner";

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
// Desktop's rail has the vertical room for all seven, so it uses this list
// directly. Only the mobile bottom bar (cramped, thumb-reach real estate)
// trims to MOBILE_NAV_LINKS + a "More" overflow for Schedule/Teams/
// Standings — see MOBILE_NAV_LINKS/MORE_LINKS below and app.component.html.
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
  { path: "/teams", label: "nav.teams", icon: "teams" },
  { path: "/standings", label: "nav.standings", icon: "standings" },
];

// Mobile-only: the four most-used destinations as direct tabs; Schedule,
// Teams, Standings, and profile/login all live one tap further away (More
// overflow / the top bar) instead of crowding a fifth+ bottom tab.
const MOBILE_OVERFLOW_PATHS = new Set(["/schedule", "/teams", "/standings"]);
const MOBILE_NAV_LINKS: NavLink[] = NAV_LINKS.filter((l) => !MOBILE_OVERFLOW_PATHS.has(l.path));

// Mobile-only overflow behind the "More" tab (always last) — a spot for
// destinations checked occasionally rather than every session.
const MORE_LINKS: NavLink[] = NAV_LINKS.filter((l) => MOBILE_OVERFLOW_PATHS.has(l.path));

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
  // Sliding-pill indicator + basketball courier (picked over a "lift &
  // glow" alternative in a design-review pass — see the Artifact this was
  // prototyped in) — both positioned imperatively by measuring real tab
  // elements, same "direct DOM manipulation on this exact nav" approach
  // resnapBottomNav already uses below for the iOS-stuck-mid-scroll fix,
  // rather than fighting Angular bindings for a shared cross-tab element.
  @ViewChild("pillIndicator") private pillRef?: ElementRef<HTMLElement>;
  @ViewChild("basketball") private ballRef?: ElementRef<SVGElement>;
  // The pt-2/pb-2 row *inside* #bottomNav, not #bottomNav itself — #bottomNav
  // also carries the safe-area-inset bottom padding (invisible bg-card
  // buffer for the home-indicator area on notched phones), which would
  // otherwise pull this row's own measured rect off-true and make the
  // pill/ball math drift by however big that inset is.
  @ViewChild("bottomNavRow") private bottomNavRowRef?: ElementRef<HTMLElement>;

  private readonly resnapBottomNav = () => {
    const el = this.bottomNavRef?.nativeElement;
    if (!el) return;
    el.style.display = "none";
    requestAnimationFrame(() => {
      el.style.display = "";
      this.repositionPill(false);
    });
  };

  protected readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.split(/[?#]/)[0])
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] }
  );

  // Which of the 5 bottom-bar slots (4 mobileNavLinks + "More", always
  // last) the pill/ball should sit on. -1 only if truly nothing matches
  // (shouldn't happen — every route falls under either a direct tab or
  // MORE_LINKS), in which case repositionPill just leaves the pill where
  // it was rather than guessing.
  protected readonly activeTabSlot = computed<number>(() => {
    const idx = this.mobileNavLinks.findIndex((l) => this.isActive(l));
    if (idx !== -1) return idx;
    return this.isMoreActive() ? this.mobileNavLinks.length : -1;
  });

  private previousTabSlot: number | null = null;

  constructor() {
    // Re-measures on every route change (activeTabSlot depends on
    // currentUrl via isActive/isMoreActive) — requestAnimationFrame'd so
    // the DOM has already repainted the new .active classes the measurement
    // relies on, same reasoning as splash/resnap's own rAF use elsewhere in
    // this file.
    effect(() => {
      this.activeTabSlot();
      requestAnimationFrame(() => this.repositionPill(true));
    });
  }

  ngOnInit(): void {
    this.auth.restoreSession().subscribe();
    unregisterStaleServiceWorker();

    setTimeout(() => this.splashHiding.set(true), SPLASH_DURATION_MS);
    setTimeout(() => this.showSplash.set(false), SPLASH_DURATION_MS + SPLASH_FADE_MS);

    window.visualViewport?.addEventListener("resize", this.resnapBottomNav);
    window.addEventListener("orientationchange", this.resnapBottomNav);
  }

  // Moves the shared pill under whichever tab is now active, and — only
  // when triggered by a genuine tab change, not a resize/resnap — flies
  // the basketball from the previously active tab to the new one.
  // Skipped instead of instant-jumped under prefers-reduced-motion; the
  // pill itself already gets `motion-reduce:transition-none` in the
  // template, so a reduced-motion user still sees the correct tab
  // highlighted, just without either animation.
  private repositionPill(allowBallTravel: boolean): void {
    const nav = this.bottomNavRowRef?.nativeElement;
    const pill = this.pillRef?.nativeElement;
    const slot = this.activeTabSlot();
    if (!nav || !pill || slot === -1) return;

    const tabIcons = nav.querySelectorAll<HTMLElement>("[data-nav-tab] .icon-wrap");
    const target = tabIcons[slot];
    if (!target) return;

    const navRect = nav.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    pill.style.width = `${targetRect.width}px`;
    pill.style.transform = `translateX(${targetRect.left - navRect.left}px)`;

    const prevSlot = this.previousTabSlot;
    this.previousTabSlot = slot;
    if (!allowBallTravel || prevSlot === null || prevSlot === slot) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const prevEl = tabIcons[prevSlot];
    if (prevEl) this.animateBasketball(prevEl, target, navRect);
  }

  // A stylized flight (fade + scale in, arc up with a couple of full
  // spins, fade + scale out on arrival), not a physically accurate roll —
  // the spin count/arc height are fixed regardless of how far the ball
  // travels, only the horizontal distance is real.
  private animateBasketball(fromEl: HTMLElement, toEl: HTMLElement, navRect: DOMRect): void {
    const ball = this.ballRef?.nativeElement;
    if (!ball || !ball.animate) return;
    const ballSize = 16;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const fromX = fromRect.left - navRect.left + fromRect.width / 2 - ballSize / 2;
    const toX = toRect.left - navRect.left + toRect.width / 2 - ballSize / 2;
    const mid = fromX + (toX - fromX) / 2;

    ball.getAnimations().forEach((a) => a.cancel());
    ball.animate(
      [
        { transform: `translate(${fromX}px, 0px) scale(0.5) rotate(0deg)`, opacity: 0, offset: 0 },
        { transform: `translate(${fromX + (toX - fromX) * 0.2}px, -15px) scale(1) rotate(140deg)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${mid}px, -22px) scale(1.08) rotate(300deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${toX - (toX - fromX) * 0.15}px, -11px) scale(1) rotate(460deg)`, opacity: 1, offset: 0.8 },
        { transform: `translate(${toX}px, 0px) scale(0.55) rotate(620deg)`, opacity: 0, offset: 1 },
      ],
      { duration: 560, easing: "cubic-bezier(0.33, 0, 0.2, 1)", fill: "forwards" }
    );
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
}
