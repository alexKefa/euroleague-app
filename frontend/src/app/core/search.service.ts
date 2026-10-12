import { Injectable, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "./api-config";
import { SearchIndex, SearchResult } from "../shared/search-match";

const RECENT_KEY = "clutch-recent-search";
const MAX_RECENT = 5;

/**
 * Global search (2026-10-12): opens the dialog and holds the index, fetched
 * once on first open and kept for the session. Matching itself is pure
 * (shared/search-match.ts). Recent picks are per device.
 */
@Injectable({ providedIn: "root" })
export class SearchService {
  private http = inject(HttpClient);

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly index = signal<SearchIndex | null>(null);

  show(): void {
    this.open.set(true);
    if (this.index() || this.loading()) return;
    this.loading.set(true);
    this.http.get<SearchIndex>(`${API_BASE_URL}/search/index`).subscribe({
      next: (idx) => {
        this.index.set(idx);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  hide(): void {
    this.open.set(false);
  }

  recent(): SearchResult[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      return raw ? (JSON.parse(raw) as SearchResult[]).slice(0, MAX_RECENT) : [];
    } catch {
      return [];
    }
  }

  remember(r: SearchResult): void {
    try {
      const next = [r, ...this.recent().filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Private mode or storage full: recents are a convenience only.
    }
  }
}
