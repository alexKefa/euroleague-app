import {
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  Input,
  Output,
  inject,
  signal,
} from "@angular/core";
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
@Component({
  selector: "app-dropdown",
  standalone: true,
  imports: [RetryImgDirective],
  template: `
    <button
      type="button"
      (click)="toggle()"
      [disabled]="disabled"
      class="w-full flex items-center justify-between gap-2 pl-3 pr-2.5 py-2 rounded-xl bg-card border-2 border-line text-sm font-semibold text-ink hover:border-[#3a3a3b] focus:border-highlight outline-none transition-colors disabled:opacity-40 disabled:cursor-default"
      [attr.aria-expanded]="open()"
      aria-haspopup="listbox"
    >
      <span class="flex items-center gap-2 min-w-0">
        @if (selected()?.logoUrl) {
          <img [src]="selected()!.logoUrl" alt="" appRetryImg class="w-4 h-4 object-contain shrink-0" />
        }
        <span class="truncate" [class.text-muted]="!selected()">{{ selected()?.label ?? placeholder }}</span>
      </span>
      <svg
        class="shrink-0 w-2.5 h-2.5 text-muted transition-transform"
        [class.rotate-180]="open()"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M2.5 4.5L6 8L9.5 4.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    @if (open()) {
      <ul
        role="listbox"
        class="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-xl bg-card border-2 border-line shadow-pop py-1"
      >
        @for (opt of options; track opt.value; let i = $index) {
          <li
            role="option"
            [attr.aria-selected]="opt.value === value"
            (click)="select(opt)"
            (mouseenter)="highlightedIndex.set(i)"
            class="flex items-center gap-2 px-3 py-2 text-sm font-semibold cursor-pointer truncate"
            [class]="rowClasses(opt, i)"
          >
            @if (opt.logoUrl) {
              <img [src]="opt.logoUrl" alt="" appRetryImg class="w-4 h-4 object-contain shrink-0" />
            }
            <span class="truncate">{{ opt.label }}</span>
          </li>
        }
      </ul>
    }
  `,
})
export class DropdownComponent {
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

  protected selected(): DropdownOption | null {
    return this.options.find((o) => o.value === this.value) ?? null;
  }

  protected rowClasses(opt: DropdownOption, index: number): string {
    if (opt.value === this.value) return "bg-highlight/10 text-highlight";
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
    }
  }

  select(opt: DropdownOption): void {
    this.value = opt.value;
    this.valueChange.emit(opt.value);
    this.open.set(false);
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target)) {
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
