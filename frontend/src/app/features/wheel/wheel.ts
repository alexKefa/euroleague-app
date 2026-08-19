import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { Collectible, SpinResult } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";

// Matches the CSS transition-duration on the wheel graphic — the reveal is
// deliberately held back until the spin animation actually finishes, even
// if the API responds sooner, so the animation never gets cut short.
const SPIN_ANIMATION_MS = 1800;

@Component({
  selector: "app-wheel",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent],
  templateUrl: "./wheel.html",
  styleUrl: "./wheel.css",
})
export class WheelComponent implements OnInit {
  private api = inject(ApiService);

  readonly loading = signal(true);
  readonly canSpin = signal(false);
  readonly nextEligibleAt = signal<string | null>(null);

  readonly spinning = signal(false);
  readonly spinError = signal<string | null>(null);
  readonly lastResult = signal<Collectible | null | undefined>(undefined); // undefined = no spin yet this visit
  readonly wheelRotation = signal(0);

  ngOnInit(): void {
    this.api.getSpinStatus().subscribe({
      next: (status) => {
        this.canSpin.set(status.canSpin);
        this.nextEligibleAt.set(status.nextEligibleAt);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  spin(): void {
    if (!this.canSpin() || this.spinning()) return;
    this.spinning.set(true);
    this.spinError.set(null);

    // A few full turns plus a random offset, so it never lands on the same
    // visual spot twice in a row even though the wedges are decorative.
    const extraSpins = 4 + Math.floor(Math.random() * 3);
    const randomOffset = Math.floor(Math.random() * 360);
    this.wheelRotation.update((r) => r + extraSpins * 360 + randomOffset);

    this.api.spin().subscribe({
      next: (result) => this.reveal(() => this.applyResult(result)),
      error: (err) => this.reveal(() => this.applyError(err)),
    });
  }

  private reveal(apply: () => void): void {
    setTimeout(() => {
      this.spinning.set(false);
      apply();
    }, SPIN_ANIMATION_MS);
  }

  private applyResult(result: SpinResult): void {
    this.canSpin.set(false);
    this.nextEligibleAt.set(result.nextEligibleAt);
    this.lastResult.set(result.won);
  }

  private applyError(err: unknown): void {
    const message = (err as { error?: { error?: string } })?.error?.error ?? "Couldn't spin right now.";
    this.spinError.set(message);
  }
}
