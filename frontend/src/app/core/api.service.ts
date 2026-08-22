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
  RoundMvp,
  NewsArticle,
  NewsSyncStatus,
  Game,
  Prediction,
  LeaderboardEntry,
  PredictionSummary,
  Collectible,
  MyCollectible,
  SpinStatus,
  SpinResult,
  TradeableCard,
  MarketplaceCard,
  TradeOffer,
  PackDefinition,
  PackOpenOutcome,
  PackType,
  OwnedPack,
  RoundsInfo,
  Schedule,
  GameDetail,
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

  getRoundMvp(limit = 1): Observable<RoundMvp> {
    return this.http.get<RoundMvp>(`${API_BASE_URL}/players/round-mvp`, { params: { limit } });
  }

  getNews(limit = 20, lang?: string): Observable<NewsArticle[]> {
    const params: Record<string, number | string> = { limit };
    if (lang) params["lang"] = lang;
    return this.http.get<NewsArticle[]>(`${API_BASE_URL}/news`, { params });
  }

  getNewsSyncStatus(): Observable<NewsSyncStatus> {
    return this.http.get<NewsSyncStatus>(`${API_BASE_URL}/news/status`);
  }

  getTeamGames(teamId: string): Observable<Game[]> {
    return this.http.get<Game[]>(`${API_BASE_URL}/teams/${teamId}/games`);
  }

  getRounds(season: string): Observable<RoundsInfo> {
    return this.http.get<RoundsInfo>(`${API_BASE_URL}/games/rounds`, { params: { season } });
  }

  getSchedule(season: string, round?: number): Observable<Schedule> {
    return this.http.get<Schedule>(`${API_BASE_URL}/games/schedule`, {
      params: round ? { season, round } : { season },
    });
  }

  getGame(id: string): Observable<GameDetail> {
    return this.http.get<GameDetail>(`${API_BASE_URL}/games/${id}`);
  }

  simulateLiveGame(gameId?: string): Observable<{ gameId: string }> {
    return this.http.post<{ gameId: string }>(`${API_BASE_URL}/events/simulate`, gameId ? { gameId } : {});
  }

  completeLiveSimulation(): Observable<{ running: boolean }> {
    return this.http.post<{ running: boolean }>(`${API_BASE_URL}/events/simulate/complete`, {});
  }

  submitPrediction(gameId: string, teamId: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/predictions`, { gameId, teamId });
  }

  removePrediction(gameId: string): Observable<unknown> {
    return this.http.delete(`${API_BASE_URL}/predictions/${gameId}`);
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

  // Only the Predictions page should call this, once it's actually shown
  // the "Perfect round!" banner for whatever newRoundRewards it got back.
  ackRoundRewards(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/predictions/round-rewards/ack`, {});
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

  grantCard(email: string, collectibleId: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/collectibles/grant`, { email, collectibleId });
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

  updateGameHighlight(id: string, highlightVideoId: string): Observable<unknown> {
    return this.http.patch(`${API_BASE_URL}/games/${id}/highlight`, { highlightVideoId });
  }

  purchaseCollectible(id: string): Observable<{ collectible: Collectible; pointsSpent: number }> {
    return this.http.post<{ collectible: Collectible; pointsSpent: number }>(
      `${API_BASE_URL}/collectibles/${id}/purchase`,
      {}
    );
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

  getPacks(): Observable<PackDefinition[]> {
    return this.http.get<PackDefinition[]>(`${API_BASE_URL}/packs`);
  }

  openPack(type: PackType): Observable<PackOpenOutcome> {
    return this.http.post<PackOpenOutcome>(`${API_BASE_URL}/packs/${type}/open`, {});
  }

  getOwnedPacks(): Observable<OwnedPack[]> {
    return this.http.get<OwnedPack[]>(`${API_BASE_URL}/packs/owned`);
  }

  openOwnedPack(id: string): Observable<PackOpenOutcome> {
    return this.http.post<PackOpenOutcome>(`${API_BASE_URL}/packs/owned/${id}/open`, {});
  }

  getMyTradeableCards(): Observable<TradeableCard[]> {
    return this.http.get<TradeableCard[]>(`${API_BASE_URL}/trades/my-cards`);
  }

  setCardTradeable(collectibleId: string, tradeable: boolean): Observable<{ tradeable: boolean }> {
    return this.http.post<{ tradeable: boolean }>(`${API_BASE_URL}/trades/my-cards/${collectibleId}/tradeable`, {
      tradeable,
    });
  }

  getMarketplace(): Observable<MarketplaceCard[]> {
    return this.http.get<MarketplaceCard[]>(`${API_BASE_URL}/trades/marketplace`);
  }

  proposeTrade(offeredCollectibleIds: string[], requestedCollectibleId: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/trades`, { offeredCollectibleIds, requestedCollectibleId });
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