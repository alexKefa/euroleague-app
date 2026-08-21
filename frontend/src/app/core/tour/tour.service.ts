import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { TOUR_STEPS, TourStep } from "./tour-steps";

// Drives the multi-page "Take a tour" walkthrough (shared/tour-overlay.ts is
// the visual half). A step either targets a `data-tour="..."` element
// somewhere in the app (spotlighted) or has no selector, which renders as a
// centered card with no spotlight — used for the welcome/closing steps and
// as the automatic fallback when a step's target never appears (guest
// viewing an auth-gated step, an empty state, a slow fetch). Steps can name
// a route; the service navigates there via Router before searching for the
// target, so the tour can walk someone across Dashboard → Predictions →
// Cards hub → Wheel → Packs → Trades → Profile in one guided flow.
@Injectable({ providedIn: "root" })
export class TourService {
  private router = inject(Router);

  readonly steps: TourStep[] = TOUR_STEPS;

  readonly active = signal(false);
  readonly stepIndex = signal(0);
  readonly targetRect = signal<DOMRect | null>(null);
  // False while a step's route navigation / target search / scroll-into-view
  // is still settling — the overlay fades in only once true, so a step
  // never flashes at a stale or (0,0) position mid-transition.
  readonly ready = signal(false);

  readonly currentStep = computed<TourStep | null>(() => this.steps[this.stepIndex()] ?? null);

  // Bumped on every step change and checked by the async settle/search chain
  // below so a stale navigation (user mashed Next, or ended the tour) can't
  // land its result after a newer step has already taken over.
  private token = 0;
  private readonly onViewportChange = () => this.remeasure();

  start(): void {
    this.stepIndex.set(0);
    this.active.set(true);
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("scroll", this.onViewportChange, true);
    this.goToCurrentStep();
  }

  next(): void {
    if (this.stepIndex() >= this.steps.length - 1) {
      this.end();
      return;
    }
    this.stepIndex.update((i) => i + 1);
    this.goToCurrentStep();
  }

  back(): void {
    if (this.stepIndex() === 0) return;
    this.stepIndex.update((i) => i - 1);
    this.goToCurrentStep();
  }

  end(): void {
    this.token++;
    this.active.set(false);
    this.ready.set(false);
    this.targetRect.set(null);
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("scroll", this.onViewportChange, true);
  }

  private remeasure(): void {
    const step = this.currentStep();
    if (!step?.selector || !this.ready()) return;
    const el = this.findVisibleTarget(step.selector);
    this.targetRect.set(el?.getBoundingClientRect() ?? null);
  }

  private findVisibleTarget(selector: string): HTMLElement | null {
    // offsetParent is null for display:none (and fixed-position) elements —
    // good enough here since none of the tour's targets are fixed, and it's
    // exactly what filters out an @if-gated element that isn't rendered.
    return (
      Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (el) => el.offsetParent !== null
      ) ?? null
    );
  }

  private goToCurrentStep(): void {
    const step = this.currentStep();
    if (!step) return;

    this.ready.set(false);
    this.targetRect.set(null);
    const token = ++this.token;
    const currentPath = this.router.url.split(/[?#]/)[0];

    const settle = () => {
      if (token !== this.token) return;
      this.waitForTarget(step.selector, token);
    };

    if (step.route && currentPath !== step.route) {
      this.router.navigateByUrl(step.route).then(() => setTimeout(settle, 60));
    } else {
      setTimeout(settle, 30);
    }
  }

  private waitForTarget(selector: string | undefined, token: number, attempt = 0): void {
    if (token !== this.token) return;

    if (!selector) {
      this.ready.set(true);
      return;
    }

    const el = this.findVisibleTarget(selector);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
      setTimeout(() => {
        if (token !== this.token) return;
        this.targetRect.set(el.getBoundingClientRect());
        this.ready.set(true);
      }, 80);
      return;
    }

    // ~3s of polling for slower fetches (e.g. standings/predictions loading)
    // before giving up and showing the step centered with no spotlight.
    if (attempt >= 20) {
      this.ready.set(true);
      return;
    }
    setTimeout(() => this.waitForTarget(selector, token, attempt + 1), 150);
  }
}
