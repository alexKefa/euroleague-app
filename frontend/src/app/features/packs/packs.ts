import { Component, OnInit, HostListener, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { PackDefinition, PackOpenOutcome, PackOpenResultCard, PackType } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { PackIconComponent } from "../../shared/pack-icon";

// Rising quality per tier, echoed in icon color, badge, and the pack shell's
// foil gradient — matches the exact bronze/silver/gold tones of
// .pack-visual-starter/-pro/-elite (packs.css) rather than an unrelated
// palette, so the description row's icon actually reads as "this tier".
// The wheelStarter/wheelPro/wheelLegendary entries below are never actually
// rendered here — GET /api/packs excludes them from the store listing this
// page shows (see the `purchasable` flag in backend/src/services/packs.ts)
// — filled in anyway (matching each one's "flavor" tier) so this stays a
// total map rather than needing a runtime fallback if that ever changes.
const PACK_ICON_CLASSES: Record<PackType, string> = {
  starter: "bg-[#8a5a34]/15 text-[#d99a5b]",
  pro: "bg-[#aab2ba]/20 text-[#c9d3da]",
  elite: "bg-[#caa53a]/20 text-[#f4d675]",
  wheelStarter: "bg-[#8a5a34]/15 text-[#d99a5b]",
  wheelPro: "bg-[#aab2ba]/20 text-[#c9d3da]",
  wheelLegendary: "bg-[#caa53a]/20 text-[#f4d675]",
};

// Pack-selection art: a physical-foil-pack silhouette per tier, reusing the
// exact same rare/legendary gradients as the card frames themselves
// (collectible-card.ts) so the pack you tap actually matches what's inside.
const PACK_VISUAL_CLASSES: Record<PackType, string> = {
  starter: "pack-visual-starter",
  pro: "pack-visual-pro",
  elite: "pack-visual-elite",
  wheelStarter: "pack-visual-starter",
  wheelPro: "pack-visual-pro",
  wheelLegendary: "pack-visual-elite",
};

// Exit-animation duration for the outgoing card in the reveal sequence —
// keep in sync with the .card-exit-anim animation-duration in packs.css.
const CARD_EXIT_MS = 320;

type PackView = "selecting" | "revealing" | "summary";

@Component({
  selector: "app-packs",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, PackIconComponent],
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
  // around the reveal card on small screens.
  readonly cardSize = computed(() => (this.isDesktop() ? 320 : 209));
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
  readonly soldResultIds = signal<Set<string>>(new Set());
  readonly sellingId = signal<string | null>(null);

  readonly iconClasses = PACK_ICON_CLASSES;
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
    } else {
      this.pointsLoading.set(false);
    }
  }

  tagline(type: PackType): string {
    return this.i18n.t(`packs.tagline.${type}`);
  }

  blurb(type: PackType): string {
    return this.i18n.t(`packs.blurb.${type}`);
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
        this.soldResultIds.set(new Set());
        this.transitionOutCard.set(null);
        this.isTransitioning.set(false);
        this.points.set(this.points() - pack.pointsCost);
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

  sellDuplicate(card: PackOpenResultCard): void {
    if (this.sellingId()) return;
    this.sellingId.set(card.resultId);

    this.api.sellPackDuplicate(card.resultId).subscribe({
      next: ({ points }) => {
        this.points.update((p) => p + points);
        this.soldResultIds.update((ids) => new Set(ids).add(card.resultId));
        this.sellingId.set(null);
      },
      error: () => this.sellingId.set(null),
    });
  }

  isSold(card: PackOpenResultCard): boolean {
    return this.soldResultIds().has(card.resultId);
  }

  openAnother(): void {
    this.outcome.set(null);
    this.view.set("selecting");
  }
}
