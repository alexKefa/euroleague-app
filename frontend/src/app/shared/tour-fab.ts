import { Component, OnDestroy, OnInit, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router } from "@angular/router";
import { filter, map } from "rxjs";
import { TourService } from "../core/tour/tour.service";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";

const SHOW_DELAY_MS = 1500;
// After this long on screen the pill shrinks to just the compass icon, so
// it stays available without owning the corner.
const COLLAPSE_AFTER_MS = 6000;
// Pages with their own pinned bottom action bar (the battle picker's
// Send/Accept bar, Fantasy's save bar), which the button would sit on top of.
const HIDDEN_ON_PREFIXES = ["/battles", "/fantasy"];

/**
 * First-visit "Take the tour" button. Toned down 2026-09-30: the old one
 * pulsed with an endless animate-ping, never shrank, and covered pinned
 * action bars. Now a soft glow that pulses 3 times and stops, collapses to
 * an icon after a few seconds (hover expands it again), hides on pages with
 * their own bottom action bar, and has a bigger ×.
 */
@Component({
  selector: "app-tour-fab",
  standalone: true,
  imports: [NavIconComponent],
  templateUrl: "./tour-fab.html",
  styles: `
    .tour-fab-glow {
      animation: tour-fab-glow 1.8s ease-out 3;
    }
    @keyframes tour-fab-glow {
      0% {
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 55%, transparent);
      }
      100% {
        box-shadow: 0 0 0 14px color-mix(in srgb, var(--accent-primary) 0%, transparent);
      }
    }
    .tour-fab-label {
      display: inline-block;
      overflow: hidden;
      white-space: nowrap;
      max-width: 12rem;
      transition:
        max-width 300ms ease,
        opacity 200ms ease;
    }
    .tour-fab-label.is-collapsed {
      max-width: 0;
      opacity: 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .tour-fab-glow {
        animation: none;
      }
      .tour-fab-label {
        transition: none;
      }
    }
  `,
})
export class TourFabComponent implements OnInit, OnDestroy {
  protected tour = inject(TourService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  readonly visible = signal(false);
  readonly collapsed = signal(false);
  readonly hovered = signal(false);
  readonly showLabel = computed(() => !this.collapsed() || this.hovered());

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );
  readonly hiddenHere = computed(() => HIDDEN_ON_PREFIXES.some((p) => this.url().startsWith(p)));

  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit(): void {
    if (this.tour.hasBeenSeen()) return;
    this.timers.push(
      setTimeout(() => {
        if (this.tour.hasBeenSeen() || this.tour.active()) return;
        this.visible.set(true);
        this.timers.push(setTimeout(() => this.collapsed.set(true), COLLAPSE_AFTER_MS));
      }, SHOW_DELAY_MS)
    );
  }

  ngOnDestroy(): void {
    this.timers.forEach(clearTimeout);
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
