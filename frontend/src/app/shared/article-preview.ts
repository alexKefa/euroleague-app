import { Component, EventEmitter, HostListener, Input, Output, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { NewsArticle } from "../core/models";
import { I18nService } from "../core/i18n.service";
import { RetryImgDirective } from "./retry-img.directive";
import { newsDateFormat, newsDateLocale } from "./news-date-format";

// Same boxed-card modal chrome as stat-legend (bg-black/80 backdrop,
// bg-card rounded-2xl card, floating top-right close) — tried card-preview's
// borderless "content floats on the backdrop" style first, but text-heavy
// content with no card behind it just read as empty, not like a dialog. A
// news tap now previews in-app instead of immediately leaving to the
// source site. There's no full article body synced, only an RSS summary,
// so this stays a rich preview (image, source, summary) with a "Read full
// article" link out for the whole piece, not a full in-app reader. The
// link uses accent2 as plain text, same as every other "leaving to
// something else" link in the app (Roster's "Predict", Predictions' "Spend
// Points") — not a filled/outline button, which read as too heavy here.
@Component({
  selector: "app-article-preview",
  standalone: true,
  imports: [CommonModule, RetryImgDirective],
  templateUrl: "./article-preview.html",
})
export class ArticlePreviewComponent {
  protected i18n = inject(I18nService);

  @Input({ required: true }) article!: NewsArticle;
  @Output() closed = new EventEmitter<void>();

  close(): void {
    this.closed.emit();
  }

  dateFormat(): string {
    return newsDateFormat(this.i18n.lang(), true);
  }

  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.close();
  }
}
