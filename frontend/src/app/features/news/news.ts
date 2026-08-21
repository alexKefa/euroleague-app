import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { NewsArticle } from "../../core/models";

@Component({
  selector: "app-news",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./news.html",
})
export class NewsComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly articles = signal<NewsArticle[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getNews(30).subscribe({
      next: (articles) => {
        this.articles.set(articles);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("news.loadError"));
        this.loading.set(false);
      },
    });
  }
}