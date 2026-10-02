import { Component, DestroyRef, Injectable, NgZone, computed, inject, signal } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter } from "rxjs";
import { NavIconComponent } from "./nav-icon";

// Damped pull distance (px) that triggers a refresh, and the most the
// indicator travels.
const THRESHOLD = 64;
const MAX_PULL = 96;

/**
 * Shared pull state, so the app shell can slide its top bar away while a
 * pull or refresh is in progress (the bar and this component live in
 * separate @if blocks of app.component.html, out of each other's reach).
 */
@Injectable({ providedIn: "root" })
export class PullToRefreshState {
  readonly pull = signal(0);
  readonly refreshing = signal(false);
  // A few px of pull (a scroll that starts at the very top) shouldn't
  // flick the top bar away.
  readonly active = computed(() => this.pull() > 12 || this.refreshing());

  /** Back to idle: no pull, not refreshing. */
  reset(): void {
    this.pull.set(0);
    this.refreshing.set(false);
  }
}

/** Target for the soft refresh's round trip (see PullToRefreshComponent.refresh). */
@Component({ selector: "app-blank", standalone: true, template: "" })
export class BlankComponent {}

/**
 * Pull-to-refresh for the installed app (2026-10-02). A home-screen PWA has
 * no browser chrome, so no native pull-to-refresh and no reload button.
 * Only active in standalone display mode; a browser tab keeps its own.
 *
 * The refresh is soft: a hop to a blank route and back (skipLocationChange)
 * recreates the current page so it refetches its data, without a full
 * reload replaying the splash and session restore.
 */
@Component({
  selector: "app-pull-to-refresh",
  standalone: true,
  imports: [NavIconComponent],
  // The ball spins with the pull and shifts from grey to the team colour as
  // it nears the threshold; past it, it fills solid and pops slightly, so
  // "let go now" is visible. Refreshing keeps it filled and spinning.
  template: `
    @if (pull() > 0 || refreshing()) {
      <div
        class="fixed left-1/2 z-[70] pointer-events-none top-[env(safe-area-inset-top)]"
        [style.transform]="'translate(-50%, ' + (refreshing() ? 24 : pull() - 24) + 'px)'"
        [style.transition]="dragging ? 'none' : 'transform 200ms ease-out'"
        aria-hidden="true"
      >
        <span
          class="w-11 h-11 rounded-full border shadow-pop flex items-center justify-center transition-[background-color,border-color,color,scale] duration-150"
          [class.animate-spin]="refreshing()"
          [style.transform]="refreshing() ? null : 'rotate(' + pull() * 6 + 'deg)'"
          [style.scale]="ready() || refreshing() ? 1.12 : 0.7 + 0.3 * progress()"
          [style.background-color]="ready() || refreshing() ? 'var(--accent-primary)' : 'var(--color-card)'"
          [style.border-color]="ready() || refreshing() ? 'var(--accent-primary)' : 'var(--color-line)'"
          [style.color]="
            ready() || refreshing()
              ? 'var(--accent-secondary)'
              : 'color-mix(in srgb, var(--accent-primary) ' + Math.round(progress() * 100) + '%, var(--color-muted))'
          "
        >
          <app-nav-icon name="ball" [size]="22" />
        </span>
      </div>
    }
  `,
})
export class PullToRefreshComponent {
  private router = inject(Router);
  private zone = inject(NgZone);
  protected readonly Math = Math;
  protected readonly THRESHOLD = THRESHOLD;

  private state = inject(PullToRefreshState);
  readonly pull = this.state.pull;
  readonly refreshing = this.state.refreshing;
  // 0..1 toward the threshold, and whether letting go now refreshes.
  readonly progress = computed(() => Math.min(1, this.pull() / THRESHOLD));
  readonly ready = computed(() => this.pull() >= THRESHOLD);
  protected dragging = false;
  private startY: number | null = null;

