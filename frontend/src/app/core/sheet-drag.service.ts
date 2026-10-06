import { Injectable } from "@angular/core";

// Swipe-down-to-dismiss for every phone bottom sheet (2026-10-06, "change all
// sheets for mobile to be draggable down to dismiss, like iOS does").
//
// One document-level gesture handler instead of a directive on each popup:
// it picks up any panel marked with the existing `sheet-panel` convention
// (see styles.css), the shared dropdown's `dd-panel`, or an explicit
// `data-sheet` (the Fantasy pickers and the admin dialog, which predate the
// sheet classes). Dismissing slides the panel off and then "taps" its
// backdrop, so each popup's own (click) close handler runs exactly as if the
// user had tapped outside — no per-popup wiring. A backdrop marked
// `data-sheet-static` (popups that deliberately can't be dismissed by
// tapping outside) is skipped.
//
// Only below the `sm:` breakpoint, where these render as bottom sheets.
// A drag only starts when the touch began with the panel (and any scroller
// inside it under the finger) scrolled to the top, so scrolling a long list
// still scrolls.

const PANEL_SELECTOR = ".sheet-panel, .dd-panel, [data-sheet]";
const DISMISS_FRACTION = 0.25; // of the panel's height
const FLING_VELOCITY = 0.5; // px/ms
const START_SLOP = 6; // px before a drag claims the gesture

interface DragState {
  panel: HTMLElement;
  backdrop: HTMLElement;
  startX: number;
  startY: number;
  startT: number;
  dy: number;
  dragging: boolean;
  // Backdrop dimming: a sibling backdrop (dropdown) fades by opacity; a
  // parent backdrop can't (the panel would fade with it), so its
  // background colour's alpha is scaled instead.
  sibling: boolean;
  bg: [number, number, number, number] | null;
}

@Injectable({ providedIn: "root" })
export class SheetDragService {
  private state: DragState | null = null;
  private started = false;

  init(): void {
    if (this.started || typeof document === "undefined") return;
    this.started = true;
    document.addEventListener("touchstart", (e) => this.onStart(e), { passive: true });
    document.addEventListener("touchmove", (e) => this.onMove(e), { passive: false });
    document.addEventListener("touchend", () => this.onEnd(), { passive: true });
    document.addEventListener("touchcancel", () => this.onEnd(true), { passive: true });
  }

  private isPhone(): boolean {
    return window.matchMedia("(max-width: 639.98px)").matches;
  }

  private backdropFor(panel: HTMLElement): HTMLElement | null {
    if (panel.classList.contains("dd-panel")) {
      const prev = panel.previousElementSibling;
      return prev instanceof HTMLElement ? prev : null;
    }
    const parent = panel.parentElement?.closest<HTMLElement>(".sheet-backdrop, [data-sheet-backdrop]");
    return parent ?? panel.parentElement;
  }

  // True if something between the touch target and the panel (inclusive) is
  // scrolled away from its top — then the touch belongs to that scroller.
  private scrolledAwayFromTop(target: Element, panel: HTMLElement): boolean {
    let el: Element | null = target;
    while (el && el !== panel.parentElement) {
      if (el instanceof HTMLElement && el.scrollTop > 0) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll") return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  private onStart(e: TouchEvent): void {
    this.state = null;
    if (e.touches.length !== 1 || !this.isPhone()) return;
    const target = e.target as Element | null;
    if (!target?.closest) return;
    // Text inputs and range sliders keep their own touch behaviour.
    if (target.closest("input[type=range], textarea, [data-no-sheet-drag], .cdk-drag")) return;
    const panel = target.closest<HTMLElement>(PANEL_SELECTOR);
    if (!panel) return;
    const backdrop = this.backdropFor(panel);
    if (!backdrop || backdrop.hasAttribute("data-sheet-static")) return;
    if (this.scrolledAwayFromTop(target, panel)) return;
    const t = e.touches[0];
    const sibling = panel.classList.contains("dd-panel");
    const m = getComputedStyle(backdrop).backgroundColor.match(/[\d.]+/g);
    const bg = m && m.length >= 3 ? ([+m[0], +m[1], +m[2], m[3] !== undefined ? +m[3] : 1] as [number, number, number, number]) : null;
    this.state = { panel, backdrop, startX: t.clientX, startY: t.clientY, startT: performance.now(), dy: 0, dragging: false, sibling, bg };
  }

  private onMove(e: TouchEvent): void {
    const s = this.state;
    if (!s) return;
    const t = e.touches[0];
    const dy = t.clientY - s.startY;
    const dx = t.clientX - s.startX;
    if (!s.dragging) {
      if (dy < -START_SLOP || Math.abs(dx) > Math.abs(dy) + START_SLOP) {
        this.state = null; // scrolling up or swiping sideways: not ours
        return;
      }
      if (dy < START_SLOP) return;
      s.dragging = true;
      s.startY = t.clientY; // no jump by the slop distance
      s.startT = performance.now();
      s.panel.style.transition = "none";
      s.backdrop.style.transition = "none";
    }
    e.preventDefault();
    s.dy = Math.max(0, t.clientY - s.startY);
    const h = s.panel.offsetHeight || 1;
    s.panel.style.transform = `translateY(${s.dy}px)`;
    this.dim(s, Math.max(0, 1 - s.dy / h));
  }

  private onEnd(cancelled = false): void {
    const s = this.state;
    this.state = null;
    if (!s || !s.dragging) return;
    const h = s.panel.offsetHeight || 1;
    const velocity = s.dy / Math.max(1, performance.now() - s.startT);
    const dismiss = !cancelled && (s.dy > h * DISMISS_FRACTION || (velocity > FLING_VELOCITY && s.dy > 30));
    const ease = "cubic-bezier(0.32, 0.72, 0, 1)";

    if (!dismiss) {
      s.panel.style.transition = `transform 0.28s ${ease}`;
      s.backdrop.style.transition = "opacity 0.28s ease, background-color 0.28s ease";
      s.panel.style.transform = "translateY(0)";
      this.dim(s, 1);
      setTimeout(() => this.clear(s), 300);
      return;
    }

    s.panel.style.transition = `transform 0.22s ${ease}`;
    s.backdrop.style.transition = "opacity 0.22s ease, background-color 0.22s ease";
    s.panel.style.transform = "translateY(110%)";
    this.dim(s, 0);
    setTimeout(() => {
      // The popup's own close handler, exactly like a tap outside.
      s.backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // If it's still on screen after its own close animation (a popup that
      // ignored the tap), put it back rather than leave it off-screen.
      setTimeout(() => {
        if (s.panel.isConnected) this.clear(s);
      }, 450);
    }, 200);
  }

  private dim(s: DragState, factor: number): void {
    if (s.sibling) {
      s.backdrop.style.opacity = String(factor);
    } else if (s.bg) {
      const [r, g, b, a] = s.bg;
      s.backdrop.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${a * factor})`;
    }
  }

  private clear(s: DragState): void {
    s.backdrop.style.backgroundColor = "";
    s.panel.style.transition = "";
    s.panel.style.transform = "";
    s.backdrop.style.transition = "";
    s.backdrop.style.opacity = "";
  }
}
