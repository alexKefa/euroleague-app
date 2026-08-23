export interface TourStep {
  // Omitted = stay on whatever route the tour was started from (used by the
  // welcome/closing steps, which aren't tied to any one page).
  route?: string;
  // data-tour attribute selector for the element to spotlight. Omitted =
  // a centered step with no spotlight (welcome/closing, or intentionally
  // page-level). If the selector isn't found on screen within a few hundred
  // ms (loading/empty states), TourService falls back to a centered step
  // automatically rather than getting stuck.
  selector?: string;
  // True when the target only renders for a logged-in user (behind
  // `@if (auth.isAuthenticated())` on its page) — TourService skips these
  // entirely for a guest rather than showing them the fallback centered
  // card with no spotlight, since the copy describes UI they can't see.
  requiresAuth?: boolean;
  // Inverse of requiresAuth — shown only to a guest, skipped once logged
  // in. Used for the "there's more once you log in" nudge, which would be
  // redundant (and read oddly, referring to a locked-in-future-tense
  // feature the viewer already has) for someone already signed in.
  guestOnly?: boolean;
  titleKey: string;
  bodyKey: string;
  // Optional extra call-to-action button rendered alongside Next/Skip —
  // clicking it ends the tour and navigates to ctaRoute. Non-blocking:
  // Next still moves on without taking it.
  ctaLabelKey?: string;
  ctaRoute?: string;
}

export const TOUR_STEPS: TourStep[] = [
  { titleKey: "tour.step.welcome.title", bodyKey: "tour.step.welcome.body" },
  {
    route: "/predictions",
    selector: "[data-tour='predictions-picks']",
    titleKey: "tour.step.predictions.title",
    bodyKey: "tour.step.predictions.body",
  },
  {
    route: "/inventory",
    selector: "[data-tour='cards-hub']",
    requiresAuth: true,
    titleKey: "tour.step.cards.title",
    bodyKey: "tour.step.cards.body",
  },
  {
    // The catalog page, not My Cards — always has the full set of
    // collectibles on display (locked and unlocked) regardless of what a
    // fresh demo account actually owns, unlike Inventory's grid which is
    // empty until the first card is earned.
    route: "/store",
    selector: "[data-tour='store-cards']",
    titleKey: "tour.step.storeCards.title",
    bodyKey: "tour.step.storeCards.body",
  },
  {
    route: "/wheel",
    selector: "[data-tour='wheel-spin']",
    requiresAuth: true,
    titleKey: "tour.step.wheel.title",
    bodyKey: "tour.step.wheel.body",
  },
  {
    route: "/packs",
    selector: "[data-tour='packs-grid']",
    requiresAuth: true,
    titleKey: "tour.step.packs.title",
    bodyKey: "tour.step.packs.body",
  },
  {
    route: "/trades",
    selector: "[data-tour='trades-marketplace']",
    requiresAuth: true,
    titleKey: "tour.step.trades.title",
    bodyKey: "tour.step.trades.body",
  },
  {
    route: "/profile",
    selector: "[data-tour='profile-referral']",
    requiresAuth: true,
    titleKey: "tour.step.profile.title",
    bodyKey: "tour.step.profile.body",
  },
  {
    guestOnly: true,
    titleKey: "tour.step.guestCta.title",
    bodyKey: "tour.step.guestCta.body",
    ctaLabelKey: "tour.cta.register",
    ctaRoute: "/register",
  },
  { titleKey: "tour.step.done.title", bodyKey: "tour.step.done.body" },
];
