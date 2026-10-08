import { CountUpComponent } from "../../shared/count-up";
import { Component, OnInit, HostListener, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { PackDefinition, OwnedPack, PackOpenOutcome, PackOpenResultCard, PackType } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { PACK_VISUAL_CLASSES } from "../../shared/pack-visual";
import { PackArtComponent } from "../../shared/pack-art";
import { packSourceText } from "../../shared/pack-source";
import { displayTeamCode } from "../../shared/team-display-code";
import { PackRewardsService } from "../../core/pack-rewards.service";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHintComponent } from "../../shared/page-hint";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { SkeletonComponent } from "../../shared/skeleton";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";
import { PageHeaderComponent } from "../../shared/page-header";

// Opening timings — keep in sync with packs.css (.pack-stage.is-tearing,
// .flip-card, .walkout).
const PACK_TEAR_MS = 950;
const FLIP_MS = 750;
const BIG_FLIP_MS = 1100;
// Walkout before a new legendary/foil (coach gets a shorter one).
const WALKOUT_MS = { legendary: 1400, coach: 800 } as const;

// Card rank for the table order (best card last). Duplicates sit just
// below a new card of the same tier.
const TIER_RANK: Record<string, number> = { common: 0, rare: 1, coach: 2, legendary: 3 };
function revealRank(card: PackOpenResultCard): number {
  const foil = !card.wasDuplicate && card.collectible.tier === "legendary" && card.collectible.finish === "foil";
  return (TIER_RANK[card.collectible.tier] ?? 0) * 2 + (card.wasDuplicate ? 0 : 1) + (foil ? 2 : 0);
}

// Same tier colours as the slot pips (packs.css .slot-pip--*).
const TIER_COLOR: Record<string, string> = { common: "#9aa3ad", rare: "#8ec5ff", coach: "#3fd9a4", legendary: "#f5c043" };

type PackView = "selecting" | "pack" | "deck" | "summary";

