import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Collectible, CollectibleStatsResponse } from "../../core/models";
import { CollectibleCardComponent } from "./collectible-card";
import { I18nService } from "../../core/i18n.service";
import { ApiService } from "../../core/api.service";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { GestureHintComponent } from "../../shared/gesture-hint";

/**
 * Full-screen card preview — shared between Store and Inventory (and
 * anywhere else a collectible needs a closer look). Consumer-specific
 * extras (e.g. Store's admin image-edit form) go through <ng-content>,
 * projected below the name/team.
 *
 * Two gestures on the same card: a horizontal drag tilts it (existing
 * behavior), a plain tap flips it over to a real-stats back — the same
 * pointer sequence drives both, disambiguated purely by how far the
 * pointer actually moved between down and up. No separate tap target
 * needed, matches how a physical card would react to either gesture.
 */
@Component({
  selector: "app-card-preview",
  standalone: true,
  imports: [CommonModule, CollectibleCardComponent, LogoSpinnerComponent, GestureHintComponent],
  templateUrl: "./card-preview.html",
})
export class CardPreviewComponent implements OnChanges {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  @Input({ required: true }) item!: Collectible;
  @Input() unlocked = false;
  @Output() closed = new EventEmitter<void>();

  readonly dragRotation = signal(0);
  readonly isDragging = signal(false);
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartRotation = 0;
  // Total pointer travel this gesture, in px — under the threshold at
  // pointerup means "that was a tap", not a drag.
  private dragDistance = 0;
  private static readonly TAP_THRESHOLD_PX = 6;

  readonly flipped = signal(false);
  readonly stats = signal<CollectibleStatsResponse | null>(null);
  readonly statsLoading = signal(false);

  // Shown once per browser until the visitor actually touches a card —
  // same "learn it once" localStorage pattern as PageHintComponent, just
  // dismissed by the gesture itself rather than an explicit close button.
  private static readonly GESTURE_HINT_KEY = "clutch-card-gesture-seen";
  readonly showGestureHint = signal(false);

  constructor() {
    try {
      this.showGestureHint.set(localStorage.getItem(CardPreviewComponent.GESTURE_HINT_KEY) !== "1");
    } catch {
      // Private browsing / storage disabled — hint just shows every time, not worth failing over.
    }
  }

  private dismissGestureHint(): void {
    if (!this.showGestureHint()) return;
    this.showGestureHint.set(false);
    try {
      localStorage.setItem(CardPreviewComponent.GESTURE_HINT_KEY, "1");
    } catch {
      // No persistence available — it'll show again next time, not worth failing over.
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Guards against a stale flipped-to-the-wrong-card state in the (rare,
    // not currently reachable through the UI, but cheap to guard anyway)
    // case this instance gets reused for a different item without an
    // intervening close().
    if (changes["item"] && !changes["item"].firstChange) {
      this.flipped.set(false);
      this.stats.set(null);
    }
  }

  close(): void {
    this.dragRotation.set(0);
    this.flipped.set(false);
    this.closed.emit();
  }

  toggleFlip(): void {
    this.flipped.update((f) => !f);
    if (this.flipped() && this.stats() === null && !this.statsLoading()) {
      this.statsLoading.set(true);
      this.api.getCollectibleStats(this.item.id).subscribe({
        next: (res) => {
          this.stats.set(res);
          this.statsLoading.set(false);
        },
        error: () => {
          this.stats.set({ matched: false });
          this.statsLoading.set(false);
        },
      });
    }
  }

  onCardPointerDown(event: PointerEvent): void {
    this.dismissGestureHint();
    this.isDragging.set(true);
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragStartRotation = this.dragRotation();
    this.dragDistance = 0;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onCardPointerMove(event: PointerEvent): void {
    if (!this.isDragging() || event.pointerId !== this.dragPointerId) return;
    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;
    this.dragDistance = Math.hypot(deltaX, deltaY);
    const rotation = this.dragStartRotation + deltaX / 6;
    this.dragRotation.set(Math.max(-28, Math.min(28, rotation)));
  }

  onCardPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.isDragging.set(false);
    this.dragPointerId = null;
    this.dragRotation.set(0);
    if (this.dragDistance < CardPreviewComponent.TAP_THRESHOLD_PX) {
      this.toggleFlip();
    }
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.close();
  }

  // A center with zero 3PT attempts on the season has a genuinely null
  // threePointPct, not a zero — "—" reads as "not attempted" instead of
  // the bare "%" a plain number pipe leaves behind for a null value.
  formatPct(value: number | null | undefined): string {
    return value == null ? "—" : `${Math.round(value)}%`;
  }
}
