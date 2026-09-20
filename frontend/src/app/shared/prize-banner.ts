import { Component, Input, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";

// Podium order/amounts for the "first to complete the album" cash prize —
// one place this renders from, paired with the copy in core/i18n/contest.ts.
// Rendered in visual left-to-right podium order (2nd, 1st, 3rd), not prize
// order.
const PODIUM = [
  { place: 2, amount: 30 },
  { place: 1, amount: 50 },
  { place: 3, amount: 20 },
] as const;

// Rich, animated version of the €100 album-completion prize announcement —
// the plain text banners on the landing page and dashboard (2026-09-20, see
// git history) didn't "show what the prize is" or carry any real visual
// weight, per direct feedback. Deliberately styled as its own fixed
// gold/amber card rather than following the app's theme-variable colors
// (--color-card/--color-ink/etc.) — same reasoning as dashboard's sponsor
// ticker (dashboard.component.html) staying a fixed flat-black strip
// regardless of light/dark mode: a "real prize" card reads as a distinct,
// special object, not another themed content tile, and should look
// identical to every viewer regardless of their theme or favorite team.
@Component({
  selector: "app-prize-banner",
  standalone: true,
  imports: [RouterLink, NavIconComponent],
  templateUrl: "./prize-banner.html",
  styleUrl: "./prize-banner.css",
})
export class PrizeBannerComponent implements OnInit {
  protected i18n = inject(I18nService);
  protected readonly podium = PODIUM;

  // "hero" (landing page — full title + podium) vs "compact" (dashboard —
  // smaller podium, no separate title line, fits above Live Center without
  // pushing everything else too far down).
  @Input() size: "hero" | "compact" = "hero";
  // Routed CTA under the copy — omitted on the landing page (nothing to
  // link to pre-registration), pointed at /album from the dashboard.
  @Input() ctaLink?: string;
  // Same per-device dismiss mechanic and storage-key convention as
  // shared/page-hint.ts's PageHintComponent, reusing the exact same
  // `clutch-hint-dismissed-*` key space — only wired up when a hintId is
  // actually passed. The landing page never passes one: a first-time cold
  // visitor has nothing to "come back to" by dismissing it.
  @Input() hintId?: string;

  readonly dismissed = signal(false);

  private get storageKey(): string {
    return `clutch-hint-dismissed-${this.hintId}`;
  }

  ngOnInit(): void {
    if (!this.hintId) return;
    try {
      this.dismissed.set(localStorage.getItem(this.storageKey) === "1");
    } catch {
      // Private browsing / storage disabled — banner just stays visible every visit.
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
    if (!this.hintId) return;
    try {
      localStorage.setItem(this.storageKey, "1");
    } catch {
      // No persistence available — it'll reappear next visit, not worth failing over.
    }
  }
}
