import { Component, HostListener, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { Collectible, Team } from "../../core/models";
import { CollectibleCardComponent } from "./collectible-card";

@Component({
  selector: "app-store",
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, CollectibleCardComponent],
  templateUrl: "./store.html",
})
export class StoreComponent implements OnInit {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  protected auth = inject(AuthService);

  readonly collectibles = signal<Collectible[]>([]);
  readonly myCollectibleIds = signal<Set<string>>(new Set());
  readonly points = signal(0);
  readonly loading = signal(true);
  readonly redeemingId = signal<string | null>(null);
  readonly redeemError = signal<string | null>(null);
  private readonly previewItemId = signal<string | null>(null);
  readonly previewItem = computed(
    () => this.collectibles().find((c) => c.id === this.previewItemId()) ?? null
  );
  readonly dragRotation = signal(0);
  readonly isDragging = signal(false);
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartRotation = 0;

  readonly teams = signal<Team[]>([]);
  readonly addSubmitting = signal(false);
  readonly addError = signal<string | null>(null);

  readonly addForm = this.fb.nonNullable.group({
    name: ["", [Validators.required]],
    teamId: ["", [Validators.required]],
    tier: ["common", [Validators.required]],
    pointsCost: [50, [Validators.required, Validators.min(1)]],
    imageUrl: [""],
  });

  readonly imageSavingId = signal<string | null>(null);
  readonly imageErrors = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.loadCollectibles();

    if (this.auth.isAuthenticated()) {
      this.api.getMyCollectibles().subscribe({
        next: (rows) => this.myCollectibleIds.set(new Set(rows.map((r) => r.collectibleId))),
        error: () => {},
      });

      this.api.getMyPredictionSummary().subscribe({
        next: (summary) => this.points.set(summary.points),
        error: () => {},
      });
    }

    if (this.auth.currentUser()?.isAdmin) {
      this.api.getTeams().subscribe({ next: (rows) => this.teams.set(rows) });
    }
  }

  private loadCollectibles(): void {
    this.api.getCollectibles().subscribe({
      next: (rows) => {
        this.collectibles.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openPreview(collectible: Collectible): void {
    this.previewItemId.set(collectible.id);
  }

  closePreview(): void {
    this.previewItemId.set(null);
    this.dragRotation.set(0);
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
    this.closePreview();
  }

  isUnlocked(collectible: Collectible): boolean {
    return this.myCollectibleIds().has(collectible.id);
  }

  canAfford(collectible: Collectible): boolean {
    return this.points() >= collectible.pointsCost;
  }

  redeem(collectible: Collectible): void {
    if (!this.auth.isAuthenticated() || this.redeemingId()) return;
    this.redeemingId.set(collectible.id);
    this.redeemError.set(null);

    this.api.redeemCollectible(collectible.id).subscribe({
      next: () => {
        const ids = new Set(this.myCollectibleIds());
        ids.add(collectible.id);
        this.myCollectibleIds.set(ids);
        this.points.set(this.points() - collectible.pointsCost);
        this.redeemingId.set(null);
      },
      error: (err) => {
        this.redeemError.set(err?.error?.error ?? "Failed to redeem.");
        this.redeemingId.set(null);
      },
    });
  }

  submitAdd(): void {
    if (this.addForm.invalid) return;
    this.addSubmitting.set(true);
    this.addError.set(null);

    const { name, teamId, tier, pointsCost, imageUrl } = this.addForm.getRawValue();
    this.api.addCollectible(name, teamId, tier, Number(pointsCost), imageUrl || undefined).subscribe({
      next: () => {
        this.addSubmitting.set(false);
        this.addForm.patchValue({ name: "", imageUrl: "" });
        this.loadCollectibles();
      },
      error: (err) => {
        this.addSubmitting.set(false);
        this.addError.set(err?.error?.error ?? "Failed to add collectible.");
      },
    });
  }

  setImage(collectible: Collectible, imageUrl: string): void {
    if (!imageUrl.trim() || this.imageSavingId()) return;
    this.imageSavingId.set(collectible.id);
    this.clearImageError(collectible.id);

    this.api.updateCollectibleImage(collectible.id, imageUrl.trim()).subscribe({
      next: () => {
        this.imageSavingId.set(null);
        this.loadCollectibles();
      },
      error: (err) => {
        this.imageSavingId.set(null);
        this.imageErrors.update((errors) => ({
          ...errors,
          [collectible.id]: err?.error?.error ?? "Failed to save — is the backend running?",
        }));
      },
    });
  }

  private clearImageError(id: string): void {
    this.imageErrors.update((errors) => {
      const { [id]: _removed, ...rest } = errors;
      return rest;
    });
  }
}
