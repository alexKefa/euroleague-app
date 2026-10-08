import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject } from "@angular/core";

const DECIDE_PX = 6;

/**
 * Steadier two-axis scroll boxes on touch (2026-10-08, "when scrolling the
 * table on mobile is not steady. it moves completely"). The sticky-header
 * tables (roster, standings, advanced stats) scroll both ways inside one
 * box, and mobile browsers don't lock a swipe to one axis there: a sideways
 * swipe also drifted the rows, and hitting the box's edge carried on into
 * the page.
 *
 * - overscroll-behavior: contain stops the swipe at the box's edge.
 * - The first few px of a touch decide the axis; the other axis is set to
 *   overflow: hidden for the rest of that gesture (scroll position is kept),
 *   then restored when the finger lifts.
 *
 * Mouse/trackpad scrolling is untouched. Listeners run outside the zone.
 */
@Directive({
  selector: "[appAxisLock]",
  standalone: true,
})
export class AxisLockDirective implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private start: { x: number; y: number } | null = null;
  private locked: "x" | "y" | null = null;

  private readonly onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    this.start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    this.locked = null;
  };

  private readonly onMove = (e: TouchEvent) => {
    if (!this.start || this.locked || e.touches.length !== 1) return;
    const dx = Math.abs(e.touches[0].clientX - this.start.x);
    const dy = Math.abs(e.touches[0].clientY - this.start.y);
    if (Math.max(dx, dy) < DECIDE_PX) return;
    this.locked = dx > dy ? "x" : "y";
    // Only lock when the box can actually scroll the chosen way; otherwise
    // leave the gesture alone (e.g. vertical swipes on a short table go to the page).
    if (this.locked === "x" && this.el.scrollWidth > this.el.clientWidth) this.el.style.overflowY = "hidden";
    else if (this.locked === "y" && this.el.scrollHeight > this.el.clientHeight) this.el.style.overflowX = "hidden";
  };

  private readonly onEnd = () => {
    this.start = null;
    this.locked = null;
    this.el.style.removeProperty("overflow-x");
    this.el.style.removeProperty("overflow-y");
  };

  ngOnInit(): void {
    this.el.style.overscrollBehavior = "contain";
    this.zone.runOutsideAngular(() => {
      this.el.addEventListener("touchstart", this.onStart, { passive: true });
      this.el.addEventListener("touchmove", this.onMove, { passive: true });
      this.el.addEventListener("touchend", this.onEnd, { passive: true });
      this.el.addEventListener("touchcancel", this.onEnd, { passive: true });
    });
  }

  ngOnDestroy(): void {
    this.el.removeEventListener("touchstart", this.onStart);
    this.el.removeEventListener("touchmove", this.onMove);
    this.el.removeEventListener("touchend", this.onEnd);
    this.el.removeEventListener("touchcancel", this.onEnd);
  }
}
