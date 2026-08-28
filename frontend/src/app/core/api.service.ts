import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { API_BASE_URL } from "./api-config";
import {
  Team,
  StandingsRow,
  RosterEntry,
  PlayerDetail,
  PlayerShotChart,
  PlayerGameLog,
  LeaderEntry,
  RoundMvp,
  PlayerAdvancedStats,
  AnalyticsView,
  AnalyticsViewCustomColumn,
  NewsArticle,
  NewsSyncStatus,
  Game,
  Prediction,
  LeaderboardEntry,
  PredictionSummary,
  PredictionAnalytics,
  Collectible,
  CollectiblesPage,
  CollectibleTeamFilter,
  CollectibleStatsResponse,
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

  getPlayerShots(playerId: string, season?: string): Observable<PlayerShotChart> {
    return this.http.get<PlayerShotChart>(`${API_BASE_URL}/players/${playerId}/shots`, {
      params: season ? { season } : {},
    });
  }

  getPlayerGames(playerId: string, season?: string): Observable<PlayerGameLog> {
    return this.http.get<PlayerGameLog>(`${API_BASE_URL}/players/${playerId}/games`, {
      params: season ? { season } : {},
    });
  }

  getLeaders(category: string, limit = 10): Observable<LeaderEntry[]> {
    return this.http.get<LeaderEntry[]>(`${API_BASE_URL}/players/leaders`, {
      params: { category, limit },
    });
  }

  getRoundMvp(limit = 1): Observable<RoundMvp> {
    return this.http.get<RoundMvp>(`${API_BASE_URL}/players/round-mvp`, { params: { limit } });
  }

  getAdvancedStats(): Observable<PlayerAdvancedStats> {
    return this.http.get<PlayerAdvancedStats>(`${API_BASE_URL}/players/advanced-stats`);
  }

  getAnalyticsViews(): Observable<AnalyticsView[]> {
    return this.http.get<AnalyticsView[]>(`${API_BASE_URL}/analytics-views`);
  }

  createAnalyticsView(body: {
    name: string;
    playerIds: string[];
    columns: string[];
    customColumns: AnalyticsViewCustomColumn[];
    sortKey: string | null;
    sortDesc: boolean;
  }): Observable<AnalyticsView> {
    return this.http.post<AnalyticsView>(`${API_BASE_URL}/analytics-views`, body);
  }

  updateAnalyticsView(
    id: string,
    body: {
      name: string;
      playerIds: string[];
      columns: string[];
      customColumns: AnalyticsViewCustomColumn[];
      sortKey: string | null;
      sortDesc: boolean;
    }
  ): Observable<AnalyticsView> {
    return this.http.patch<AnalyticsView>(`${API_BASE_URL}/analytics-views/${id}`, body);
  }

  deleteAnalyticsView(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/analytics-views/${id}`);
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

  // One request for a whole round's worth of picks/clears, submitted only
  // once the user taps "Complete predictions" — not one POST/DELETE per
  // tap. teamId: null clears that game's pick. errors (if any) is keyed by
  // gameId, for picks the backend rejected (e.g. a game that started while
  // the page was open) without failing the rest of the batch.
  submitPredictionsBatch(picks: { gameId: string; teamId: string | null }[]): Observable<{ ok: boolean; errors?: Record<string, string> }> {
    return this.http.post<{ ok: boolean; errors?: Record<string, string> }>(`${API_BASE_URL}/predictions/batch`, { picks });
  }

  getMyPredictions(): Observable<Prediction[]> {
    return this.http.get<Prediction[]>(`${API_BASE_URL}/predictions/me`);
  }

  getLeaderboard(): Observable<LeaderboardEntry[]> {
    return this.http.get<LeaderboardEntry[]>(`${API_BASE_URL}/predictions/leaderboard`);
  }

  getPredictionAnalytics(): Observable<PredictionAnalytics> {
    return this.http.get<PredictionAnalytics>(`${API_BASE_URL}/predictions/analytics`);
  }

  getMyPredictionSummary(): Observable<PredictionSummary> {
    return this.http.get<PredictionSummary>(`${API_BASE_URL}/predictions/me/summary`);
  }

  // Only the Predictions page should call this, once it's actually shown
  // the "Perfect round!" banner for whatever newRoundRewards it got back.
  ackRoundRewards(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/predictions/round-rewards/ack`, {});
  }

  // Same pattern as ackRoundRewards, for the separate (career-wide)
  // legendary-milestone banner — see newMilestoneRewards on PredictionSummary.
  ackMilestoneRewards(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/predictions/milestone-rewards/ack`, {});
  }

  adjustPoints(email: string, points: number, reason: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/predictions/points/adjust`, { email, points, reason });
  }

  getCollectibles(): Observable<Collectible[]> {
    return this.http.get<Collectible[]>(`${API_BASE_URL}/collectibles`);
  }

  // Paginated, filtered card list for the Store page — see CollectiblesPage's
  // doc comment for why this is a separate endpoint from getCollectibles().
  browseCollectibles(opts: {
    limit: number;
    offset: number;
    search?: string;
    team?: string | null;
    tier?: string | null;
  }): Observable<CollectiblesPage> {
    const params: Record<string, string | number> = { limit: opts.limit, offset: opts.offset };
    if (opts.search) params["search"] = opts.search;
    if (opts.team) params["team"] = opts.team;
    if (opts.tier) params["tier"] = opts.tier;
    return this.http.get<CollectiblesPage>(`${API_BASE_URL}/collectibles/browse`, { params });
  }

  getCollectibleTeams(): Observable<CollectibleTeamFilter[]> {
    return this.http.get<CollectibleTeamFilter[]>(`${API_BASE_URL}/collectibles/teams`);
  }

  getCollectibleStats(id: string): Observable<CollectibleStatsResponse> {
    return this.http.get<CollectibleStatsResponse>(`${API_BASE_URL}/collectibles/${id}/stats`);
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

  updateCollectibleImage(id: string, imageUrl: string): Observable<{ id: string; imageUrl: string | null }> {
    return this.http.patch<{ id: string; imageUrl: string | null }>(`${API_BASE_URL}/collectibles/${id}`, { imageUrl });
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

  cheatSpinFoil(): Observable<SpinResult> {
    return this.http.post<SpinResult>(`${API_BASE_URL}/spin/cheat-foil`, {});
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

  setCardWishlist(collectibleId: string, wishlist: string[]): Observable<{ wishlist: string[] }> {
    return this.http.post<{ wishlist: string[] }>(`${API_BASE_URL}/trades/my-cards/${collectibleId}/wishlist`, {
      wishlist,
    });
  }

  getMarketplace(): Observable<MarketplaceCard[]> {
    return this.http.get<MarketplaceCard[]>(`${API_BASE_URL}/trades/marketplace`);
  }

  // requestedListingId is a MarketplaceCard.id (userCollectibles.id) — not a
  // collectible/catalog id, which the same legendary can share across
  // multiple owners' listings (see routes/trades.ts's POST / comment).
  proposeTrade(offeredCollectibleIds: string[], requestedListingId: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/trades`, { offeredCollectibleIds, requestedListingId });
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