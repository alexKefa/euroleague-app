import { Injectable, inject, signal, computed } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, tap, catchError, of, map } from "rxjs";
import { API_BASE_URL } from "./api-config";
import { PublicUser } from "./models";

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
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
    referralCode?: string | null
  ): Observable<PublicUser> {
    return this.http
      .post<AuthResponse>(
        `${API_BASE_URL}/auth/register`,
        { email, password, favoriteTeamId, referralCode },
        { withCredentials: true }
      )
      .pipe(tap((res) => this.setSession(res)), map((res) => res.user));
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
    return this.http
      .post<{ accessToken: string }>(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .pipe(
        tap((res) => this.accessToken.set(res.accessToken)),
        tap(() => this.loadCurrentUser().subscribe()),
        map(() => true),
        catchError(() => of(false))
      );
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