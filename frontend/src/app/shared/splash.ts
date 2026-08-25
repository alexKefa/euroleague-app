import { Component, Input, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

/**
 * Brand moment shown briefly on app load — the logo mark's bars rise into
 * place, then the wordmark and tagline settle in beside/below them, over a
 * huge, very faint basketball watermark. Same mark as the top nav and
 * favicon, just animated — an original motif, not the EuroLeague brand
 * mark (deliberately kept off this screen). Pure SVG/CSS, no image assets
 * — timed by AppComponent (fade starts, then removal), not by this
 * component.
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
