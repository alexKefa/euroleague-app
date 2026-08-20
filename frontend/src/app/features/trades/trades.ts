import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { Observable } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { TradeableCard, MarketplaceCard, TradeOffer } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";

@Component({
  selector: "app-trades",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent],
  templateUrl: "./trades.html",
})
export class TradesComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);

  readonly loading = signal(true);
  readonly myCards = signal<TradeableCard[]>([]);
  readonly marketplace = signal<MarketplaceCard[]>([]);
  readonly offers = signal<TradeOffer[]>([]);

  readonly togglingId = signal<string | null>(null);

  readonly selectedListingId = signal<string | null>(null);
  readonly selectedMineIds = signal<ReadonlySet<string>>(new Set());

  readonly proposing = signal(false);
  readonly proposeError = signal<string | null>(null);
  readonly proposeSuccess = signal(false);

  readonly actingOnId = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly selectedListing = computed(
    () => this.marketplace().find((c) => c.id === this.selectedListingId()) ?? null
  );

  readonly canPropose = computed(() => !!this.selectedListingId() && this.selectedMineIds().size > 0);

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

    this.loadMyCards();
    this.loadMarketplace();
    this.loadOffers();
  }

  private loadMyCards(): void {
    this.api.getMyTradeableCards().subscribe({
      next: (cards) => {
        this.myCards.set(cards);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadMarketplace(): void {
    this.api.getMarketplace().subscribe({ next: (cards) => this.marketplace.set(cards), error: () => {} });
  }

  private loadOffers(): void {
    this.api.getMyTrades().subscribe({ next: (rows) => this.offers.set(rows), error: () => {} });
  }

  toggleTradeable(card: TradeableCard): void {
    if (this.togglingId()) return;
    this.togglingId.set(card.id);

    this.api.setCardTradeable(card.id, !card.tradeable).subscribe({
      next: ({ tradeable }) => {
        this.myCards.update((cards) => cards.map((c) => (c.id === card.id ? { ...c, tradeable } : c)));
        this.togglingId.set(null);
      },
      error: () => this.togglingId.set(null),
    });
  }

  selectListing(id: string): void {
    this.selectedListingId.set(this.selectedListingId() === id ? null : id);
    this.selectedMineIds.set(new Set());
    this.proposeSuccess.set(false);
    this.proposeError.set(null);
  }

  toggleMine(id: string): void {
    const next = new Set(this.selectedMineIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedMineIds.set(next);
  }

  propose(): void {
    const listingId = this.selectedListingId();
    const mineIds = Array.from(this.selectedMineIds());
    if (!listingId || mineIds.length === 0) return;

    this.proposing.set(true);
    this.proposeError.set(null);
    this.proposeSuccess.set(false);

    this.api.proposeTrade(mineIds, listingId).subscribe({
      next: () => {
        this.proposing.set(false);
        this.proposeSuccess.set(true);
        this.selectedListingId.set(null);
        this.selectedMineIds.set(new Set());
        this.loadOffers();
      },
      error: (err) => {
        this.proposing.set(false);
        this.proposeError.set(err?.error?.error ?? "Failed to send trade offer.");
      },
    });
  }

  offeredNames(offer: TradeOffer): string {
    return offer.offered.map((c) => c.name).join(", ");
  }

  accept(offer: TradeOffer): void {
    this.act(offer.id, this.api.acceptTrade(offer.id));
  }

  decline(offer: TradeOffer): void {
    this.act(offer.id, this.api.declineTrade(offer.id));
  }

  cancel(offer: TradeOffer): void {
    this.act(offer.id, this.api.cancelTrade(offer.id));
  }

  private act(id: string, call: Observable<unknown>): void {
    this.actingOnId.set(id);
    this.actionError.set(null);
    call.subscribe({
      next: () => {
        this.actingOnId.set(null);
        this.loadOffers();
        this.loadMyCards();
        this.loadMarketplace();
      },
      error: (err) => {
        this.actingOnId.set(null);
        this.actionError.set(err?.error?.error ?? "That didn't work — try again.");
      },
    });
  }
}
