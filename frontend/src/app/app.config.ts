import { ApplicationConfig } from "@angular/core";
import { NavigationError, provideRouter, withInMemoryScrolling, withNavigationErrorHandler } from "@angular/router";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { routes } from "./app.routes";
import { authInterceptor } from "./core/auth.interceptor";

// A lazily-loaded page's chunk failing to load (2026-09-29, reported as
// "on mobile the first link I press does nothing, and never works until I
// restart the app"). Every deploy renames the route chunks, so a phone that
// kept the app open still holds the previous build's chunk names; the first
// tap on a page it hasn't opened yet requests a file that no longer exists,
// the navigation errors silently and nothing happens (pages already visited
// keep working since their chunks are in memory). Recover by loading that
// URL with a full page load, which also picks up the new build. Guarded so a
// genuinely missing chunk can't reload-loop.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed/i;
const RELOAD_GUARD_KEY = "clutch-chunk-reload";

function handleNavigationError(event: NavigationError): void {
  const err = event.error as { message?: string; name?: string } | undefined;
  const text = `${err?.name ?? ""} ${err?.message ?? String(event.error ?? "")}`;
  if (!CHUNK_ERROR.test(text)) return;
  try {
    const last = sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (last && Date.now() - Number(last) < 10000) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: still try once */
  }
  window.location.assign(event.url);
}

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
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: "enabled", anchorScrolling: "enabled" }),
      withNavigationErrorHandler(handleNavigationError),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
