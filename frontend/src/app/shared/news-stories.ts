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

// Material's "emphasized" easing (used by Flutter's own Material widgets,
// e.g. Hero/PageTransition default curves) — a fast start with a long,
// gentle settle. Used for the open/collapse morph and the ripple, so this
// component's motion actually reads as Material/Flutter-flavored rather
// than a generic CSS `ease`.
const MATERIAL_EMPHASIZED = "cubic-bezier(0.2, 0, 0, 1)";
const MATERIAL_EMPHASIZED_ACCELERATE = "cubic-bezier(0.3, 0, 0.8, 0.15)";

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

  // Hero-style shared-element transition (2026-09-24, "more like Flutter" —
  // this is Flutter's own signature Hero widget effect: the tapped element
  // visually morphs into the full-screen view instead of it just appearing).
  // Plain refs to the two elements the morph/cross-fade animate, driven
  // imperatively via the Web Animations API rather than the rest of this
  // component's signal+CSS-transition idiom — a rect-to-rect transform
  // computed from a runtime DOMRect doesn't fit a declarative CSS binding.
  private readonly viewerEl = viewChild<ElementRef<HTMLDivElement>>("viewerEl");
  private readonly contentEl = viewChild<ElementRef<HTMLDivElement>>("contentEl");
  // The clicked avatar's rect at the moment a story was opened — null when
  // opened without a real click (keyboard/programmatic), in which case the
  // hero morph is skipped in favor of a plain fade.
  private originRect: DOMRect | null = null;
  // Set once a swipe-dismiss has been released past the threshold, so
  // dragOpacity below can actually reach 0 (its normal drag-tracking floor
  // is 0.4, so a story never looked fully gone until this flag lifts it).
  private readonly flungOffscreen = signal(false);

  private prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  // Material ripple (2026-09-24) — a small expanding, fading circle from
  // the exact tap point, the other half of "Flutter-like" alongside the
  // hero morph. Shared by every tappable control in this component (rail
  // avatars, rail scroll arrows, viewer close/prev/next) rather than a new
  // app-wide directive, since this pass is scoped to this component.
  spawnRipple(event: PointerEvent): void {
    if (this.prefersReducedMotion()) return;
    const host = event.currentTarget as HTMLElement;
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const span = document.createElement("span");
    span.className = "story-ripple";
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    span.style.left = `${event.clientX - rect.left - size / 2}px`;
    span.style.top = `${event.clientY - rect.top - size / 2}px`;
    host.appendChild(span);
    span.addEventListener("animationend", () => span.remove());
  }

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

  // `event` is the originating click on a rail avatar — its rect seeds the
  // hero-open morph. Omitted (or called while already open, from
  // next()/prev()) means no morph: either a plain fade-in (first open with
  // no click, e.g. a future keyboard trigger) or the in-viewer cross-fade
  // between stories (see playContentTransition below).
  openAt(index: number, event?: MouseEvent): void {
    if (index < 0 || index >= this.articles.length) return;
    const wasAlreadyOpen = this.activeIndex() !== null;
    if (!wasAlreadyOpen) {
      this.originRect = event ? (event.currentTarget as HTMLElement).getBoundingClientRect() : null;
    }
    this.activeIndex.set(index);
    this.markViewed(index);
    this.opened.emit(this.articles[index]);
    this.startTimer();
    // Deferred a tick, same convention as onRailScroll elsewhere in this
    // file — right after a signal-driven render the target element isn't
    // necessarily laid out yet, and the hero morph needs its real rect.
    if (!wasAlreadyOpen) {
      setTimeout(() => requestAnimationFrame(() => this.playHeroOpen()));
    } else {
      setTimeout(() => this.playContentTransition());
    }
  }

  close(): void {
    this.stopTimer();
    this.isDragging.set(false);
    this.dragStartX = null;
    this.dragStartY = null;

    const el = this.viewerEl()?.nativeElement;
    // Only collapse back into the avatar when closing "at rest" (the X
    // button, Escape, or running off the last story) — a swipe-dismiss
    // already played its own fling-away animation before calling this (see
    // onStoryPointerEnd), so dragOffsetY is non-zero there and this would
    // otherwise fight that motion with a second, contradictory animation.
    if (el && this.originRect && this.dragOffsetY() === 0 && !this.prefersReducedMotion()) {
      const origin = this.originRect;
      const target = el.getBoundingClientRect();
      const scaleX = origin.width / target.width;
      const scaleY = origin.height / target.height;
      const translateX = origin.left + origin.width / 2 - (target.left + target.width / 2);
      const translateY = origin.top + origin.height / 2 - (target.top + target.height / 2);
      const anim = el.animate(
        [
          { transform: "translate(0, 0) scale(1, 1)", opacity: 1, borderRadius: "0px" },
          { transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`, opacity: 0, borderRadius: "50%" },
        ],
        { duration: 300, easing: MATERIAL_EMPHASIZED_ACCELERATE, fill: "both" }
      );
      anim.onfinish = () => this.finishClose();
      return;
    }
    this.finishClose();
  }

  private finishClose(): void {
    this.activeIndex.set(null);
    this.dragOffsetY.set(0);
    this.flungOffscreen.set(false);
    this.originRect = null;
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

  // The hero morph (2026-09-24) — animates the fixed full-screen viewer
  // from the clicked avatar's small rect/circle up to the full viewport,
  // Flutter-Hero-style. `fill: "both"` on both keyframe sets below holds
  // each animation's end state after it finishes rather than snapping back
  // to whatever CSS would otherwise say, since neither state is expressed
  // as a static class.
  private playHeroOpen(): void {
    const el = this.viewerEl()?.nativeElement;
    const origin = this.originRect;
    if (!el || !origin || this.prefersReducedMotion()) return;
    const target = el.getBoundingClientRect();
    const scaleX = origin.width / target.width;
    const scaleY = origin.height / target.height;
    const translateX = origin.left + origin.width / 2 - (target.left + target.width / 2);
    const translateY = origin.top + origin.height / 2 - (target.top + target.height / 2);
    el.animate(
      [
        { transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`, opacity: 0.5, borderRadius: "50%" },
        { transform: "translate(0, 0) scale(1, 1)", opacity: 1, borderRadius: "0px" },
      ],
      { duration: 380, easing: MATERIAL_EMPHASIZED, fill: "both" }
    );
  }

  // A quick cross-fade + settle on the image/caption wrapper when moving
  // between stories in an already-open viewer — replaces what used to be
  // an instant hard cut on every next()/prev() tap.
  private playContentTransition(): void {
    const el = this.contentEl()?.nativeElement;
    if (!el || this.prefersReducedMotion()) return;
    el.animate(
      [
        { opacity: 0, transform: "scale(0.97)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 220, easing: MATERIAL_EMPHASIZED }
    );
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
  // Floors at 0.4 while actively tracking a finger (a fully-transparent
  // story mid-drag reads as "gone" before the gesture is even committed) —
  // but once flungOffscreen is set (release past the threshold), it's
  // allowed to actually reach 0 as it glides the rest of the way off.
  readonly dragOpacity = computed(() => {
    if (this.flungOffscreen()) return 0;
    return Math.max(0.4, 1 - this.dragOffsetY() / 400);
  });

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
      // Continue the fling the rest of the way off-screen instead of the
      // old behavior (reset dragOffsetY to 0, *then* remove the element),
      // which snapped the story back to center for one visible frame right
      // before it vanished. story-drag-transition's CSS transition (active
      // now that isDragging is false, set above) animates this glide, and
      // flungOffscreen lets dragOpacity actually reach 0 instead of its
      // normal 0.4 drag-tracking floor.
      this.flungOffscreen.set(true);
      this.dragOffsetY.set(typeof window !== "undefined" ? window.innerHeight : 800);
      setTimeout(() => this.close(), 300);
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
