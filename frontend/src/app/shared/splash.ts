import { Component, Input } from "@angular/core";

/**
 * Ball-through-net brand moment shown briefly on app load. Pure SVG/CSS,
 * no image assets — timed by AppComponent (fade starts, then removal),
 * not by this component itself.
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
