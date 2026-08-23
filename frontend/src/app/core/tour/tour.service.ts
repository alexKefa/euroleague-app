import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { AuthService } from "../auth.service";
import { TOUR_STEPS, TourStep } from "./tour-steps";

// Drives the multi-page "Take a tour" walkthrough (shared/tour-overlay.ts is
// the visual half). A step either targets a `data-tour="..."` element
// somewhere in the app (spotlighted) or has no selector, which renders as a
// centered card with no spotlight — used for the welcome/closing steps and
// as the automatic fallback when a step's target never appears (an empty
// state or a slow fetch). Steps marked `requiresAuth` are skipped entirely
// for a guest (see isVisible/firstVisibleIndex below) rather than falling
// back to that centered card, since their target only ever renders for a
// logged-in user — a guest gets a shorter but fully-working preview tour
// instead of several unanchored cards in a row. Steps can name a route; the
// service navigates there via Router before searching for the target, so
// the tour can walk someone across Dashboard → Predictions → Cards hub →
// Wheel → Packs → Trades → Profile in one guided flow.
@Injectable({ providedIn: "root" })
export class TourService {
  private router = inject(Router);
  private auth = inject(AuthService);

  readonly steps: TourStep[] = TOUR_STEPS;

  readonly active = signal(false);
  readonly stepIndex = signal(0);
  readonly targetRect = signal<DOMRect | null>(null);
  // False while a step's route navigation / target search / scroll-into-view
  // is still settling — the overlay fades in only once true, so a step
  // never flashes at a stale or (0,0) position mid-transition.
  readonly ready = signal(false);

  readonly currentStep = computed<TourStep | null>(() => this.steps[this.stepIndex()] ?? null);

  // The step list a guest actually walks through (auth-gated steps
  // filtered out) — used for the overlay's "Step X/Y" label so a guest
  // sees an honest count of their shorter tour instead of the full 9 with
  // numbers jumping (2 → 4 → ...) as gated steps get skipped.
  readonly visibleSteps = computed(() => this.steps.filter((s) => this.isVisible(s)));
  readonly visibleStepNumber = computed(() => {
    const step = this.currentStep();
    return step ? this.visibleSteps().indexOf(step) + 1 : 0;
  });

  // Bumped on every step change and checked by the async settle/search chain
  // below so a stale navigation (user mashed Next, or ended the tour) can't
  // land its result after a newer step has already taken over.
  private token = 0;
  private readonly onViewportChange = () => this.remeasure();

  start(): void {
    this.stepIndex.set(this.firstVisibleIndex(0, 1) ?? 0);
    this.active.set(true);
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("scroll", this.onViewportChange, true);
    this.goToCurrentStep();
  }

  next(): void {
    const nextIndex = this.firstVisibleIndex(this.stepIndex() + 1, 1);
    if (nextIndex === null) {
      this.end();
      return;
    }
    this.stepIndex.set(nextIndex);
    this.goToCurrentStep();
  }

  back(): void {
    const prevIndex = this.firstVisibleIndex(this.stepIndex() - 1, -1);
    if (prevIndex === null) return;
    this.stepIndex.set(prevIndex);
    this.goToCurrentStep();
  }

  private isVisible(step: TourStep): boolean {
    return !step.requiresAuth || this.auth.isAuthenticated();
  }

  // Walks the step list from `start` in `direction`, returning the index of
  // the first step a guest can actually see (or every step, once logged
  // in). Used by both next() and back() so a guest transparently skips over
  // auth-gated steps in either direction instead of hitting their fallback
  // centered card.
  private firstVisibleIndex(start: number, direction: 1 | -1): number | null {
    for (let i = start; i >= 0 && i < this.steps.length; i += direction) {
      if (this.isVisible(this.steps[i])) return i;
    }
    return null;
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
