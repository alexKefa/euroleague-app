import { Component, Input, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

/**
 * Brand moment shown briefly on app load — a small fan of three mini
 * collectible cards rises in first, then the combination mark: a real open
 * "C" ring (ink, theme-reactive) with a small basketball nested inside its
 * hollow (the app's fixed highlight orange, #FF6B35), then "lutch"
 * continues right after, then the tagline — all over a huge, very faint
 * basketball watermark (a separate, older motif — same glyph as
 * nav-icon.ts's "ball" case, not this brand mark). The three cards use the
 * exact tier gradients real Store/Album cards use (silver/gold/violet,
 * collectible-card.ts's TierStyle) and carry real photos, not
 * placeholders: Evan Fournier and Kendrick Nunn from EuroLeague's own
 * live media CDN (the same source player_stats_sync.py pulls from); Zeljko
 * Obradovic isn't in that feed (the live roster's `images` field for him
 * is empty), so his card points at a direct photo URL instead
 * (paobc.gr — Panathinaikos's own site, supplied by the user). Each card
 * keeps rotating further open then relaxing back —
 * a real fan gesture, not frozen once it fans in — for the whole hold,
 * with only a tiny (6%) scale bump; independent timing per card so the
 * three don't move in sync.
 *
 * 2026-09-08 rebrand, sixth pass landed the mark itself (see git history
 * for the five earlier tries); this pass (same day) extended the hold
 * (app.component.ts's SPLASH_DURATION_MS, 1200ms -> 2600ms — not tied to
 * real route-readiness, no shared "is the destination done loading" signal
 * exists across components, just a longer flat hold generous enough to
 * usually cover a cold dashboard load) and added the card fan, then went
 * through several idle-motion iterations (vertical bob -> side-to-side
 * slide with a large 35% scale bump -> this: real fan-open rotation with
 * the scale cut back to 6%, since the real photos visibly softened/blurred
 * from CSS-upscaling them by a third), then swapped the plain gradient
 * card faces for real photos. Not pure SVG/CSS anymore (the three photos
 * are real `<img>`s hitting an external CDN) — everything else stays
 * CSS-only. Timed by AppComponent (fade starts, then removal), not by
 * this component.
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
