import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { Collectible } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";

@Component({
  selector: "app-inventory",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent],
  templateUrl: "./inventory.html",
})
export class InventoryComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);

  readonly loading = signal(true);
  private readonly allCollectibles = signal<Collectible[]>([]);
  private readonly ownedIds = signal<Set<string>>(new Set());

  readonly myCollectibles = computed(() =>
    this.allCollectibles().filter((c) => this.ownedIds().has(c.id))
  );

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

    this.api.getCollectibles().subscribe({
      next: (rows) => {
        this.allCollectibles.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    this.api.getMyCollectibles().subscribe({
      next: (rows) => this.ownedIds.set(new Set(rows.map((r) => r.collectibleId))),
      error: () => {},
    });
  }
}
