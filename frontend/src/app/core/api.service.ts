import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { API_BASE_URL } from "./api-config";
import { Team, StandingsRow, RosterEntry, LeaderEntry } from "./models";

/**
 * Wraps HttpClient calls to the backend's /api routes.
 */
@Injectable({ providedIn: "root" })
export class ApiService {
  private http = inject(HttpClient);

  getTeams(): Observable<Team[]> {
    return this.http.get<Team[]>(`${API_BASE_URL}/teams`);
  }

  getStandings(): Observable<StandingsRow[]> {
    return this.http.get<StandingsRow[]>(`${API_BASE_URL}/standings`);
  }

  getRoster(teamId: string): Observable<RosterEntry[]> {
    return this.http.get<RosterEntry[]>(`${API_BASE_URL}/teams/${teamId}/roster`);
  }

  getLeaders(category: string, limit = 10): Observable<LeaderEntry[]> {
    return this.http.get<LeaderEntry[]>(`${API_BASE_URL}/players/leaders`, {
      params: { category, limit },
    });
  }
}