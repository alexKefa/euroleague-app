import { Injectable, inject, signal, computed } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, tap, catchError, of, map, switchMap, finalize, shareReplay } from "rxjs";
import { API_BASE_URL } from "./api-config";
import { PublicUser } from "./models";

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  promo?: { packType: string; bonusPoints: number } | null;
}

export interface RegisterResult {
  user: PublicUser;
  promo: { packType: string; bonusPoints: number } | null;
}

@Injectable({ providedIn: "root" })
export class AuthService {
  private http = inject(HttpClient);

  // Access token lives in memory only — never localStorage, never a
  // non-httpOnly cookie. It's gone on a hard refresh, which is what
  // restoreSession() (backed by the httpOnly refresh cookie) is for.
  readonly accessToken = signal<string | null>(null);
  readonly currentUser = signal<PublicUser | null>(null);
  readonly isAuthenticated = computed(() => this.accessToken() !== null);

  register(
    email: string,
    password: string,
    favoriteTeamId?: string | null,
    referralCode?: string | null,
    promoCode?: string | null
  ): Observable<RegisterResult> {
    return this.http
      .post<AuthResponse>(
        `${API_BASE_URL}/auth/register`,
        { email, password, favoriteTeamId, referralCode, promoCode },
        { withCredentials: true }
      )
      .pipe(
        tap((res) => this.setSession(res)),
        map((res) => ({ user: res.user, promo: res.promo ?? null }))
      );
  }

  login(email: string, password: string): Observable<PublicUser> {
    return this.http
      .post<AuthResponse>(`${API_BASE_URL}/auth/login`, { email, password }, { withCredentials: true })
      .pipe(tap((res) => this.setSession(res)), map((res) => res.user));
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${API_BASE_URL}/auth/logout`, {}, { withCredentials: true }).pipe(
      tap(() => {
        this.accessToken.set(null);
        this.currentUser.set(null);
      })
    );
  }

  /**
   * Called once on app startup. Tries to trade the httpOnly refresh
   * cookie (if any) for a fresh access token, so a page reload doesn't
   * force a re-login. Silently no-ops if there's no valid cookie —
   * that's just "not logged in", not an error worth surfacing.
   */
  restoreSession(): Observable<boolean> {
    return this.refreshAccessToken().pipe(
      switchMap((token) => (token ? this.loadCurrentUser().pipe(map(() => true)) : of(false)))
    );
  }

  // Access tokens expire after JWT_ACCESS_EXPIRES_IN (15m default) and
  // nothing was ever re-fetching one after boot — every request just 401'd
  // forever once a session ran past that, even though the refresh cookie
  // (30d) was still perfectly valid. auth.interceptor.ts calls this on a
  // 401 and retries the original request; restoreSession() above also
  // funnels through it on boot. Deduped via shareReplay so N requests that
  // all 401 around the same moment trigger one /auth/refresh call, not N —
  // finalize clears refreshInFlight once that call settles so the *next*
  // expiry starts a fresh one rather than replaying a stale result forever.
  private refreshInFlight: Observable<string | null> | null = null;

  refreshAccessToken(): Observable<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.http
      .post<{ accessToken: string }>(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .pipe(
        tap((res) => this.accessToken.set(res.accessToken)),
        map((res) => res.accessToken),
        catchError(() => {
          // The refresh cookie itself is gone/invalid, not just the access
          // token — the session is genuinely over. Clear it so the UI
          // reflects "logged out" instead of silently 401ing forever.
          this.accessToken.set(null);
          this.currentUser.set(null);
          return of(null);
        }),
        finalize(() => {
          this.refreshInFlight = null;
        }),
        shareReplay(1)
      );

    return this.refreshInFlight;
  }

  private loadCurrentUser(): Observable<PublicUser | null> {
    return this.http.get<PublicUser>(`${API_BASE_URL}/users/me`).pipe(
      tap((user) => this.currentUser.set(user)),
      catchError(() => of(null))
    );
  }

  updateFavoriteTeam(teamId: string | null): Observable<PublicUser> {
    return this.http
      .patch<PublicUser>(`${API_BASE_URL}/users/me`, { favoriteTeamId: teamId })
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  private setSession(res: AuthResponse): void {
    this.accessToken.set(res.accessToken);
    this.currentUser.set(res.user);
  }
}