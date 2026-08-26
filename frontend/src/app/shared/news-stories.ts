import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { NewsArticle } from "../core/models";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";
import { RetryImgDirective } from "./retry-img.directive";

const STORY_DURATION_MS = 5000;
const TICK_MS = 50;
// How far down (px) a swipe needs to travel before it counts as
// "dismiss", not just an accidental drag mid-tap.
const SWIPE_CLOSE_THRESHOLD_PX = 100;

// Instagram-style "stories" over the news feed we already sync — a circular
// avatar rail (one ring per article, the article's own image as the
// thumbnail) that opens a full-screen, auto-advancing viewer on tap. Built
// as an alternative to grabbing EuroLeague's own official "stories" widget
// (a paid third-party vendor feed, licensed video content, not ours to
// pull) — same interaction pattern, powered by content this app already
// has the rights to show. No full article body is synced (article-preview's
// same constraint), so each story is image + title + summary with a
// "Read full article" link out, not an in-app reader.
@Component({
  selector: "app-news-stories",
  standalone: true,
  imports: [CommonModule, NavIconComponent, RetryImgDirective],
  templateUrl: "./news-stories.html",
  styleUrl: "./news-stories.css",
})
export class NewsStoriesComponent implements OnChanges, AfterViewInit, OnDestroy {
  protected i18n = inject(I18nService);

  @Input({ required: true }) articles: NewsArticle[] = [];
  // Fires whenever a story is actually opened — lets a parent (e.g. the
  // dashboard tour) know this widget was used, same spirit as other
  // "mark this seen" signals elsewhere in the app. Optional; nothing
  // currently listens.
  @Output() opened = new EventEmitter<NewsArticle>();

  readonly activeIndex = signal<number | null>(null);
  readonly progress = signal(0);
  // Not persisted (resets on reload) — just enough to dim a ring after
  // it's been opened this session, same "you've seen this" signal
  // Instagram's own rail gives, without needing backend/localStorage
  // plumbing for something this low-stakes.
  readonly viewedIds = signal<Set<string>>(new Set());

  readonly currentArticle = computed<NewsArticle | null>(() => {
    const idx = this.activeIndex();
    return idx === null ? null : (this.articles[idx] ?? null);
  });

  // Desktop-only arrow buttons over the rail (see news-stories.html's
  // `hidden sm:flex` on them) — touch already scrolls the rail natively via
  // swipe, but there's no equivalent affordance with just a mouse, and a
  // wide rail of 10 circles won't fully fit most desktop card widths.
  // Hidden entirely (not just disabled) at either end, same convention as
  // a typical carousel, rather than showing a dead button.
  private readonly rail = viewChild<ElementRef<HTMLDivElement>>("railEl");
  readonly canScrollLeft = signal(false);
  readonly canScrollRight = signal(false);

