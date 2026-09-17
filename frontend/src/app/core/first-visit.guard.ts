import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { map } from "rxjs";
import { AuthService } from "./auth.service";
import { hasVisitedBefore, markVisited } from "../shared/visited";

// Lets social/QR traffic share the plain root URL instead of /welcome
// directly, while still giving a genuinely cold, logged-out visitor the
// pitch page first. Waits on restoreSession() (cached — see auth.service.ts
// — so this doesn't duplicate AppComponent's own boot-time call) rather than
// reading currentUser() immediately, since that signal is still null for a
// few hundred ms into boot even for a real logged-in user restoring their
// session off the httpOnly refresh cookie (the same bootstrap race
// documented in CLAUDE.md) — deciding before that resolves would bounce a
// real returning user to /welcome.
export const firstVisitGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.restoreSession().pipe(
    map(() => {
      if (!auth.currentUser() && !hasVisitedBefore()) {
        return router.createUrlTree(["/welcome"]);
      }
      markVisited();
      return true;
    })
  );
};
