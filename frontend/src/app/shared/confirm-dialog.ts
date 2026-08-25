import { Component, EventEmitter, Input, Output } from "@angular/core";
import { ButtonDirective } from "./button.directive";

// Generic "are you sure?" modal — same overlay convention as the card
// preview modal (bg-black/80 backdrop-blur-sm, click-outside-to-cancel),
// but a plain text + two-button panel instead of anything bespoke. Text is
// supplied by the caller (already translated via their own i18n namespace)
// rather than owned here, so this stays reusable across features instead
// of growing its own i18n keys.
@Component({
  selector: "app-confirm-dialog",
  standalone: true,
  imports: [ButtonDirective],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" (click)="cancelled.emit()">
      <div class="bg-card rounded-2xl border border-line shadow-pop p-5 max-w-sm w-full" (click)="$event.stopPropagation()">
        <p class="text-sm font-semibold mb-4">{{ message }}</p>
        <div class="flex gap-2">
          <button type="button" (click)="cancelled.emit()" appButton="outline" appButtonSize="sm" class="flex-1">
            {{ cancelLabel }}
          </button>
          <button type="button" (click)="confirmed.emit()" [appButton]="danger ? 'danger' : 'primary'" appButtonSize="sm" class="flex-1">
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  @Input() message = "";
  @Input() confirmLabel = "Confirm";
  @Input() cancelLabel = "Cancel";
  @Input() danger = true;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
}