  scrollRail(direction: 1 | -1): void {
    const el = this.rail()?.nativeElement;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  onRailScroll(): void {
    const el = this.rail()?.nativeElement;
    if (!el) return;
    // 4px slop — avoids both arrows flickering in/out from sub-pixel
    // rounding right at either end.
    this.canScrollLeft.set(el.scrollLeft > 4);
    this.canScrollRight.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  @HostListener("window:resize")
  onWindowResize(): void {
    this.onRailScroll();
  }

  private timerHandle?: ReturnType<typeof setInterval>;

  isViewed(article: NewsArticle): boolean {
    return this.viewedIds().has(article.id);
  }

  progressFor(index: number): number {
    const active = this.activeIndex();
    if (active === null) return 0;
    if (index < active) return 100;
    if (index > active) return 0;
    return this.progress();
  }

  openAt(index: number): void {
    if (index < 0 || index >= this.articles.length) return;
    this.activeIndex.set(index);
    this.markViewed(index);
    this.opened.emit(this.articles[index]);
    this.startTimer();
  }

  close(): void {
    this.stopTimer();
    this.activeIndex.set(null);
    this.dragOffsetY.set(0);
    this.isDragging.set(false);
    this.dragStartX = null;
    this.dragStartY = null;
  }

  next(): void {
    const idx = this.activeIndex();
    if (idx === null) return;
    if (idx >= this.articles.length - 1) {
      this.close();
      return;
    }
    this.openAt(idx + 1);
  }

  prev(): void {
    const idx = this.activeIndex();
    if (idx === null) return;
    // Same as Instagram: tapping "back" on the very first story just
    // restarts it instead of closing or wrapping around.
    this.openAt(Math.max(0, idx - 1));
  }

  // Swipe-down-to-dismiss, like Instagram — the X button still works too,
  // this is additive. dragStartX/Y are plain fields, not signals: they're
  // only ever read synchronously within the same gesture, never rendered.
  // Deliberately NOT pausing the auto-advance timer on press anymore (an
  // earlier version did, to double as a "hold to pause" gesture) — that,
  // and a follow-up attempt at explicit setPointerCapture/
  // releasePointerCapture, were the actual cause of touch input getting
  // stuck app-wide on mobile after a press-and-drag. Plain pointer events
  // with no capture calls and no side effects on the timer is the smallest
  // version of this gesture that still does what was asked for
  // (swipe-to-close) without the instability the extra behavior brought.
  private dragStartX: number | null = null;
  private dragStartY: number | null = null;
  readonly dragOffsetY = signal(0);
  readonly isDragging = signal(false);
  // Fades out as the story's dragged down, so releasing mid-drag reads as
  // "this is about to dismiss" rather than the image just silently moving.
  readonly dragOpacity = computed(() => Math.max(0.4, 1 - this.dragOffsetY() / 400));

  onStoryPointerDown(event: PointerEvent): void {
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.isDragging.set(true);
  }

  onStoryPointerMove(event: PointerEvent): void {
    if (this.dragStartY === null) return;
    const deltaY = event.clientY - this.dragStartY;
    // Only follow downward drags — an upward drag has nothing to reveal
    // here (no "more info" sheet), so it shouldn't visually tug the story.
    this.dragOffsetY.set(Math.max(0, deltaY));
  }

  // Shared by pointerup and pointerleave/pointercancel (a finger dragged
  // off the story area without a clean release still needs to resolve the
  // gesture one way or the other) — both carry the same clientX/clientY
  // fields PointerEvent always has.
  onStoryPointerEnd(event: PointerEvent): void {
    const startX = this.dragStartX;
    const startY = this.dragStartY;
    this.dragStartX = null;
    this.dragStartY = null;
    this.isDragging.set(false);

    const deltaY = startY === null ? 0 : event.clientY - startY;
    const deltaX = startX === null ? 0 : event.clientX - startX;

    if (deltaY > SWIPE_CLOSE_THRESHOLD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
      this.dragOffsetY.set(0);
      this.close();
      return;
    }

    this.dragOffsetY.set(0);
  }

  private markViewed(index: number): void {
    const article = this.articles[index];
    if (!article) return;
    this.viewedIds.update((ids) => {
      if (ids.has(article.id)) return ids;
      const next = new Set(ids);
      next.add(article.id);
      return next;
    });
  }

  private startTimer(fromProgress = 0): void {
    this.stopTimer();
    this.progress.set(fromProgress);
    this.timerHandle = setInterval(() => {
      const value = this.progress() + (TICK_MS / STORY_DURATION_MS) * 100;
      if (value >= 100) {
        this.progress.set(100);
        this.next();
      } else {
        this.progress.set(value);
      }
    }, TICK_MS);
  }

  private stopTimer(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.activeIndex() !== null) this.close();
  }

  @HostListener("document:keydown.arrowRight")
  onArrowRight(): void {
    if (this.activeIndex() !== null) this.next();
  }

  @HostListener("document:keydown.arrowLeft")
  onArrowLeft(): void {
    if (this.activeIndex() !== null) this.prev();
  }

  ngAfterViewInit(): void {
    // Deferred a tick — right after view init the rail's images haven't
    // necessarily laid out yet, so scrollWidth can read too small and miss
    // that the right arrow should show.
    setTimeout(() => this.onRailScroll());
  }

  // articles is a plain @Input, not a signal — this is what notices a
  // fresh set (e.g. a language toggle re-fetching the news feed) and
  // re-checks whether the rail overflows, same reason ngAfterViewInit
  // needs to.
  ngOnChanges(): void {
    setTimeout(() => this.onRailScroll());
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }
}
