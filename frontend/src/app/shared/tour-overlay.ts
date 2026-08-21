import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from "@angular/core";
import { I18nService } from "../core/i18n.service";
import { TourService } from "../core/tour/tour.service";
import { ButtonDirective } from "./button.directive";

const SPOTLIGHT_PAD = 8;
const CARD_GAP = 16;
const VIEWPORT_MARGIN = 16;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function currentViewportSize(): { width: number; height: number } {
  // visualViewport reflects the actually-visible area — window.innerHeight
  // can disagree with it on mobile (a collapsing/expanding browser toolbar,
  // Safari's bottom bar), which was leaving the tooltip's bottom edge
  // flush against — or past — the real edge of the screen even though it
  // measured as "within bounds" by window.innerHeight's own numbers.
  const vv = window.visualViewport;
  return { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
}

// Mounted once in AppComponent so it survives route navigation across the
// whole multi-page tour. Two visual states per step, both driven by
// TourService.targetRect(): a spotlight (dimmed screen with a cutout ring
// around the target, via the box-shadow-on-a-positioned-box trick) when a
// target was found, or a plain dimmed backdrop with the card centered when
// it wasn't (guest/loading/empty-state fallback — see TourService).
@Component({
  selector: "app-tour-overlay",
  standalone: true,
  imports: [ButtonDirective],
  template: `
    <!-- Invisible sentinel used only to read env(safe-area-inset-bottom) as
         a real pixel number in JS (there's no other way to get at a CSS
         env() value from script) — the iPhone home-indicator strip eats
         into the bottom of the screen without shrinking window.innerHeight
         or visualViewport.height, so without this the tooltip's bottom
         margin could land underneath it. -->
    <div #safeAreaProbe class="fixed bottom-0 left-0 invisible pointer-events-none" style="height: env(safe-area-inset-bottom)"></div>

    @if (tour.active()) {
      <div
        class="fixed inset-0 z-[100] transition-opacity duration-150 ease-out"
        [class.opacity-0]="!tour.ready()"
        [class.opacity-100]="tour.ready()"
        [class.pointer-events-none]="!tour.ready()"
      >
        <!-- Click-catcher: blocks interaction with the app underneath for the
             whole overlay area, including the "dimmed" region outside the
             spotlight box (which is only a box-shadow, not real layout, so it
             can't catch clicks on its own). -->
        <div class="absolute inset-0"></div>

        @if (spotlightBox(); as box) {
          <div
            class="absolute rounded-xl pointer-events-none transition-all duration-300 ease-out"
            style="box-shadow: 0 0 0 9999px rgba(0,0,0,0.72)"
            [style.top.px]="box.top"
            [style.left.px]="box.left"
            [style.width.px]="box.width"
            [style.height.px]="box.height"
          ></div>
          <div
            class="absolute rounded-xl border-2 border-highlight pointer-events-none transition-all duration-300 ease-out"
            [style.top.px]="box.top"
            [style.left.px]="box.left"
            [style.width.px]="box.width"
            [style.height.px]="box.height"
          ></div>
        } @else {
          <div class="absolute inset-0 bg-black/72"></div>
        }

        <div
          #card
          class="absolute w-[calc(100vw-2rem)] max-w-[340px] overflow-y-auto bg-card rounded-2xl shadow-pop p-4 transition-[top,left] duration-300 ease-out"
          [style.top.px]="cardTop()"
          [style.left.px]="cardLeft()"
          [style.max-height.px]="maxCardHeight()"
        >
          <p class="font-mono text-[11px] text-muted font-bold mb-1">
            {{ i18n.t('tour.stepLabel') }} {{ tour.stepIndex() + 1 }}/{{ tour.steps.length }}
          </p>
          <p class="font-display text-base tracking-wide mb-1.5">{{ i18n.t(tour.currentStep()?.titleKey ?? '') }}</p>
          <p class="text-sm text-muted leading-relaxed mb-4">{{ i18n.t(tour.currentStep()?.bodyKey ?? '') }}</p>

          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              (click)="tour.end()"
              class="font-mono text-[12px] text-muted hover:text-ink transition-colors"
            >
              {{ i18n.t('tour.skip') }}
            </button>
            <div class="flex gap-2">
              @if (tour.stepIndex() > 0) {
                <button type="button" (click)="tour.back()" appButton="secondary" appButtonSize="sm">
                  {{ i18n.t('tour.back') }}
                </button>
              }
              <button type="button" (click)="tour.next()" appButton appButtonSize="sm">
                {{ tour.stepIndex() === tour.steps.length - 1 ? i18n.t('tour.finish') : i18n.t('tour.next') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class TourOverlayComponent implements AfterViewInit, OnDestroy {
  protected tour = inject(TourService);
  protected i18n = inject(I18nService);

  private ro?: ResizeObserver;
  private readonly measuredCardHeight = signal(180);

  // Angular's computed() only re-runs when a *signal* it read last time
  // changes — reading window dimensions straight inside a computed() means
  // it caches whatever those were on its first run and never notices a
  // resize, toolbar collapse, or orientation change by itself. Routing
  // viewport size through these signals (updated by the listeners below) is
  // what makes cardWidth/cardTop/cardLeft actually reactive to that.
  protected readonly viewportWidth = signal(currentViewportSize().width);
  protected readonly viewportHeight = signal(currentViewportSize().height);
  protected readonly safeAreaBottom = signal(0);
  // The mobile bottom tab bar (app.component.html, [data-app-bottom-nav],
  // hidden at sm: and up) sits at z-40 — below this overlay's z-100, so a
  // tooltip positioned right at the screen edge doesn't get clipped by it,
  // but it does visually land on top of the nav's icons with no breathing
  // room, which read as "no margin from the bottom". Measuring its real
  // rendered height (0 when it's not shown, e.g. desktop) and reserving
  // that space fixes it without hardcoding a mobile-only magic number.
  protected readonly navBarHeight = signal(0);

  @ViewChild("safeAreaProbe") private probeRef?: ElementRef<HTMLDivElement>;

  private readonly onViewportChange = () => {
    const size = currentViewportSize();
    this.viewportWidth.set(size.width);
    this.viewportHeight.set(size.height);
    this.measureChrome();
  };

  constructor() {
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("orientationchange", this.onViewportChange);
    window.visualViewport?.addEventListener("resize", this.onViewportChange);
  }

  ngAfterViewInit(): void {
    this.measureChrome();
  }

  private measureChrome(): void {
    const safeAreaH = this.probeRef?.nativeElement.getBoundingClientRect().height;
    if (safeAreaH !== undefined) this.safeAreaBottom.set(safeAreaH);

    const navEl = document.querySelector<HTMLElement>("[data-app-bottom-nav]");
    this.navBarHeight.set(navEl?.getBoundingClientRect().height ?? 0);
  }

  @ViewChild("card")
  set cardRef(ref: ElementRef<HTMLDivElement> | undefined) {
    this.ro?.disconnect();
    if (!ref) return;
    this.ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) this.measuredCardHeight.set(Math.ceil(h));
    });
    this.ro.observe(ref.nativeElement);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.tour.active()) this.tour.end();
  }

  // The real usable bottom margin — our own gap, plus whichever is taller:
  // the home-indicator/gesture-bar safe area, or the mobile bottom nav bar
  // (whose own bottom padding already includes that same safe area, so this
  // is a max, not a sum — adding both would double-count it).
  private readonly bottomMargin = computed(
    () => VIEWPORT_MARGIN + Math.max(this.safeAreaBottom(), this.navBarHeight())
  );

  private readonly cardWidth = computed(() => Math.min(340, this.viewportWidth() - VIEWPORT_MARGIN * 2));

  protected readonly maxCardHeight = computed(
    () => this.viewportHeight() - VIEWPORT_MARGIN - this.bottomMargin()
  );

  // The raw target rect (padded by SPOTLIGHT_PAD) clamped to the viewport —
  // a target taller or wider than the screen (an early version of this tour
  // spotlighted the dashboard's full standings list, which can run to ~18
  // rows) would otherwise push the spotlight ring, and the tooltip
  // positioned off of it, past the visible area entirely. Clamping means
  // the worst case is a ring that touches the screen edge instead of one
  // that's rendered off-screen.
  protected readonly spotlightBox = computed<Box | null>(() => {
    const r = this.tour.targetRect();
    if (!r) return null;
    const vw = this.viewportWidth();
    const vh = this.viewportHeight();
    const bottomMargin = this.bottomMargin();

    const top = Math.max(r.top - SPOTLIGHT_PAD, VIEWPORT_MARGIN);
    const left = Math.max(r.left - SPOTLIGHT_PAD, VIEWPORT_MARGIN);
    const bottom = Math.min(r.bottom + SPOTLIGHT_PAD, vh - bottomMargin);
    const right = Math.min(r.right + SPOTLIGHT_PAD, vw - VIEWPORT_MARGIN);

    return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
  });

  // Both branches below are wrapped in the same Math.max(MARGIN, Math.min(
  // ..., maxTop)) clamp so the card can never end up partly above y=0 or
  // below the fold regardless of its height — on a short mobile viewport
  // the tooltip's height can get close to (or, before this clamp, exceed)
  // the room actually left after the spotlight, and an unclamped branch
  // would push it off the top of the screen with no way to scroll back to
  // it (the overlay itself doesn't scroll). h is additionally capped to the
  // available vertical space, with the card's own overflow-y-auto + bound
  // max-height as a last-resort fallback if content still doesn't fit.
  protected readonly cardTop = computed(() => {
    const box = this.spotlightBox();
    const vh = this.viewportHeight();
    const bottomMargin = this.bottomMargin();
    const h = Math.min(this.measuredCardHeight(), this.maxCardHeight());
    const maxTop = vh - h - bottomMargin;
    const centered = Math.max(VIEWPORT_MARGIN, Math.min((vh - h) / 2, maxTop));

    if (!box) return centered;

    const spaceBelow = vh - box.top - box.height - bottomMargin;
    const spaceAbove = box.top - VIEWPORT_MARGIN;

    // Neither side has comfortable room for the card (a target near the
    // middle of a long page, or one that's tall relative to the screen) —
    // center it on screen instead of jamming it against whichever edge is
    // "less bad", which is what made some steps read as pinned to the
    // bottom edge with no breathing room.
    if (spaceBelow < h + CARD_GAP && spaceAbove < h + CARD_GAP) return centered;

    const target = spaceBelow >= spaceAbove ? box.top + box.height + CARD_GAP : box.top - h - CARD_GAP;
    return Math.max(VIEWPORT_MARGIN, Math.min(target, maxTop));
  });

  protected readonly cardLeft = computed(() => {
    const box = this.spotlightBox();
    const vw = this.viewportWidth();
    const w = this.cardWidth();
    if (!box) return Math.max(VIEWPORT_MARGIN, (vw - w) / 2);

    const center = box.left + box.width / 2 - w / 2;
    return Math.max(VIEWPORT_MARGIN, Math.min(center, vw - w - VIEWPORT_MARGIN));
  });

  ngOnDestroy(): void {
    this.ro?.disconnect();
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("orientationchange", this.onViewportChange);
    window.visualViewport?.removeEventListener("resize", this.onViewportChange);
  }
}
