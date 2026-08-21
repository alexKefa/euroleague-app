import { Component, Input } from "@angular/core";

/**
 * Brand moment shown briefly on app load — the logo mark's bars rise into
 * place, then the wordmark settles in beside them. Same mark as the top
 * nav and favicon, just animated. Pure SVG/CSS, no image assets — timed
 * by AppComponent (fade starts, then removal), not by this component.
 */
@Component({
  selector: "app-splash",
  standalone: true,
  templateUrl: "./splash.html",
  styleUrl: "./splash.css",
})
export class SplashComponent {
  @Input() hiding = false;
}
