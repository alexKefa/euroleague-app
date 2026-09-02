import { Component, OnInit, HostListener, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { PackDefinition, OwnedPack, PackOpenOutcome, PackOpenResultCard, PackType } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { PackIconComponent } from "../../shared/pack-icon";
import { PACK_VISUAL_CLASSES } from "../../shared/pack-visual";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHintComponent } from "../../shared/page-hint";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { SkeletonComponent } from "../../shared/skeleton";

// Exit-animation duration for the outgoing card in the reveal sequence —
// keep in sync with the .card-exit-anim animation-duration in packs.css.
const CARD_EXIT_MS = 320;

type PackView = "selecting" | "revealing" | "summary";

@Component({
  selector: "app-packs",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CollectibleCardComponent,
    PackIconComponent,
    ButtonDirective,
    PageHintComponent,
    LogoSpinnerComponent,
    SkeletonComponent,
  ],
  templateUrl: "./packs.html",
  styleUrl: "./packs.css",
})
export class PacksComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly loading = signal(true);
  readonly packs = signal<PackDefinition[]>([]);
  readonly points = signal(0);
  readonly pointsLoading = signal(true);

  // Unopened packs won from the wheel — purchased packs still open
  // immediately and never end up here (see spin.ts/packs.ts's split).
  readonly ownedPacks = signal<OwnedPack[]>([]);
  readonly ownedPacksLoading = signal(true);
  readonly openingOwnedId = signal<string | null>(null);
  readonly ownedOpenError = signal<string | null>(null);

  // Grouped by type so "3x Legendary Pack" reads as a count with one Open
  // button, rather than three separate identical rows.
  readonly ownedPacksGrouped = computed(() => {
    const groups = new Map<PackType, { packType: PackType; items: OwnedPack[] }>();
    for (const p of this.ownedPacks()) {
      const g = groups.get(p.packType);
      if (g) g.items.push(p);
      else groups.set(p.packType, { packType: p.packType, items: [p] });
    }
    return [...groups.values()];
  });

  // Angles for the legendary-reveal starburst rays, evenly spaced — same
  // pattern as the wheel's win burst (wheel.ts/wheel.css).
  readonly burstRays = Array.from({ length: 12 }, (_, i) => i * 30);

  // Scattered twinkle positions around the card for the legendary reveal —
  // fixed, not random, so the effect is identical (and reviewable) on every
  // pull rather than occasionally clumping or landing off-card.
  readonly sparklePositions = [
    { top: "8%", left: "14%", delay: "0s" },
    { top: "18%", left: "82%", delay: "0.12s" },
    { top: "48%", left: "-4%", delay: "0.24s" },
    { top: "58%", left: "96%", delay: "0.06s" },
    { top: "82%", left: "20%", delay: "0.3s" },
    { top: "88%", left: "76%", delay: "0.18s" },
    { top: "4%", left: "50%", delay: "0.36s" },
  ];

  // Reveal/summary cards render bigger on desktop, where there's room —
  // maxWidth is a numeric component input, not CSS, so it needs an actual
  // breakpoint check rather than a Tailwind class.
  private static readonly DESKTOP_BREAKPOINT = 1024;
  readonly isDesktop = signal(this.checkDesktop());
  // Mobile size trimmed ~5% (220 -> 209) for a bit more breathing room
  // around the reveal card on small screens. Desktop trimmed 20%
  // (320 -> 256, 2026-09-02) — felt oversized at the original size.
  readonly cardSize = computed(() => (this.isDesktop() ? 256 : 209));
  readonly summaryCardSize = computed(() => (this.isDesktop() ? 170 : 120));
  // Same aspect ratio as the card (2.5:3.5) plus headroom for the stack's
  // diagonal peek — scales with cardSize so the peek stays proportional.
  readonly cardStackHeight = computed(() => Math.round(this.cardSize() * 1.4) + 32);
  readonly stackOffsetScale = computed(() => this.cardSize() / 220);

  @HostListener("window:resize")
  onResize(): void {
    this.isDesktop.set(this.checkDesktop());
  }

  private checkDesktop(): boolean {
    return typeof window !== "undefined" && window.innerWidth >= PacksComponent.DESKTOP_BREAKPOINT;
  }

  readonly opening = signal<PackType | null>(null);
  readonly openError = signal<string | null>(null);

  readonly view = signal<PackView>("selecting");
  readonly outcome = signal<PackOpenOutcome | null>(null);
  readonly revealIndex = signal(0);

  readonly visualClasses = PACK_VISUAL_CLASSES;

  readonly transitionOutCard = signal<PackOpenResultCard | null>(null);
  readonly isTransitioning = signal(false);

  readonly currentCard = computed<PackOpenResultCard | null>(
    () => this.outcome()?.results[this.revealIndex()] ?? null
  );
  readonly isLastCard = computed(() => {
    const o = this.outcome();
    return o ? this.revealIndex() === o.results.length - 1 : false;
  });
  // Not-yet-revealed cards, soonest-first — rendered as anonymous peeking
  // edges behind the current card so you can see how many are left.
  readonly remainingCards = computed<PackOpenResultCard[]>(
    () => this.outcome()?.results.slice(this.revealIndex() + 1) ?? []
  );

  ngOnInit(): void {
    this.api.getPacks().subscribe({
      next: (rows) => {
        this.packs.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    if (this.auth.isAuthenticated()) {
      this.api.getMyPredictionSummary().subscribe({
        next: (summary) => {
          this.points.set(summary.points);
          this.pointsLoading.set(false);
        },
        error: () => this.pointsLoading.set(false),
      });
      this.refreshOwnedPacks();
    } else {
      this.pointsLoading.set(false);
      this.ownedPacksLoading.set(false);
    }
  }

  // Duplicates are auto-sold server-side the instant they're rolled — this
  // just totals up what came back so the points badge reflects it
  // immediately, without a separate sell round trip per card.
  private duplicateGain(outcome: PackOpenOutcome): number {
    return outcome.results.reduce((sum, r) => sum + (r.wasDuplicate ? (r.sellValue ?? 0) : 0), 0);
  }

  private refreshOwnedPacks(): void {
    this.api.getOwnedPacks().subscribe({
      next: (rows) => {
        this.ownedPacks.set(rows);
        this.ownedPacksLoading.set(false);
      },
      error: () => this.ownedPacksLoading.set(false),
    });
  }

  openOwned(pack: OwnedPack): void {
    if (this.openingOwnedId()) return;
    this.openingOwnedId.set(pack.id);
    this.ownedOpenError.set(null);

    this.api.openOwnedPack(pack.id).subscribe({
      next: (outcome) => {
        this.ownedPacks.update((rows) => rows.filter((r) => r.id !== pack.id));
        this.outcome.set(outcome);
        this.revealIndex.set(0);
        this.transitionOutCard.set(null);
        this.isTransitioning.set(false);
        this.points.update((p) => p + this.duplicateGain(outcome));
        this.openingOwnedId.set(null);
        this.view.set("revealing");
      },
      error: (err) => {
        this.openingOwnedId.set(null);
        this.ownedOpenError.set(err?.error?.error ?? "Failed to open pack.");
      },
    });
  }

  // Trading-card-style set-code micro-print on the pack art, standing in for
  // repeating the pack's full name on the card (the list below the grid
  // already spells that out). Only the three purchasable tiers ever render
  // in that grid, so wheel-exclusive types are never looked up here.
  private static readonly SET_CODES: Partial<Record<PackType, string>> = {
    starter: "RS",
    pro: "PO",
    elite: "F4",
  };

  setCode(type: PackType): string {
    return `EL 26–27 · ${PacksComponent.SET_CODES[type] ?? "—"}`;
  }

  // Backend's PackDefinition.label (services/packs.ts) is an internal,
  // English-only display string — see the packs.label.* comment in
  // i18n/store.ts for why the frontend never renders it directly.
  packLabel(type: PackType): string {
    return this.i18n.t(`packs.label.${type}`);
  }

  tagline(type: PackType): string {
    return this.i18n.t(`packs.tagline.${type}`);
  }

  blurb(type: PackType): string {
    return this.i18n.t(`packs.blurb.${type}`);
  }

  // A fresh (never a duplicate — those never touch userCollectibles, see
  // schema.ts's finish column comment) foil legendary gets its own,
  // more intense reveal — see the card-reveal-anim--foil/burst-*--foil
  // rules in packs.css.
  isFoilCard(card: PackOpenResultCard): boolean {
    return !card.wasDuplicate && card.collectible.tier === "legendary" && card.collectible.finish === "foil";
  }

  canAfford(pack: PackDefinition): boolean {
    return !this.pointsLoading() && this.points() >= pack.pointsCost;
  }

  open(pack: PackDefinition): void {
    if (!this.auth.isAuthenticated() || this.opening()) return;
    this.opening.set(pack.type);
    this.openError.set(null);

    this.api.openPack(pack.type).subscribe({
      next: (outcome) => {
        this.outcome.set(outcome);
        this.revealIndex.set(0);
        this.transitionOutCard.set(null);
        this.isTransitioning.set(false);
        this.points.set(this.points() - pack.pointsCost + this.duplicateGain(outcome));
        this.opening.set(null);
        this.view.set("revealing");
      },
      error: (err) => {
        this.opening.set(null);
        this.openError.set(err?.error?.error ?? "Failed to open pack.");
      },
    });
  }

  nextCard(): void {
    if (this.isTransitioning()) return;
    if (this.isLastCard()) {
      this.view.set("summary");
      return;
    }

    // Two-phase transition: play the outgoing card's exit animation first,
    // then swap the index (triggering the next card's entrance animation)
    // once it's actually finished — otherwise the swap is instant and the
    // "animation" is just a fade-in on the new card with nothing in between.
    this.transitionOutCard.set(this.currentCard());
    this.isTransitioning.set(true);
    setTimeout(() => {
      this.revealIndex.update((i) => i + 1);
      this.transitionOutCard.set(null);
      this.isTransitioning.set(false);
    }, CARD_EXIT_MS);
  }

  openAnother(): void {
    this.outcome.set(null);
    this.view.set("selecting");
  }
}
