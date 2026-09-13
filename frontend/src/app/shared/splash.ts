import { Component, Input, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

/**
 * Brand moment shown briefly on app load. A half-court diagram (real
 * geometry, shared with features/player/shot-chart.ts's shot chart —
 * viewBox 320x210, basket at 160,185, not invented coordinates) strokes
 * itself on line by line, settles to a low-opacity backdrop, then the
 * wordmark ("Pure Wordmark," 2026-09-12 — Archivo Black "Clutch" plus a
 * thin curved rule) fades in centered over it, followed by a plain tagline.
 *
 * 2026-09-13 rework, replacing two earlier concepts in a row: a fan of
 * three mini collectible cards flipping face-up over a huge, very faint
 * basketball-glyph watermark. Both were dropped on direct feedback ("I
 * don't like this at all") rather than iterated on — this is a different
 * concept, not a tuned version of either: geometry instead of a literal
 * ball glyph, and no cards at all rather than a redesigned card treatment.
 * Reuses shot-chart.ts's real court numbers specifically so this reads as
 * "this app's actual court," the same continuity reasoning the old card
 * fan used real player photos for.
 *
 * Timed by AppComponent (fade starts, then removal), not by this
 * component — see app.component.ts's SPLASH_DURATION_MS.
 */
@Component({
  selector: "app-splash",
  standalone: true,
  templateUrl: "./splash.html",
  styleUrl: "./splash.css",
})
export class SplashComponent {
  @Input() hiding = false;
  protected i18n = inject(I18nService);
}
