import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { catchError, switchMap, throwError } from "rxjs";
import { AuthService } from "./auth.service";
import { API_BASE_URL } from "./api-config";

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (!req.url.startsWith(API_BASE_URL)) {
    return next(req);
  }

  const token = auth.accessToken();
  const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    // A 401 here almost always means the access token expired mid-session
    // (15m default, see auth.service.ts) — refresh once via the httpOnly
    // cookie and retry the exact same request, rather than surfacing the
    // 401 to whatever page happened to be open. Only for a request that
    // actually carried a token and isn't itself an /auth/* call (retrying
    // a failed login/refresh with a refreshed token makes no sense).
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        token &&
        !req.url.startsWith(`${API_BASE_URL}/auth/`)
      ) {
        return auth.refreshAccessToken().pipe(
          switchMap((newToken) => {
            if (!newToken) return throwError(() => err);
            return next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } }));
          })
        );
      }
      return throwError(() => err);
    })
  );
};
