import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { Observable } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { TradeableCard, MarketplaceCard, TradeOffer, TradeOfferStatus } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { PageHintComponent } from "../../shared/page-hint";

@Component({
  selector: "app-trades",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, ButtonDirective, ChipDirective, PageHintComponent],
  templateUrl: "./trades.html",
})
export class TradesComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

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
        this.proposeError.set(this.tradeErrorMessage(err, "trades.proposeFallbackError"));
      },
    });
  }

  // The backend returns a stable `code` alongside its English `error` text
  // (routes/trades.ts) so the frontend can translate it without the server
  // needing to know about languages at all. Falls back to the raw English
  // message for any code we don't have a translation for yet, then to a
  // generic translated message if the server gave nothing usable at all
  // (e.g. a network failure with no response body).
  private tradeErrorMessage(err: unknown, fallbackKey: string): string {
    const body = (err as { error?: { code?: string; error?: string } } | undefined)?.error;
    const key = body?.code ? `trades.err.${body.code}` : undefined;
    const translated = key ? this.i18n.t(key) : undefined;
    if (translated && translated !== key) return translated;
    return body?.error ?? this.i18n.t(fallbackKey);
  }

  offeredNames(offer: TradeOffer): string {
    return offer.offered.map((c) => c.name).join(", ");
  }

  statusLabel(status: TradeOfferStatus): string {
    return this.i18n.t(`trades.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
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
        this.actionError.set(this.tradeErrorMessage(err, "trades.actionFallbackError"));
      },
    });
  }
}
