import { Directive, ElementRef, HostListener, inject } from "@angular/core";

// The EuroLeague media CDN occasionally 504s under load — seen in production
// specifically right after login, when the dashboard renders far more team
// logos/player photos at once than the login page did, all firing as eager
// parallel requests. Combined with `loading="lazy"` (added alongside this
// directive everywhere it's used) that burst should shrink a lot on its
// own, but a transient upstream timeout can still happen — this retries a
// failed load a couple of times with a short, increasing backoff instead of
// requiring the user to manually hard-reload the page to recover.
@Directive({
  selector: "img[appRetryImg]",
  standalone: true,
})
export class RetryImgDirective {
  private el = inject(ElementRef<HTMLImageElement>).nativeElement;
  private attempts = 0;
  private originalSrc: string | null = null;
  private readonly maxAttempts = 3;

  @HostListener("error")
  onError(): void {
    if (this.originalSrc === null) this.originalSrc = this.el.src;
    this.attempts++;

    if (this.attempts > this.maxAttempts) {
      // Gives up quietly rather than showing the browser's broken-image
      // icon — visibility (not display) so it doesn't reflow the layout
      // around it (team logo circles, card grids, etc. all assume the
      // image's box stays put).
      this.el.style.visibility = "hidden";
      return;
    }

    setTimeout(() => {
      // Cache-bust so a browser/CDN that already cached the failed
      // response doesn't just hand back the same failure again.
      const url = new URL(this.originalSrc!, location.href);
      url.searchParams.set("_retry", String(Date.now()));
      this.el.src = url.toString();
    }, 500 * this.attempts);
  }
}
