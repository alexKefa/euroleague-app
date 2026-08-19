import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { Collectible } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";

@Component({
  selector: "app-wheel",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent],
  templateUrl: "./wheel.html",
})
export class WheelComponent implements OnInit {
  private api = inject(ApiService);

  readonly loading = signal(true);
  readonly canSpin = signal(false);
  readonly nextEligibleAt = signal<string | null>(null);

  readonly spinning = signal(false);
  readonly spinError = signal<string | null>(null);
  readonly lastResult = signal<Collectible | null | undefined>(undefined); // undefined = no spin yet this visit

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

    this.api.spin().subscribe({
      next: (result) => {
        this.spinning.set(false);
        this.canSpin.set(false);
        this.nextEligibleAt.set(result.nextEligibleAt);
        this.lastResult.set(result.won);
      },
      error: (err) => {
        this.spinning.set(false);
        this.spinError.set(err?.error?.error ?? "Couldn't spin right now.");
      },
    });
  }
}