  constructor() {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    // Outside Angular: touchmove fires constantly, and only the signal
    // writes need change detection.
    this.zone.runOutsideAngular(() => {
      window.addEventListener("touchstart", this.onStart, { passive: true });
      window.addEventListener("touchmove", this.onMove, { passive: true });
      window.addEventListener("touchend", this.onEnd, { passive: true });
      window.addEventListener("touchcancel", this.onEnd, { passive: true });
    });
    // Leaving or returning to the app ends any gesture in progress, and a
    // finished navigation (other than mid-pull) leaves nothing pulled.
    document.addEventListener("visibilitychange", this.cancelGesture);
    const navSub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        if (this.startY === null && !this.refreshing() && this.pull() !== 0) this.pull.set(0);
      });
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener("touchstart", this.onStart);
      window.removeEventListener("touchmove", this.onMove);
      window.removeEventListener("touchend", this.onEnd);
      window.removeEventListener("touchcancel", this.onEnd);
      document.removeEventListener("visibilitychange", this.cancelGesture);
      navSub.unsubscribe();
    });
  }

  private readonly cancelGesture = (): void => {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.startY = null;
    this.dragging = false;
    if (!this.refreshing()) this.zone.run(() => this.pull.set(0));
  };

  private readonly onStart = (e: TouchEvent): void => {
    if (this.refreshing() || e.touches.length !== 1 || window.scrollY > 0) return;
    if (!this.canStartFrom(e.target)) return;
    this.startY = e.touches[0].clientY;
  };

  private readonly onMove = (e: TouchEvent): void => {
    if (this.startY === null) return;
    const dy = e.touches[0].clientY - this.startY;
    if (dy <= 0 || window.scrollY > 0) {
      if (this.pull() !== 0) this.zone.run(() => this.pull.set(0));
      return;
    }
    this.dragging = true;
    // Damped, so the indicator lags the finger like a native pull.
    const damped = Math.min(MAX_PULL, dy * 0.5);
    this.zone.run(() => this.pull.set(damped));
    this.armIdleCancel();
  };

  // A touchend can go missing: if the element under the finger is removed
  // mid-gesture, the browser dispatches the end event to that detached
  // node and it never reaches window. The pull state then stuck at > 0,
  // which kept the top bar hidden after a refresh. No movement for a
  // while = the gesture is over; cancel it (no refresh).
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private armIdleCancel(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.startY === null) return;
      this.startY = null;
      this.dragging = false;
      this.zone.run(() => this.pull.set(0));
    }, 1200);
  }

  private readonly onEnd = (): void => {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.startY === null) return;
    this.startY = null;
    this.dragging = false;
    const triggered = this.pull() >= THRESHOLD;
    this.zone.run(() => {
      this.pull.set(0);
      if (triggered) this.refresh();
    });
  };

  // Not from inside an overlay (dialogs, sheets, the dropdown panel, the
  // news stories viewer) or from inside a container that's itself scrolled
  // down — those gestures belong to that element.
  private canStartFrom(target: EventTarget | null): boolean {
    let el = target instanceof Element ? target : null;
    if (el?.closest('[role="dialog"], [role="listbox"], .sheet-backdrop, .fixed.inset-0, app-news-stories')) return false;
    while (el && el !== document.body) {
      if (el.scrollTop > 0) return false;
      el = el.parentElement;
    }
    return true;
  }

  private refresh(): void {
    this.refreshing.set(true);
    const url = this.router.url;
    // Clears when the page is back; the cap covers a hop that's superseded
    // or stalls, so the spinner (and the hidden top bar) can't stick.
    const done = () => this.refreshing.set(false);
    const cap = setTimeout(done, 3000);
    this.router
      .navigateByUrl("/__refresh", { skipLocationChange: true })
      .then(() => this.router.navigateByUrl(url))
      .finally(() => {
        clearTimeout(cap);
        setTimeout(done, 250);
      });
  }
}
