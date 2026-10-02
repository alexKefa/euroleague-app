import { Component, DestroyRef, NgZone, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { NavIconComponent } from "./nav-icon";

// Damped pull distance (px) that triggers a refresh, and the most the
// indicator travels.
const THRESHOLD = 64;
const MAX_PULL = 96;

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
  template: `
    @if (pull() > 0 || refreshing()) {
      <div
        class="fixed left-1/2 z-[70] pointer-events-none top-[env(safe-area-inset-top)]"
        [style.transform]="'translate(-50%, ' + (refreshing() ? 56 : pull() - 8) + 'px)'"
        [style.transition]="dragging ? 'none' : 'transform 200ms ease-out'"
        aria-hidden="true"
      >
        <span
          class="w-10 h-10 rounded-full bg-card border border-line shadow-pop flex items-center justify-center text-team-primary"
          [class.animate-spin]="refreshing()"
          [style.transform]="refreshing() ? null : 'rotate(' + pull() * 3 + 'deg)'"
          [style.opacity]="refreshing() ? 1 : Math.min(1, pull() / THRESHOLD)"
        >
          <app-nav-icon name="ball" [size]="20" />
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

  readonly pull = signal(0);
  readonly refreshing = signal(false);
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
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener("touchstart", this.onStart);
      window.removeEventListener("touchmove", this.onMove);
      window.removeEventListener("touchend", this.onEnd);
      window.removeEventListener("touchcancel", this.onEnd);
    });
  }

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
  };

  private readonly onEnd = (): void => {
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
    this.router
      .navigateByUrl("/__refresh", { skipLocationChange: true })
      .then(() => this.router.navigateByUrl(url))
      .finally(() => setTimeout(() => this.refreshing.set(false), 400));
  }
}
