import {
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  Injector,
  Input,
  OnDestroy,
  afterNextRender,
  effect,
  Output,
  inject,
  signal,
} from "@angular/core";
import { NgClass } from "@angular/common";
import { RetryImgDirective } from "./retry-img.directive";

export interface DropdownOption {
  value: string;
  label: string;
  logoUrl?: string | null;
}

// Custom listbox replacing every native <select> in the app. A native
// select's closed trigger can be restyled with CSS, but its open dropdown
// list is always rendered by the OS and can't be touched — that's what kept
// every filter/picker looking visually disconnected from the rest of the
// Scoreboard-styled UI even after button.directive.ts/chip.directive.ts
// were unified. This owns both states end to end: the trigger matches
// ButtonDirective's secondary variant (flat rectangle, bordered), the panel
// and its rows match ChipDirective's selected/hover language.
// focus:border-highlight -> focus:border-team-primary, selected-row
// bg-highlight/10 text-highlight -> bg-team-primary/10 text-team-primary
// (2026-09-18, "change everywhere on the app the default orange color with
// the preferred team") — matches ChipDirective's own selected-state swap.
@Component({
  selector: "app-dropdown",
  standalone: true,
  imports: [NgClass, RetryImgDirective],
  styles: [
    `
      .dd-panel { animation: dd-in 0.14s ease-out; transform-origin: top; }
      @keyframes dd-in { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
      .dd-fade { animation: dd-fade 0.15s ease-out; }
      @keyframes dd-fade { from { opacity: 0; } to { opacity: 1; } }
      /* Phones: the list becomes a bottom sheet. */
      @media (max-width: 639.98px) {
        .dd-panel {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          top: auto;
          margin: 0;
          max-height: 70dvh;
          border-radius: 1.25rem 1.25rem 0 0;
          border-bottom-width: 0;
          padding: 0.5rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
          animation: dd-up 0.22s ease-out;
        }
        .dd-panel::before {
          content: "";
          display: block;
          width: 36px;
          height: 4px;
          border-radius: 9999px;
          background: var(--color-line);
          margin: 0.25rem auto 0.5rem;
        }
        .dd-row { height: 3rem; font-size: 0.95rem; }
      }
      @keyframes dd-up { from { transform: translateY(100%); } to { transform: none; } }
      @media (prefers-reduced-motion: reduce) {
        .dd-panel, .dd-fade { animation: none; }
      }
    `,
  ],
  template: `
    <button
      type="button"
      (click)="toggle()"
      [disabled]="disabled"
      class="w-full h-10 flex items-center justify-between gap-2 pl-3 pr-1.5 rounded-xl bg-card border text-sm font-semibold text-ink shadow-sm outline-none transition-all disabled:opacity-40 disabled:cursor-default"
      [ngClass]="open() ? 'border-team-primary ring-4 ring-team-primary/15' : 'border-line hover:border-muted/60 focus-visible:border-team-primary'"
      [attr.aria-expanded]="open()"
      aria-haspopup="listbox"
    >
      <span class="flex items-center gap-2 min-w-0">
        @if (selected()?.logoUrl) {
          <img [src]="selected()!.logoUrl" alt="" appRetryImg class="w-5 h-5 object-contain shrink-0 team-logo" />
        }
        <span class="truncate" [class.text-muted]="!selected()">{{ selected()?.label ?? placeholder }}</span>
      </span>
      <span
        class="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
        [ngClass]="open() ? 'bg-team-primary text-team-secondary' : 'bg-page text-muted'"
      >
        <svg class="w-3 h-3 transition-transform duration-200" [class.rotate-180]="open()" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </button>

    @if (open()) {
      <!-- Phones: a dimmed backdrop, and the list docks to the bottom as a
           sheet (see .dd-panel below). Tapping the backdrop closes it. -->
      <div class="sm:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm dd-fade" (click)="open.set(false)"></div>
      <ul
        role="listbox"
        class="dd-panel absolute z-[60] left-0 right-0 mt-2 min-w-[10rem] max-h-72 overflow-y-auto rounded-2xl bg-card border border-line shadow-pop p-1.5 space-y-0.5"
      >
        @for (opt of options; track opt.value; let i = $index) {
          <li
            role="option"
            [attr.aria-selected]="opt.value === value"
            (click)="select(opt)"
            (mouseenter)="highlightedIndex.set(i)"
            class="dd-row flex items-center gap-2.5 px-3 h-10 rounded-xl text-sm font-semibold cursor-pointer transition-colors"
            [ngClass]="rowClasses(opt, i)"
          >
            @if (opt.logoUrl) {
              <img [src]="opt.logoUrl" alt="" appRetryImg class="w-5 h-5 object-contain shrink-0 team-logo" />
            }
            <span class="truncate flex-1">{{ opt.label }}</span>
            @if (opt.value === value) {
              <svg class="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class DropdownComponent implements OnDestroy {
  @Input({ required: true }) options: DropdownOption[] = [];
  @Input() value: string | null = null;
  @Input() placeholder = "";
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string | null>();

  // Positions the panel relative to the component's own host instead of
  // requiring every call site to wrap it in its own `class="relative"` div.
  @HostBinding("class") hostClass = "relative block";

  protected readonly open = signal(false);
  protected readonly highlightedIndex = signal(-1);

  private elementRef = inject(ElementRef);
  private injector = inject(Injector);
  private panelEl: HTMLElement | null = null;
  private backdropEl: HTMLElement | null = null;

  protected selected(): DropdownOption | null {
    return this.options.find((o) => o.value === this.value) ?? null;
  }

  protected rowClasses(opt: DropdownOption, index: number): string {
    if (opt.value === this.value) return "bg-team-primary/15 text-team-primary";
    if (this.highlightedIndex() === index) return "bg-page text-ink";
    return "text-ink";
  }

  toggle(): void {
    if (this.disabled) return;
    const next = !this.open();
    this.open.set(next);
    if (next) {
      const idx = this.options.findIndex((o) => o.value === this.value);
      this.highlightedIndex.set(idx >= 0 ? idx : 0);
      afterNextRender(() => this.attachToBody(), { injector: this.injector });
    }
  }

  // The panel is moved to <body> once it renders (2026-10-02): rendered in
  // place, any ancestor with overflow hidden/auto (a scrolling list panel,
  // a dialog body) clipped it, so a dropdown near the bottom of one opened
  // out of view. From <body> nothing clips it. On desktop it's then placed
  // against the trigger with fixed coordinates, flipping above when there's
  // more room there; phones keep the CSS bottom sheet. Angular still owns
  // the nodes and removes them when the @if closes.
  private attachToBody(): void {
    const host = this.elementRef.nativeElement as HTMLElement;
    const panel = host.querySelector<HTMLElement>("ul[role=listbox]");
    const backdrop = host.querySelector<HTMLElement>("div.dd-fade");
    if (!panel || !this.open()) return;
    this.panelEl = panel;
    this.backdropEl = backdrop;
    if (backdrop) document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    this.position();
  }

  private isPhone(): boolean {
    return window.matchMedia("(max-width: 639.98px)").matches;
  }

  private position(): void {
    const panel = this.panelEl;
    if (!panel || this.isPhone()) return;
    const rect = (this.elementRef.nativeElement as HTMLElement).getBoundingClientRect();
    const gap = 8;
    const margin = 12;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const openUp = below < 200 && above > below;
    Object.assign(panel.style, {
      position: "fixed",
      margin: "0",
      left: `${rect.left}px`,
      right: "auto",
      width: `${Math.max(rect.width, 160)}px`,
      maxHeight: `${Math.min(288, Math.max(openUp ? above : below, 120))}px`,
      top: openUp ? "auto" : `${rect.bottom + gap}px`,
      bottom: openUp ? `${window.innerHeight - rect.top + gap}px` : "auto",
      transformOrigin: openUp ? "bottom" : "top",
    });
  }

  // Fixed coordinates go stale once the page scrolls or resizes, so close
  // rather than chase the trigger. Scrolling inside the panel itself is fine.
  @HostListener("window:resize")
  onResize(): void {
    if (this.open() && !this.isPhone()) this.open.set(false);
  }

  // Capture phase, so scrolling any container (not just the page) counts.
  private readonly onAnyScroll = (event: Event): void => {
    if (!this.open() || this.isPhone()) return;
    if (this.panelEl && event.target instanceof Node && this.panelEl.contains(event.target)) return;
    this.open.set(false);
  };

  constructor() {
    effect(() => {
      if (this.open()) window.addEventListener("scroll", this.onAnyScroll, true);
      else window.removeEventListener("scroll", this.onAnyScroll, true);
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener("scroll", this.onAnyScroll, true);
    // Normally Angular removes these with the @if; this covers a host torn
    // down while open.
    this.panelEl?.remove();
    this.backdropEl?.remove();
  }

  select(opt: DropdownOption): void {
    this.value = opt.value;
    this.valueChange.emit(opt.value);
    this.open.set(false);
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    const inside =
      this.elementRef.nativeElement.contains(target) || !!this.panelEl?.contains(target) || !!this.backdropEl?.contains(target);
    if (this.open() && !inside) {
      this.open.set(false);
    }
  }

  @HostListener("keydown.escape")
  onEscape(): void {
    this.open.set(false);
  }

  @HostListener("keydown.arrowdown", ["$event"])
  onArrowDown(event: Event): void {
    event.preventDefault();
    if (!this.open()) {
      this.toggle();
      return;
    }
    this.highlightedIndex.update((i) => Math.min(i + 1, this.options.length - 1));
  }

  @HostListener("keydown.arrowup", ["$event"])
  onArrowUp(event: Event): void {
    event.preventDefault();
    if (!this.open()) {
      this.toggle();
      return;
    }
    this.highlightedIndex.update((i) => Math.max(i - 1, 0));
  }

  @HostListener("keydown.enter")
  onEnter(): void {
    if (this.open()) {
      const opt = this.options[this.highlightedIndex()];
      if (opt) this.select(opt);
    } else {
      this.toggle();
    }
  }
}
