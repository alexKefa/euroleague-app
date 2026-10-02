import { AfterViewInit, Component, ElementRef, Input, inject, signal, viewChild } from "@angular/core";
import { I18nService } from "../core/i18n.service";

/**
 * Boot splash. Since 2026-10-02 the logo is drawn rather than dropped in:
 * public/brand/clutch-mark-draw.svg (generated from the vector logo) holds
 * the fill layers plus one stroke path per outline, and splash.css traces
 * those outlines in the team colour with a neon glow, then fades the real
 * fills in underneath.
 *
 * The SVG is fetched and injected rather than inlined in this component,
 * so its ~28 KB of path data stays out of the main bundle (it's a cached
 * static asset). Animations start on injection; if the fetch fails, the
 * static logo image shows instead.
 */
@Component({
  selector: "app-splash",
  standalone: true,
  templateUrl: "./splash.html",
  styleUrl: "./splash.css",
})
export class SplashComponent implements AfterViewInit {
  @Input() hiding = false;
  protected i18n = inject(I18nService);

  private readonly drawHost = viewChild<ElementRef<HTMLElement>>("drawHost");
  protected readonly fallback = signal(false);

  ngAfterViewInit(): void {
    fetch("/brand/clutch-mark-draw.svg")
      .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
      .then((svg) => {
        const host = this.drawHost()?.nativeElement;
        // Our own static asset, not user content.
        if (host) host.innerHTML = svg;
      })
      .catch(() => this.fallback.set(true));
  }
}
