import { Component, OnInit, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { NewsArticle } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ArticlePreviewComponent } from "../../shared/article-preview";
import { newsDateFormat, newsDateLocale } from "../../shared/news-date-format";

@Component({
  selector: "app-news",
  standalone: true,
  imports: [CommonModule, RetryImgDirective, ArticlePreviewComponent],
  templateUrl: "./news.html",
})
export class NewsComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly articles = signal<NewsArticle[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private readonly lastSyncedAt = signal<string | null>(null);

  private readonly previewArticleId = signal<string | null>(null);
  readonly previewArticle = computed(() => this.articles().find((a) => a.id === this.previewArticleId()) ?? null);

  // Computed once from the fetched timestamp rather than ticking live —
  // this is a freshness indicator (is the sync still running?), not a
  // countdown, and the sync interval itself is 10 minutes so minute-level
  // precision on page load is already more than enough.
  readonly lastSyncedLabel = computed(() => {
    const iso = this.lastSyncedAt();
    if (!iso) return null;
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return `${this.i18n.t("news.lastUpdated")} ${this.i18n.t("news.justNow")}`;
    if (minutes < 60) return `${this.i18n.t("news.lastUpdated")} ${minutes} ${this.i18n.t("news.minAgo")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${this.i18n.t("news.lastUpdated")} ${hours} ${this.i18n.t("news.hAgo")}`;
    const days = Math.floor(hours / 24);
    return `${this.i18n.t("news.lastUpdated")} ${days} ${this.i18n.t("news.dAgo")}`;
  });

  constructor() {
    // Re-fetches whenever the language toggle changes while this page is
    // open, not just on first load — Eurohoops publishes en/el as fully
    // separate feeds (see backend/src/sync/newsSync.ts), so switching
    // language here means genuinely different articles, not a translation
    // of the same ones.
    effect(() => {
      const lang = this.i18n.lang();
      this.loading.set(true);
      this.api.getNews(30, lang).subscribe({
        next: (articles) => {
          this.articles.set(articles);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(this.i18n.t("news.loadError"));
          this.loading.set(false);
        },
      });
    });
  }

  ngOnInit(): void {
    this.api.getNewsSyncStatus().subscribe({
      next: (status) => this.lastSyncedAt.set(status.lastSyncedAt),
      error: () => {},
    });
  }

  dateFormat(): string {
    return newsDateFormat(this.i18n.lang(), false);
  }

  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  openPreview(article: NewsArticle): void {
    this.previewArticleId.set(article.id);
  }

  closePreview(): void {
    this.previewArticleId.set(null);
  }
}
