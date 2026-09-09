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
// directly (Fantasy Five joined 2026-09-07, by request — it used to be
// mobile/dashboard-only, deliberately left off the rail's then-documented
// 7-item max; that cap wasn't load-bearing enough to keep it off once
// asked for directly). Only the mobile bottom bar (cramped, thumb-reach
// real estate) trims to MOBILE_NAV_LINKS + a "More" overflow for Schedule/
// Teams/Standings/Fantasy — see MOBILE_NAV_LINKS/MORE_LINKS below and
// app.component.html.
const NAV_LINKS: NavLink[] = [
  { path: "/", label: "nav.home", icon: "home", exact: true },
  { path: "/news", label: "nav.news", icon: "news" },
  { path: "/schedule", label: "nav.schedule", icon: "schedule" },
  { path: "/predictions", label: "nav.picks", icon: "picks" },
  { path: "/fantasy", label: "fantasy.navLink", icon: "fantasy" },
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
// Teams, Standings, Fantasy, and profile/login all live one tap further
// away (More overflow / the top bar) instead of crowding a fifth+ bottom
// tab — Fantasy joining the desktop rail above doesn't change mobile's own
// tab count, it's still reached via "More" there.
const MOBILE_OVERFLOW_PATHS = new Set(["/schedule", "/teams", "/standings", "/fantasy"]);
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
  // Sliding-pill indicator (reintroduced 2026-09-08, sized to fill a
  // whole [data-nav-tab] slot rather than the old small icon-sized circle
  // — see the template comment) + basketball courier (picked over a
  // "lift & glow" alternative in a design-review pass — see the Artifact
  // this was prototyped in) — both positioned imperatively by measuring
  // real tab elements, same "direct DOM manipulation on this exact nav"
  // approach resnapBottomNav already uses below for the iOS-stuck-mid-
  // scroll fix, rather than fighting Angular bindings for a value that
  // travels between N sibling positions.
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
      this.trackActiveTab(false);
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
    //
    // Also resets bottomNavShrunk to false first (2026-09-09 report): the
    // shrink is a CSS `scale(0.9)` on the whole bar (see the template), so
    // trackActiveTab's getBoundingClientRect() calls below measure
    // *post-transform* (already-shrunk) pixel sizes while scrolled down.
    // Those screen-space numbers get baked straight into the pill's own
    // raw (pre-transform) width/height/transform — which the ancestor's
    // scale(0.9) then applies to *again*, compounding into a pill that's
    // visibly undersized/misaligned the moment the bar returns to full
    // size (scrolling back up doesn't re-measure on its own, only a tab
    // change does). Forcing the bar back to full size before every
    // measurement means trackActiveTab only ever measures true, unscaled
    // dimensions, so the pill can never end up baked against a shrunk
    // frame in the first place.
    //
    // Still reported broken with just a couple of rAFs after the reset —
    // the bar's transform doesn't snap back instantly, it *animates* over
    // the template's own `duration-300` transition, which is 10x longer
    // than two frames. trackActiveTabAfterShrinkReset below waits for that
    // transition to actually finish (transitionend, with a timeout safety
    // net) before measuring whenever the bar really was shrunk — "reset
    // scale, then change tab" as two real, sequential steps, not raced.
    effect(() => {
      this.activeTabSlot();
      const wasShrunk = this.bottomNavShrunk();
      this.bottomNavShrunk.set(false);
      this.trackActiveTabAfterShrinkReset(wasShrunk);
    });
  }

  // See the constructor's effect above. When the bar wasn't shrunk to
  // begin with (the common case — nothing to reset, so bottomNavShrunk's
  // value/the transform never actually changes and no transition ever
  // fires) this just measures next frame like before. When it *was*
  // shrunk, waits for the reset transition's real transitionend (not a
  // guessed frame count) before measuring — with a timeout fallback
  // (duration-300 + slack) in case the event never fires for any reason
  // (e.g. the transition gets interrupted by another scroll mid-flight),
  // and an immediate measure under prefers-reduced-motion, where the
  // template's `motion-reduce:transition-none` means the transform snaps
  // instantly and no transitionend would ever come.
  private trackActiveTabAfterShrinkReset(wasShrunk: boolean): void {
    const nav = this.bottomNavRef?.nativeElement;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!wasShrunk || !nav || reducedMotion) {
      requestAnimationFrame(() => requestAnimationFrame(() => this.trackActiveTab(true)));
      return;
    }

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      nav.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(timer);
      this.trackActiveTab(true);
    };
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === nav && e.propertyName === "transform") settle();
    };
    nav.addEventListener("transitionend", onTransitionEnd);
    const timer = window.setTimeout(settle, 400);
  }

  ngOnInit(): void {
    this.auth.restoreSession().subscribe();
    unregisterStaleServiceWorker();

    setTimeout(() => this.splashHiding.set(true), SPLASH_DURATION_MS);
    setTimeout(() => this.showSplash.set(false), SPLASH_DURATION_MS + SPLASH_FADE_MS);

    window.visualViewport?.addEventListener("resize", this.resnapBottomNav);
    window.addEventListener("orientationchange", this.resnapBottomNav);
  }

  // Slides the shared pill under whichever tab is now active — sized to
  // that tab's whole [data-nav-tab] slot, not just its icon — and, only
  // when triggered by a genuine tab change (not a resize/resnap), flies
  // the basketball from the previously active tab's icon to the new one.
  // Skipped instead of instant-jumped under prefers-reduced-motion; the
  // pill itself already gets `motion-reduce:transition-none` in the
  // template, so a reduced-motion user still sees the correct tab
  // highlighted, just without either animation.
  private trackActiveTab(allowBallTravel: boolean): void {
    const nav = this.bottomNavRowRef?.nativeElement;
    const pill = this.pillRef?.nativeElement;
    const slot = this.activeTabSlot();
    if (!nav || slot === -1) return;

    const tabSlots = nav.querySelectorAll<HTMLElement>("[data-nav-tab]");
    const tabIcons = nav.querySelectorAll<HTMLElement>("[data-nav-tab] .icon-wrap");
    const targetSlot = tabSlots[slot];
    const target = tabIcons[slot];
    if (!targetSlot || !target) return;
    const navRect = nav.getBoundingClientRect();

    if (pill) {
      // The whole slot's own rect, not the smaller icon-wrap — every
      // [data-nav-tab] is an equal-width flex-1 box, so the pill's width
      // never actually changes between tabs, only its transform does,
      // which is what makes the slide read as one continuous glide rather
      // than a resize.
      const slotRect = targetSlot.getBoundingClientRect();
      pill.style.width = `${slotRect.width}px`;
      pill.style.height = `${slotRect.height}px`;
      pill.style.top = `${slotRect.top - navRect.top}px`;
      pill.style.transform = `translateX(${slotRect.left - navRect.left}px)`;
    }

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
    // Vertically centered on whichever circle it's leaving/landing on
    // (they're the same size, so one base value works for both ends) —
    // the keyframes' own translateY values are the arc *added* on top of
    // this resting height, not an absolute position.
    ball.style.top = `${fromRect.top - navRect.top + fromRect.height / 2 - ballSize / 2}px`;

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

  // Shrinks the bottom tab bar 10% while scrolling down (less visually
  // competing with whatever content the user is actually reading), back to
  // full size on any upward scroll — same "give ground to the content, come
  // back on demand" idea as a browser's own auto-hiding toolbar, just a
  // resize instead of a hide since this nav is the primary way to navigate
  // on mobile and disappearing entirely would cost more than it saves.
  // rAF-throttled to at most one recompute per frame; the 4px delta
  // ignores sub-pixel/bounce-scroll noise so the bar doesn't flicker on a
  // stationary page, and near the very top (<=24px) it's always full size
  // regardless of direction, so the first scroll of a session never starts
  // shrunk.
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
