import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { Observable } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { TradeableCard, TradeOffer } from "../../core/models";
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
  readonly offers = signal<TradeOffer[]>([]);

  readonly recipientEmail = signal<string | null>(null);
  readonly theirCards = signal<TradeableCard[]>([]);
  readonly loadingTheirCards = signal(false);
  readonly theirCardsError = signal<string | null>(null);

  readonly selectedMineId = signal<string | null>(null);
  readonly selectedTheirsId = signal<string | null>(null);

  readonly proposing = signal(false);
  readonly proposeError = signal<string | null>(null);
  readonly proposeSuccess = signal(false);

  readonly actingOnId = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly canPropose = computed(
    () =>
      !!this.selectedMineId() &&
      !!this.selectedTheirsId() &&
      !!this.recipientEmail() &&
      this.selectedMineId() !== this.selectedTheirsId()
  );

  readonly sameCardSelected = computed(
    () => !!this.selectedMineId() && this.selectedMineId() === this.selectedTheirsId()
  );

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

    this.loadMyCards();
    this.loadOffers();
  }

  private loadMyCards(): void {
    this.api.getTradeableCards().subscribe({
      next: (cards) => {
        this.myCards.set(cards);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadOffers(): void {
    this.api.getMyTrades().subscribe({ next: (rows) => this.offers.set(rows), error: () => {} });
  }

  loadTheirCards(email: string): void {
    const trimmed = email.trim();
    if (!trimmed) return;

    this.loadingTheirCards.set(true);
    this.theirCardsError.set(null);
    this.selectedTheirsId.set(null);
    this.recipientEmail.set(null);
    this.theirCards.set([]);

    this.api.getTradeableCards(trimmed).subscribe({
      next: (cards) => {
        this.loadingTheirCards.set(false);
        this.theirCards.set(cards);
        this.recipientEmail.set(trimmed);
        if (cards.length === 0) this.theirCardsError.set("That user has no tradeable legendary cards.");
      },
      error: (err) => {
        this.loadingTheirCards.set(false);
        this.theirCardsError.set(err?.error?.error ?? "Couldn't find that user.");
      },
    });
  }

  selectMine(id: string): void {
    this.selectedMineId.set(this.selectedMineId() === id ? null : id);
  }

  selectTheirs(id: string): void {
    this.selectedTheirsId.set(this.selectedTheirsId() === id ? null : id);
  }

  propose(): void {
    const mine = this.selectedMineId();
    const theirs = this.selectedTheirsId();
    const email = this.recipientEmail();
    if (!mine || !theirs || !email) return;

    this.proposing.set(true);
    this.proposeError.set(null);
    this.proposeSuccess.set(false);

    this.api.proposeTrade(email, mine, theirs).subscribe({
      next: () => {
        this.proposing.set(false);
        this.proposeSuccess.set(true);
        this.selectedMineId.set(null);
        this.selectedTheirsId.set(null);
        this.theirCards.set([]);
        this.recipientEmail.set(null);
        this.loadOffers();
      },
      error: (err) => {
        this.proposing.set(false);
        this.proposeError.set(err?.error?.error ?? "Failed to send trade offer.");
      },
    });
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
      },
      error: (err) => {
        this.actingOnId.set(null);
        this.actionError.set(err?.error?.error ?? "That didn't work — try again.");
      },
    });
  }
}
