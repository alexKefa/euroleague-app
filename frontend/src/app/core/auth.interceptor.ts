import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { AuthService } from "./auth.service";
import { API_BASE_URL } from "./api-config";

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.accessToken();

  if (!token || !req.url.startsWith(API_BASE_URL)) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};