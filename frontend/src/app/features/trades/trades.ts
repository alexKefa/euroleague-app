import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { Observable } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { TradeableCard, MarketplaceCard, TradeOffer, TradeOfferStatus, Collectible } from "../../core/models";
import { TradesNotificationService } from "../../core/trades-notification.service";
import { CollectibleCardComponent } from "../store/collectible-card";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { PageHintComponent } from "../../shared/page-hint";
import { SkeletonComponent } from "../../shared/skeleton";

@Component({
  selector: "app-trades",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CollectibleCardComponent,
    ButtonDirective,
    ChipDirective,
    PageHintComponent,
    SkeletonComponent,
  ],
  templateUrl: "./trades.html",
})
export class TradesComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private tradesNotification = inject(TradesNotificationService);

  readonly loading = signal(true);
  readonly myCards = signal<TradeableCard[]>([]);
  readonly marketplace = signal<MarketplaceCard[]>([]);
  readonly offers = signal<TradeOffer[]>([]);

  // Every legendary in the catalog, used only as the picklist for the
  // wishlist editor below — loaded once, not filtered by ownership (you can
  // wishlist a card whether or not you've seen anyone list it yet).
  readonly legendaryCatalog = signal<Collectible[]>([]);

  // Which of "my cards" currently has its wishlist editor open — at most
  // one at a time, keyed by the card's (collectible) id.
  readonly editingWishlistId = signal<string | null>(null);
  readonly wishlistDraft = signal<ReadonlySet<string>>(new Set());
  readonly savingWishlist = signal(false);

  // A different owner can list the exact same legendary you already have —
  // that listing stays visible (so you can still see it exists) but can't
  // be selected, since a trade for it could never complete
  // (OWNERSHIP_CONFLICT server-side). myCards() only ever holds legendaries
  // you own, so its ids are exactly the "already own this" set.
  private readonly ownedCollectibleIds = computed(() => new Set(this.myCards().map((c) => c.id)));

  alreadyOwned(card: MarketplaceCard): boolean {
    return this.ownedCollectibleIds().has(card.collectibleId);
  }

  readonly togglingId = signal<string | null>(null);

  readonly selectedListingId = signal<string | null>(null);
  readonly selectedMineIds = signal<ReadonlySet<string>>(new Set());

  readonly proposing = signal(false);
  readonly proposeError = signal<string | null>(null);
  readonly proposeSuccess = signal(false);

  readonly actingOnId = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  // Each of the three card containers (My Cards, Marketplace, My Offers)
  // collapses independently — expanded by default so nothing changes for
  // someone who never touches the header.
  readonly myCardsExpanded = signal(true);
  readonly marketplaceExpanded = signal(true);
  readonly offerComposerExpanded = signal(true);
  readonly myOffersExpanded = signal(true);

  readonly selectedListing = computed(
    () => this.marketplace().find((c) => c.id === this.selectedListingId()) ?? null
  );

  readonly canPropose = computed(() => !!this.selectedListingId() && this.selectedMineIds().size > 0);

  // Collectible ids the selected listing's owner said they'd want — used to
  // highlight a likely-accepted offer in the composer instead of leaving it
  // a blind pick. Purely a UI hint; the backend still accepts any offer.
  readonly selectedListingWishlistIds = computed(
    () => new Set((this.selectedListing()?.wishlist ?? []).map((c) => c.id))
  );

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

    this.loadMyCards();
    this.loadMarketplace();
    this.loadOffers();
    this.api.getCollectibles().subscribe({
      next: (cards) => this.legendaryCatalog.set(cards.filter((c) => c.tier === "legendary")),
      error: () => {},
    });
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

  toggleMyCardsSection(): void {
    this.myCardsExpanded.update((v) => !v);
  }

  toggleMarketplaceSection(): void {
    this.marketplaceExpanded.update((v) => !v);
  }

  toggleOfferComposerSection(): void {
    this.offerComposerExpanded.update((v) => !v);
  }

  toggleMyOffersSection(): void {
    this.myOffersExpanded.update((v) => !v);
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

  wishlistPickOptions(card: TradeableCard): Collectible[] {
    return this.legendaryCatalog().filter((c) => c.id !== card.id);
  }

  openWishlistEditor(card: TradeableCard): void {
    this.editingWishlistId.set(card.id);
    this.wishlistDraft.set(new Set(card.wishlist));
  }

  closeWishlistEditor(): void {
    this.editingWishlistId.set(null);
  }

  toggleWishlistDraft(collectibleId: string): void {
    const next = new Set(this.wishlistDraft());
    if (next.has(collectibleId)) {
      next.delete(collectibleId);
    } else {
      next.add(collectibleId);
    }
    this.wishlistDraft.set(next);
  }

  saveWishlist(card: TradeableCard): void {
    if (this.savingWishlist()) return;
    const wishlist = Array.from(this.wishlistDraft());
    this.savingWishlist.set(true);
    this.api.setCardWishlist(card.id, wishlist).subscribe({
      next: ({ wishlist }) => {
        this.myCards.update((cards) => cards.map((c) => (c.id === card.id ? { ...c, wishlist } : c)));
        this.savingWishlist.set(false);
        this.editingWishlistId.set(null);
      },
      error: () => this.savingWishlist.set(false),
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

  wishlistNames(card: MarketplaceCard): string {
    return card.wishlist.map((c) => c.name).join(", ");
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
        this.tradesNotification.refresh();
      },
      error: (err) => {
        this.actingOnId.set(null);
        this.actionError.set(this.tradeErrorMessage(err, "trades.actionFallbackError"));
      },
    });
  }
}
