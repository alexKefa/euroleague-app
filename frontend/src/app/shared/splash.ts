import { Component, Input, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

/**
 * Brand moment shown briefly on app load. Fades in the app's logo mark,
 * centered, followed by a plain tagline.
 *
 * v8 (2026-09-13 trial) — the logo is now the user-generated backboard/
 * hoop/net "CLUTCH" illustration (a plain raster <img>, frontend/public/
 * clutch-mark.png), replacing both the earlier animated half-court line
 * diagram (real geometry shared with features/player/shot-chart.ts) and
 * the "Pure Wordmark" SVG that used to fade in over it — drawing a second,
 * separate court behind an image that already depicts a hoop read as
 * redundant when tested in a mockup, so the diagram was dropped rather
 * than layered underneath. See app.component.html's comment for the full
 * rationale/tradeoffs of the wordmark-to-image swap.
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
