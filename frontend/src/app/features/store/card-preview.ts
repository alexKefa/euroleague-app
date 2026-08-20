import { Component, EventEmitter, HostListener, Input, Output, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Collectible } from "../../core/models";
import { CollectibleCardComponent } from "./collectible-card";
import { I18nService } from "../../core/i18n.service";

/**
 * Full-screen card preview with the drag-to-tilt gesture — shared between
 * Store and Inventory (and anywhere else a collectible needs a closer look).
 * Consumer-specific extras (e.g. Store's admin image-edit form) go through
 * <ng-content>, projected below the name/team.
 */
@Component({
  selector: "app-card-preview",
  standalone: true,
  imports: [CommonModule, CollectibleCardComponent],
  templateUrl: "./card-preview.html",
})
export class CardPreviewComponent {
  protected i18n = inject(I18nService);

  @Input({ required: true }) item!: Collectible;
  @Input() unlocked = false;
  @Output() closed = new EventEmitter<void>();

  readonly dragRotation = signal(0);
  readonly isDragging = signal(false);
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartRotation = 0;

  close(): void {
    this.dragRotation.set(0);
    this.closed.emit();
  }

  onCardPointerDown(event: PointerEvent): void {
    this.isDragging.set(true);
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartRotation = this.dragRotation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onCardPointerMove(event: PointerEvent): void {
    if (!this.isDragging() || event.pointerId !== this.dragPointerId) return;
    const deltaX = event.clientX - this.dragStartX;
    const rotation = this.dragStartRotation + deltaX / 6;
    this.dragRotation.set(Math.max(-28, Math.min(28, rotation)));
  }

  onCardPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.isDragging.set(false);
    this.dragPointerId = null;
    this.dragRotation.set(0);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.close();
  }
}
