import { Component, Input, inject } from "@angular/core";
import { I18nService } from "../core/i18n.service";

interface SplashCard {
  name: string;
  photoUrl: string;
}

// A small curated pool of real players (photos confirmed reachable on
// EuroLeague's own live media CDN, 2026-09-10 — same source
// player_stats_sync.py pulls from, same as the two originally hardcoded
// here) — deliberately NOT fetched from the API at splash time: the whole
// point of this screen is an instant, zero-network brand moment, and a
// live fetch would either delay the splash until it resolved or risk the
// cards popping in mid-animation. Picking 3 of these at random client-side
// costs nothing and still gives some variety across app loads. The coach
// card this pool replaced is gone outright, not folded in here — coaches
// have no photo field anywhere in this app's data model (they aren't in
// `players` at all), so a "random coach" would always just be the generic
// team-badge fallback, not a real photo.
const SPLASH_CARD_POOL: SplashCard[] = [
  { name: "Evan Fournier", photoUrl: "https://media-cdn.cortextech.io/948551c5-285e-44d1-8a50-35cd9b019e97.png" },
  { name: "Kendrick Nunn", photoUrl: "https://media-cdn.cortextech.io/6a45d41a-03f4-482a-b7ed-40adc56d5af8.png" },
  { name: "Sergio Llull", photoUrl: "https://media-cdn.cortextech.io/38500d8f-02b6-40a7-a6b7-c9fb901a0f6e.png" },
  { name: "Kenneth Faried", photoUrl: "https://media-cdn.cortextech.io/fbabd4a4-b08e-456e-b82a-c31a44ca371a.png" },
];

// Fisher-Yates-ish partial shuffle is overkill for picking 3 of 4 — a
// plain random-comparator sort is fine at this size and this is purely
// decorative, not anything that needs a uniform distribution guarantee.
function pickThreeCards(): SplashCard[] {
  return [...SPLASH_CARD_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
}

/**
 * Brand moment shown briefly on app load — three mini collectible cards
 * flip face-up first, floating over the upper half of a huge, very faint
 * basketball watermark (a separate, older motif — same glyph as
 * nav-icon.ts's "ball" case, not this brand mark), then the combination
 * mark settles dead-center on that same watermark: a real open "C" ring
 * (ink, theme-reactive) with a small basketball nested inside its hollow
 * (the app's fixed highlight orange, #FF6B35), then "lutch" continues
 * right after, then the tagline curves along the watermark's bottom rim.
 * The cards and the logo are independently positioned (2026-09-10 —
 * previously the logo was just whatever fell out of centering the
 * cards+logo block as one flex column, which left it noticeably below the
 * watermark's actual center) rather than stacked in one flex column, so
 * the logo can sit exactly at the ball's true center while the cards float
 * above it as their own absolutely-positioned layer — "cards on top of
 * the ball, logo in the middle," not two pieces of one taller block that
 * only looked roughly centered as a whole.
 *
 * The three cards use the exact tier gradients real Store/Album cards use
 * (silver/gold — collectible-card.ts's TierStyle; the third slot also
 * uses silver rather than the coach-only violet gradient, now that all
 * three are player cards, not two players + a coach) and carry real
 * photos, randomly drawn from `cards` (see SPLASH_CARD_POOL above) on each
 * app load rather than a coach card — coaches have no photo anywhere in
 * this app's data model. Each card keeps rotating further open then
 * relaxing back — a real fan gesture, not frozen once it flips in — for
 * the whole hold, with only a tiny (6%) scale bump; independent timing
 * per card so the three don't move in sync.
 *
 * 2026-09-08 rebrand, sixth pass landed the mark itself (see git history
 * for the five earlier tries); that pass (same day) extended the hold
 * (app.component.ts's SPLASH_DURATION_MS, 1200ms -> 2600ms — not tied to
 * real route-readiness, no shared "is the destination done loading" signal
 * exists across components, just a longer flat hold generous enough to
 * usually cover a cold dashboard load) and added the card fan; the
 * entrance itself later went from a rise-up, to a toss-and-fall, to the
 * current Y-axis flip (all 2026-09-10, see splash.css's silver-in/
 * gold-in/violet-in keyframes). Not pure SVG/CSS (the three photos are
 * real `<img>`s hitting an external CDN) — everything else stays
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
  protected readonly cards = pickThreeCards();
}
