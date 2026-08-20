import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { API_BASE_URL } from "./api-config";
import {
  Team,
  StandingsRow,
  RosterEntry,
  PlayerDetail,
  LeaderEntry,
  NewsArticle,
  Game,
  Prediction,
  LeaderboardEntry,
  PredictionSummary,
  Collectible,
  MyCollectible,
  SpinStatus,
  SpinResult,
  TradeableCard,
  TradeOffer,
} from "./models";

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

  getPlayer(playerId: string): Observable<PlayerDetail> {
    return this.http.get<PlayerDetail>(`${API_BASE_URL}/players/${playerId}`);
  }

  getLeaders(category: string, limit = 10): Observable<LeaderEntry[]> {
    return this.http.get<LeaderEntry[]>(`${API_BASE_URL}/players/leaders`, {
      params: { category, limit },
    });
  }

  getNews(limit = 20): Observable<NewsArticle[]> {
    return this.http.get<NewsArticle[]>(`${API_BASE_URL}/news`, { params: { limit } });
  }

  getTeamGames(teamId: string): Observable<Game[]> {
    return this.http.get<Game[]>(`${API_BASE_URL}/teams/${teamId}/games`);
  }

  getUpcomingGames(limit = 10): Observable<Game[]> {
    return this.http.get<Game[]>(`${API_BASE_URL}/games`, {
      params: { status: "scheduled", limit },
    });
  }

  submitPrediction(gameId: string, teamId: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/predictions`, { gameId, teamId });
  }

  getMyPredictions(): Observable<Prediction[]> {
    return this.http.get<Prediction[]>(`${API_BASE_URL}/predictions/me`);
  }

  getLeaderboard(): Observable<LeaderboardEntry[]> {
    return this.http.get<LeaderboardEntry[]>(`${API_BASE_URL}/predictions/leaderboard`);
  }

  getMyPredictionSummary(): Observable<PredictionSummary> {
    return this.http.get<PredictionSummary>(`${API_BASE_URL}/predictions/me/summary`);
  }

  adjustPoints(email: string, points: number, reason: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/predictions/points/adjust`, { email, points, reason });
  }

  getCollectibles(): Observable<Collectible[]> {
    return this.http.get<Collectible[]>(`${API_BASE_URL}/collectibles`);
  }

  getMyCollectibles(): Observable<MyCollectible[]> {
    return this.http.get<MyCollectible[]>(`${API_BASE_URL}/collectibles/me`);
  }

  redeemCollectible(id: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/collectibles/${id}/redeem`, {});
  }

  addCollectible(
    name: string,
    teamId: string,
    tier: string,
    pointsCost: number,
    imageUrl?: string
  ): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/collectibles`, { name, teamId, tier, pointsCost, imageUrl });
  }

  updateCollectibleImage(id: string, imageUrl: string): Observable<unknown> {
    return this.http.patch(`${API_BASE_URL}/collectibles/${id}`, { imageUrl });
  }

  getSpinStatus(): Observable<SpinStatus> {
    return this.http.get<SpinStatus>(`${API_BASE_URL}/spin`);
  }

  spin(): Observable<SpinResult> {
    return this.http.post<SpinResult>(`${API_BASE_URL}/spin`, {});
  }

  cheatSpin(): Observable<SpinResult> {
    return this.http.post<SpinResult>(`${API_BASE_URL}/spin/cheat`, {});
  }

  getTradeableCards(email?: string): Observable<TradeableCard[]> {
    return this.http.get<TradeableCard[]>(`${API_BASE_URL}/trades/tradeable-cards`, {
      params: email ? { email } : {},
    });
  }

  proposeTrade(
    toEmail: string,
    offeredCollectibleId: string,
    requestedCollectibleId: string
  ): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/trades`, { toEmail, offeredCollectibleId, requestedCollectibleId });
  }

  getMyTrades(): Observable<TradeOffer[]> {
    return this.http.get<TradeOffer[]>(`${API_BASE_URL}/trades/me`);
  }

  acceptTrade(id: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/trades/${id}/accept`, {});
  }

  declineTrade(id: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/trades/${id}/decline`, {});
  }

  cancelTrade(id: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/trades/${id}/cancel`, {});
  }
}