import { Component, Input } from "@angular/core";
import { LogoSpinnerComponent } from "./logo-spinner";

// Drop-in replacement for a plain `animate-pulse bg-line` placeholder box —
// same shimmer (animate-pulse + bg-line baked into the host so callers
// don't repeat them), but with the app's own logo pulsing in the middle so
// a loading state reads as "Clutch is working", not a generic gray
// rectangle. Callers still control shape/size the way they always did, via
// classes on the host element (h-24, rounded-2xl, aspect-ratio, etc.).
@Component({
  selector: "app-skeleton",
  standalone: true,
  imports: [LogoSpinnerComponent],
  template: `
    @if (icon) {
      <div class="absolute inset-0 flex items-center justify-center">
        <app-logo-spinner [size]="iconSize" class="opacity-40" />
      </div>
    }
  `,
  host: { class: "relative block overflow-hidden animate-pulse bg-line" },
})
export class SkeletonComponent {
  // Left off for placeholders too small to hold the mark legibly (pills,
  // thin text-line bars) — those still get the host's shimmer, just no icon.
  @Input() icon = true;
  @Input() iconSize = 18;
}
