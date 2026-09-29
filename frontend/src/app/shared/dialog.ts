import { Component, EventEmitter, HostListener, Input, Output } from "@angular/core";
import { NavIconComponent, NavIconName } from "./nav-icon";

/**
 * Generic content dialog (2026-09-29) — a titled panel whose body is
 * whatever the caller projects in. Bottom sheet on phones (full width,
 * up to 90% of the viewport tall, body scrolls), centered window from `sm:`
 * up. Closes on the ×, a backdrop tap, or Escape. Render it inside an
 * `@if` and clear that condition on (closed) — same convention as
 * confirm-dialog.ts, which stays the one to use for a plain yes/no.
 */
@Component({
  selector: "app-dialog",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-black/70 backdrop-blur-sm"
      (click)="closed.emit()"
    >
      <div
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="title"
        class="bg-card w-full sm:max-w-lg max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-line shadow-pop"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center gap-2 px-4 py-3 border-b border-line shrink-0">
          @if (icon) {
            <app-nav-icon [name]="icon" [size]="18" class="text-team-primary shrink-0" />
          }
          <p class="font-display text-base flex-1 min-w-0 break-words">{{ title }}</p>
          <button
            type="button"
            (click)="closed.emit()"
            class="tap-target relative text-muted hover:text-ink text-2xl leading-none shrink-0 w-8 h-8 flex items-center justify-center"
            [attr.aria-label]="closeLabel"
          >
            &times;
          </button>
        </div>
        <div class="overflow-y-auto px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class DialogComponent {
  @Input() title = "";
  @Input() icon: NavIconName | null = null;
  @Input() closeLabel = "Close";
  @Output() closed = new EventEmitter<void>();

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.closed.emit();
  }
}
