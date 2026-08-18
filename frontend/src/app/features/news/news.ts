import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { NewsArticle } from "../../core/models";

@Component({
  selector: "app-news",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./news.html",
})
export class NewsComponent implements OnInit {
  private api = inject(ApiService);

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
        this.error.set("Couldn't load news right now.");
        this.loading.set(false);
      },
    });
  }
}