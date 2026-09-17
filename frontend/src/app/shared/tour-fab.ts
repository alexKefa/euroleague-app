import { Component, OnInit, inject, signal } from "@angular/core";
import { TourService } from "../core/tour/tour.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";

// A floating, pulsing "take the tour" prompt shown once, on a visitor's
// first ever visit — direct request (2026-09-17): the tour's only other
// entry point is a small icon-only button in the top bar, the same modest
// weight as profile/logout next to it, easy for a first-time visitor to
// never notice at all. This doesn't replace that permanent icon (kept for
// re-entering the tour any time after); it's purely a one-shot nudge.
// TourService.hasBeenSeen()/markSeen() are the shared source of truth so
// either entry point (this prompt, or the top-bar icon) marks the same
// flag — starting the tour from the icon directly should stop this from
// ever showing up on a later visit too.
const SHOW_DELAY_MS = 1500;

@Component({
  selector: "app-tour-fab",
  standalone: true,
  imports: [NavIconComponent],
  templateUrl: "./tour-fab.html",
})
export class TourFabComponent implements OnInit {
  protected tour = inject(TourService);
  protected i18n = inject(I18nService);

  readonly visible = signal(false);

  ngOnInit(): void {
    if (this.tour.hasBeenSeen()) return;
    setTimeout(() => {
      // Re-checked at fire time, not just on mount — someone could have
      // already tapped the permanent top-bar icon (or this component's own
      // dismiss, on a re-render) during the delay.
      if (!this.tour.hasBeenSeen() && !this.tour.active()) this.visible.set(true);
    }, SHOW_DELAY_MS);
  }

  start(): void {
    this.visible.set(false);
    this.tour.start();
  }

  dismiss(): void {
    this.tour.markSeen();
    this.visible.set(false);
  }
}
