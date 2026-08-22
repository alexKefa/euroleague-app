import { Component, EventEmitter, HostListener, Input, Output, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { NewsArticle } from "../core/models";
import { I18nService } from "../core/i18n.service";
import { RetryImgDirective } from "./retry-img.directive";
import { ButtonDirective } from "./button.directive";

// Same modal chrome as stat-legend/card-preview (bg-black/80 backdrop,
// bg-card rounded-2xl card, floating top-right close) — a news tap now
// previews in-app instead of immediately leaving to the source site. There's
// no full article body synced, only a summary, so this stays a rich
// preview (image, source, summary) with a "Read full article" link out for
// anyone who wants the whole piece, not a full in-app reader.
@Component({
  selector: "app-article-preview",
  standalone: true,
  imports: [CommonModule, RetryImgDirective, ButtonDirective],
  templateUrl: "./article-preview.html",
})
export class ArticlePreviewComponent {
  protected i18n = inject(I18nService);

  @Input({ required: true }) article!: NewsArticle;
  @Output() closed = new EventEmitter<void>();

  close(): void {
    this.closed.emit();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.close();
  }
}
