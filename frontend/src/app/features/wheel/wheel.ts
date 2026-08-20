import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
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
  protected auth = inject(AuthService);

  readonly loading = signal(true);
  readonly canSpin = signal(false);
  readonly nextEligibleAt = signal<string | null>(null);

  readonly spinning = signal(false);
  readonly spinError = signal<string | null>(null);
  readonly lastResult = signal<Collectible | null | undefined>(undefined); // undefined = no spin yet this visit
  readonly wheelRotation = signal(0);

  // Angles for the win-burst starburst rays, evenly spaced around the card.
  readonly burstRays = Array.from({ length: 12 }, (_, i) => i * 30);

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

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

    // The outcome is already decided server-side before the wheel ever
    // moves — spin to a stop angle inside a wedge matching that real
    // result, so landing on orange always means a win.
    this.api.spin().subscribe({
      next: (result) => this.animateToResult(result, () => this.applyResult(result)),
      error: (err) => this.applyError(err),
    });
  }

  /** Admin-only debug tool — always wins, doesn't touch the real cooldown. */
  cheatSpin(): void {
    if (this.spinning()) return;
    this.spinning.set(true);
    this.spinError.set(null);

    this.api.cheatSpin().subscribe({
      next: (result) => this.animateToResult(result, () => this.lastResult.set(result.won)),
      error: (err) => this.applyError(err),
    });
  }

  private animateToResult(result: SpinResult, apply: () => void): void {
    this.spinToWedge(result.won !== null);
    setTimeout(() => {
      this.spinning.set(false);
      apply();
    }, SPIN_ANIMATION_MS);
  }

  /**
   * Rotates the wheel so it stops with the pointer inside a wedge of the
   * right color for `won` — orange (0-45, 90-135, 180-225, 270-315deg in
   * the disc's own coordinates) for a win, black otherwise. See the
   * conic-gradient in wheel.html for the wedge layout this mirrors.
   */
  private spinToWedge(won: boolean): void {
    const wedgeStarts = won ? [0, 90, 180, 270] : [45, 135, 225, 315];
    const start = wedgeStarts[Math.floor(Math.random() * wedgeStarts.length)];
    const inset = 8; // stay clear of wedge boundaries so the color reads unambiguously
    const targetAngle = start + inset + Math.random() * (45 - 2 * inset);

    // The pointer sits at the top (screen angle 0); after rotating the
    // disc clockwise by R degrees, the wedge now under the pointer is the
    // one that was originally at (360 - R mod 360) mod 360.
    const targetMod = (360 - targetAngle + 360) % 360;
    const current = this.wheelRotation();
    const currentMod = ((current % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;

    const extraSpins = 4 + Math.floor(Math.random() * 3);
    this.wheelRotation.set(current + extraSpins * 360 + delta);
  }

  private applyResult(result: SpinResult): void {
    this.canSpin.set(false);
    this.nextEligibleAt.set(result.nextEligibleAt);
    this.lastResult.set(result.won);
  }

  private applyError(err: unknown): void {
    this.spinning.set(false);
    const message = (err as { error?: { error?: string } })?.error?.error ?? "Couldn't spin right now.";
    this.spinError.set(message);
  }
}