@Component({
  selector: "app-packs",
  standalone: true,
  imports: [PageHeaderComponent, CountUpComponent, 
    CommonModule,
    PackArtComponent,
    RouterLink,
    CollectibleCardComponent,
    ButtonDirective,
    PageHintComponent,
    LogoSpinnerComponent,
    SkeletonComponent,
    ConfirmDialogComponent,
  ],
  templateUrl: "./packs.html",
  styleUrl: "./packs.css",
})
export class PacksComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);
  private packRewards = inject(PackRewardsService);

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

  readonly visualClasses = PACK_VISUAL_CLASSES;

  // The pack being opened, shown sealed in the "pack" view.
  readonly openedPackType = signal<PackType | null>(null);
  readonly tearing = signal(false);
  // Cards turned over so far; the last one is face up on top of the deck.
  readonly deckIndex = signal(0);
  // The big pull whose walkout is playing, before its flip.
  readonly walkout = signal<PackOpenResultCard | null>(null);
  private deckBusy = false;
  private deckTimers: ReturnType<typeof setTimeout>[] = [];

  // Best card last, so the deck builds up to it.
  readonly deckOrder = computed<PackOpenResultCard[]>(() =>
    [...(this.outcome()?.results ?? [])].sort((a, b) => revealRank(a) - revealRank(b))
  );
  readonly activeCard = computed(() => (this.deckIndex() > 0 ? this.deckOrder()[this.deckIndex() - 1] : null));
  readonly deckRemaining = computed(() => this.deckOrder().slice(this.deckIndex()));
  readonly deckPulled = computed(() => this.deckOrder().slice(0, Math.max(0, this.deckIndex() - 1)));
  // The beam colour when the pack tears: the best card inside.
  private readonly bestCard = computed(() => this.deckOrder()[this.deckOrder().length - 1] ?? null);
  readonly bestTierColor = computed(() => {
    const best = this.bestCard();
    return best && !best.wasDuplicate ? TIER_COLOR[best.collectible.tier] ?? TIER_COLOR["common"] : TIER_COLOR["common"];
  });
  readonly bestIsFoil = computed(() => {
    const best = this.bestCard();
    return !!best && this.isFoilCard(best);
  });

  tierColor(card: PackOpenResultCard): string {
    return TIER_COLOR[card.collectible.tier] ?? TIER_COLOR["common"];
  }

  // The face-down back previews the rarity (foil gets its own).
  backTier(card: PackOpenResultCard): string {
    return this.isFoilCard(card) ? "foil" : card.collectible.tier;
  }

  isBigPull(card: PackOpenResultCard): boolean {
    return !card.wasDuplicate && (card.collectible.tier === "legendary" || card.collectible.tier === "coach");
  }

  teamDisplayCode(code: string): string {
    return displayTeamCode(code);
  }

  walkoutTierLabel(card: PackOpenResultCard): string {
    if (this.isFoilCard(card)) return this.i18n.t("packs.foilBang");
    return this.i18n.t(card.collectible.tier === "coach" ? "inventory.tierCoach" : "inventory.tierLegendary");
  }

  // Each tap turns over the next card (the face-up one joins the pulled
  // strip). A new legendary/foil/coach gets its walkout first. After the
  // last card, a tap shows the summary.
  tapDeck(): void {
    if (this.deckBusy || this.walkout()) return;
    const next = this.deckOrder()[this.deckIndex()];
    if (!next) {
      this.view.set("summary");
      return;
    }
    this.deckBusy = true;
    const flipIt = () => {
      this.walkout.set(null);
      this.deckIndex.update((i) => i + 1);
      this.deckTimers.push(setTimeout(() => (this.deckBusy = false), this.isBigPull(next) ? BIG_FLIP_MS : FLIP_MS));
    };
    if (this.isBigPull(next)) {
      this.walkout.set(next);
      this.deckTimers.push(setTimeout(flipIt, WALKOUT_MS[next.collectible.tier as keyof typeof WALKOUT_MS] ?? 800));
    } else {
      flipIt();
    }
  }

  private clearDeckTimers(): void {
    this.deckTimers.forEach(clearTimeout);
    this.deckTimers = [];
    this.deckBusy = false;
    this.walkout.set(null);
  }

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
        this.packRewards.syncUnopenedCount(rows.length);
        this.maybeAutoOpen(rows);
        this.ownedPacksLoading.set(false);
      },
      error: () => this.ownedPacksLoading.set(false),
    });
  }

  // Jump Ball's "Open now" (2026-09-29) lands here as /packs?open=<id> —
  // open that owned pack straight into the reveal, once, then drop the
  // param so a refresh doesn't try again.
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private autoOpenHandled = false;

  private maybeAutoOpen(rows: OwnedPack[]): void {
    if (this.autoOpenHandled) return;
    const id = this.route.snapshot.queryParamMap.get("open");
    if (!id) return;
    this.autoOpenHandled = true;
    this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: "merge", replaceUrl: true });
    const pack = rows.find((r) => r.id === id);
    if (pack) this.openOwned(pack);
  }

  // Skip the rest of the one-by-one reveal (2026-09-29).
  revealAll(): void {
    this.clearDeckTimers();
    this.view.set("summary");
  }

  openOwned(pack: OwnedPack): void {
    if (this.openingOwnedId()) return;
    this.openingOwnedId.set(pack.id);
    this.ownedOpenError.set(null);

    this.api.openOwnedPack(pack.id).subscribe({
      next: (outcome) => {
        this.ownedPacks.update((rows) => rows.filter((r) => r.id !== pack.id));
        this.packRewards.packOpened(pack.id);
        this.points.update((p) => p + this.duplicateGain(outcome));
        this.openingOwnedId.set(null);
        this.startReveal(outcome, pack.packType);
      },
      error: (err) => {
        this.openingOwnedId.set(null);
        this.ownedOpenError.set(err?.error?.error ?? "Failed to open pack.");
      },
    });
  }

  // Backend's PackDefinition.label (services/packs.ts) is an internal,
  // English-only display string — see the packs.label.* comment in
  // i18n/store.ts for why the frontend never renders it directly.
  packLabel(type: PackType): string {
    return this.i18n.t(`packs.label.${type}`);
  }

  // Why these packs were granted (2026-09-30), one caption per distinct
  // reason in the group, e.g. "18 correct picks milestone · Jump Ball win".
  groupReasons(items: OwnedPack[]): string {
    const reasons = items.map((p) => packSourceText(this.i18n, p.source)).filter((r): r is string => r !== null);
    return [...new Set(reasons)].join(" · ");
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

  // One pip per slot for the pack tile's slot strip: a guaranteed tier is a
  // solid pip; a mixed slot shows its likeliest tier with the upside tier as
  // a corner accent. The title spells out the exact odds.
  slotPips(pack: PackDefinition): { base: string; upside: string | null; title: string }[] {
    const tierName: Record<string, string> = {
      common: this.i18n.t("inventory.tierCommon"),
      rare: this.i18n.t("inventory.tierRare"),
      legendary: this.i18n.t("inventory.tierLegendary"),
      coach: this.i18n.t("inventory.tierCoach"),
    };
    return (pack.slotOdds ?? []).map((odds) => {
      const entries = Object.entries(odds)
        .filter(([, p]) => (p ?? 0) > 0)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [string, number][];
      const base = entries[0]?.[0] ?? "common";
      // Rarest non-base tier is the "upside" (legendary beats coach beats rare).
      const rank = ["common", "rare", "coach", "legendary"];
      const upside = entries.slice(1).sort((a, b) => rank.indexOf(b[0]) - rank.indexOf(a[0]))[0]?.[0] ?? null;
      const title = entries.map(([t, p]) => `${Math.round(p * 100)}% ${tierName[t] ?? t}`).join(" · ");
      return { base, upside, title };
    });
  }

  pointsShort(pack: PackDefinition): number {
    return Math.max(0, pack.pointsCost - this.points());
  }

  canAfford(pack: PackDefinition): boolean {
    return !this.pointsLoading() && this.points() >= pack.pointsCost;
  }

  // Purchase confirmation (2026-09-26, direct request) — a tap on the pack
  // grid used to spend points immediately with no "are you sure?" step.
  // The grid button now calls requestOpen(), which just stages the pack
  // and shows app-confirm-dialog (packs.html); open() itself (the real
  // spend) only ever runs from confirmOpen(), never directly from a click.
  readonly pendingPack = signal<PackDefinition | null>(null);

  requestOpen(pack: PackDefinition): void {
    if (!this.auth.isAuthenticated() || this.opening() || !this.canAfford(pack)) return;
    this.pendingPack.set(pack);
  }

  confirmBuyMessage(pack: PackDefinition): string {
    return `${this.i18n.t("packs.confirmBuyPrefix")} ${this.packLabel(pack.type)} ${this.i18n.t("packs.confirmBuyFor")} ${pack.pointsCost} ${this.i18n.t("packs.ptsLower")}?`;
  }

  confirmOpen(): void {
    const pack = this.pendingPack();
    this.pendingPack.set(null);
    if (pack) this.open(pack);
  }

  open(pack: PackDefinition): void {
    if (!this.auth.isAuthenticated() || this.opening()) return;
    this.opening.set(pack.type);
    this.openError.set(null);

    this.api.openPack(pack.type).subscribe({
      next: (outcome) => {
        this.points.set(this.points() - pack.pointsCost + this.duplicateGain(outcome));
        this.opening.set(null);
        this.startReveal(outcome, pack.type);
      },
      error: (err) => {
        this.opening.set(null);
        this.openError.set(err?.error?.error ?? "Failed to open pack.");
      },
    });
  }

  private startReveal(outcome: PackOpenOutcome, packType: PackType): void {
    this.outcome.set(outcome);
    this.openedPackType.set(packType);
    this.tearing.set(false);
    this.clearDeckTimers();
    this.deckIndex.set(0);
    this.view.set("pack");
  }

  // Tap the sealed pack: it shakes, tears and lights up in the best card's
  // colour, then every card lands face down on the table.
  tearPack(): void {
    if (this.tearing()) return;
    this.tearing.set(true);
    setTimeout(() => {
      if (this.view() !== "pack") return; // "Reveal all" was tapped meanwhile
      this.tearing.set(false);
      this.view.set("deck");
    }, PACK_TEAR_MS);
  }

  openAnother(): void {
    this.outcome.set(null);
    this.view.set("selecting");
  }
}
