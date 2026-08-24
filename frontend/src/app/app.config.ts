import { ApplicationConfig } from "@angular/core";
import { provideRouter, withInMemoryScrolling } from "@angular/router";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { routes } from "./app.routes";
import { authInterceptor } from "./core/auth.interceptor";

export const appConfig: ApplicationConfig = {
  providers: [
    // Without this, the Router leaves the document's scroll offset alone on
    // navigation — scroll halfway down a long page, tap a nav tab, and the
    // next page renders already scrolled halfway down instead of at the
    // top. `enabled` (not `top`) resets to the top on a normal forward
    // navigation but still restores the prior scroll offset on browser
    // back/forward, matching how a plain multi-page site would behave.
    // `anchorScrolling` keeps `#fragment` links (if any get added later)
    // jumping to that element instead of always forcing the top.
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: "enabled", anchorScrolling: "enabled" })),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
