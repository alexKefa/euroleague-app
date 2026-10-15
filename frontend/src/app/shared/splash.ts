import { Component, Input, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

/**
 * Boot splash. Since 2026-10-15 it shows the crisp vector logo instead of
 * neon-tracing it: the auto-traced outlines wobbled under a thick glowing
 * stroke and the stacked drop-shadow filters dropped frames on phones.
 * The logo is the static brand SVG cut in two with clip-path (mark above,
 * "Clutch" wordmark below) so the parts can enter a beat apart, then one
 * light sweep masked to the logo shape. Transform/opacity only.
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
