import { Component, Input, OnInit, signal } from "@angular/core";

/**
 * Ball-through-net brand moment shown briefly on app load. Pure SVG/CSS,
 * no image assets — timed by AppComponent (fade starts, then removal),
 * not by this component itself. The shot-clock countdown hits 0:00 right
 * as the ball reaches the rim (~880ms into the 1.6s ball-fall animation
 * in splash.css) — a buzzer-beater, on brand for "Clutch".
 */
@Component({
  selector: "app-splash",
  standalone: true,
  templateUrl: "./splash.html",
  styleUrl: "./splash.css",
})
export class SplashComponent implements OnInit {
  @Input() hiding = false;

  readonly countdown = signal(3);

  ngOnInit(): void {
    [2, 1, 0].forEach((value, i) => {
      setTimeout(() => this.countdown.set(value), (i + 1) * 300);
    });
  }
}
