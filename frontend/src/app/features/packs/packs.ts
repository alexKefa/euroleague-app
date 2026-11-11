import { CountUpComponent } from "../../shared/count-up";
import { Component, OnInit, OnDestroy, HostListener, ElementRef, NgZone, inject, signal, computed, viewChild } from "@angular/core";
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
import {
  Body,
  DragSample,
  FLIGHT,
  HOME,
  MAX_DRAG_ROTATION,
  Pose,
  REST,
  TAP_SLOP,
  THROW_DISTANCE,
  THROW_VELOCITY,
  Throw,
  isSettled,
  launch,
  makeBody,
  poseTransform,
  prefersReducedMotion,
  releaseVelocity,
  stepBody,
} from "../../shared/throw-physics";
import { PageHeaderComponent } from "../../shared/page-header";

// Opening timings — keep in sync with packs.css (.pack-stage.is-tearing,
// .flip-card, .walkout).
const PACK_TEAR_MS = 950;
const FLIP_MS = 750;
const BIG_FLIP_MS = 1100;
// Walkout before a new legendary/foil (coach gets a shorter one).
const WALKOUT_MS = { legendary: 1400, coach: 800 } as const;
// After the last card is thrown, let it clear the stage before the summary.
const LAST_THROW_MS = 380;
// Fixed, hand-squared tilt of the face-down cards by depth.
const DECK_TILTS = [0, -2, 1.5, -1, 1];

interface DeckDrag {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  width: number;
  /** +1 when grabbed in the top half, -1 in the bottom half. */
  lever: number;
  moved: boolean;
  samples: DragSample[];
}

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
export class PacksComponent implements OnInit, OnDestroy {
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

  // Each tap turns over the next card. Once a card is face up, a tap (or a
  // swipe, 2026-11-11) throws it off the deck into the pulled strip and
  // turns the next one; a new legendary/foil/coach gets its walkout first.
  // After the last card, the summary.
  tapDeck(): void {
    if (this.deckBusy || this.walkout() || this.drag) return;
    const active = this.activeCard();
    if (active) this.throwActive(active, this.homing ? this.activeBody : REST, 1.3, -0.35, 1, 0);
    this.flipNext();
  }

  onStageClick(): void {
    // The click that ends a drag must not also advance the deck.
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.tapDeck();
  }

  private flipNext(): void {
    const next = this.deckOrder()[this.deckIndex()];
    if (!next) {
      if (this.thrown()) {
        this.deckBusy = true;
        this.deckTimers.push(setTimeout(() => this.view.set("summary"), LAST_THROW_MS));
      } else {
        this.view.set("summary");
      }
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

  // ---- Throwing the face-up card (physics in shared/throw-physics.ts) ----

  private zone = inject(NgZone);
  private readonly stageEl = viewChild<ElementRef<HTMLElement>>("deckStage");
  private readonly activeEl = viewChild<ElementRef<HTMLElement>>("activeEl");
  private readonly thrownEl = viewChild<ElementRef<HTMLElement>>("thrownEl");
  // The card in flight: a copy of the face-up card that flies off while the
  // deck moves on underneath it.
  readonly thrown = signal<{ card: PackOpenResultCard; start: string } | null>(null);
  private flight: Throw | null = null;
  private drag: DeckDrag | null = null;
  private activeBody: Body = makeBody(REST);
  private homing = false;
  private suppressClick = false;
  private raf = 0;
  private lastFrame = 0;

  private throwActive(card: PackOpenResultCard, from: Pose, vx: number, vy: number, fx: number, fy: number): void {
    const start: Pose = { x: from.x, y: from.y, r: from.r, s: from.s };
    this.homing = false;
    this.activeBody = makeBody(REST);
    if (prefersReducedMotion()) return;
    const node = this.activeEl()?.nativeElement;
    const w = node?.offsetWidth || this.cardSize();
    const h = node?.offsetHeight || this.cardSize() * 1.4;
    this.flight = launch(start, vx, vy, fx, fy, w, h);
    this.thrown.set({ card, start: poseTransform(start) });
    this.kick();
  }

  // The stage resets this on every press, so a drag whose click never
  // arrives can't swallow the next real tap.
  onStagePointerDown(): void {
    this.suppressClick = false;
  }

  onCardPointerDown(event: PointerEvent): void {
    if (this.drag || this.deckBusy || this.walkout()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const node = event.currentTarget as HTMLElement;
    const rect = node.getBoundingClientRect();
    node.setPointerCapture(event.pointerId);
    this.homing = false;
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: this.activeBody.x,
      baseY: this.activeBody.y,
      width: node.offsetWidth,
      lever: event.clientY - rect.top < rect.height / 2 ? 1 : -1,
      moved: false,
      samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }],
    };
  }

  onCardPointerMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d || d.pointerId !== event.pointerId) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      // Touch axis lock: a mostly vertical swipe is a page scroll, so let go
      // of the card and leave it to the browser (touch-action: pan-y).
      if (event.pointerType !== "mouse" && Math.abs(dy) > Math.abs(dx)) {
        this.drag = null;
        const node = event.currentTarget as HTMLElement;
        if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
        return;
      }
    }
    d.moved = true;
    d.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (d.samples.length > 24) d.samples.shift();
    const b = this.activeBody;
    b.x = d.baseX + dx;
    b.y = d.baseY + dy;
    b.s = 1;
    // Pivot at the bottom edge: grabbing the top half swings the top out.
    b.r = Math.max(-1, Math.min(1, b.x / d.width)) * MAX_DRAG_ROTATION * d.lever;
    b.vx = b.vy = b.vr = b.vs = 0;
    this.writeActive();
    // The pile underneath rises to meet the throw.
    this.setLift(Math.min(Math.hypot(b.x, b.y) / (d.width * THROW_DISTANCE), 1));
  }

  onCardPointerUp(event: PointerEvent, cancelled = false): void {
    const d = this.drag;
    if (!d || d.pointerId !== event.pointerId) return;
    this.drag = null;
    this.setLift(0);
    if (!d.moved) return; // a tap: the stage's click handles it
    if (cancelled) {
      this.springHome();
      return;
    }
    this.suppressClick = true;
    const b = this.activeBody;
    const { vx, vy } = releaseVelocity(d.samples);
    const speed = Math.hypot(vx, vy);
    const distance = Math.hypot(b.x, b.y);
    // A flick back toward the deck is a change of mind, not a throw.
    const heading = distance > 0 ? (vx * b.x + vy * b.y) / distance : 0;
    const fast = speed > THROW_VELOCITY && heading > -0.2;
    const far = distance > d.width * THROW_DISTANCE && heading > -0.3;
    const card = this.activeCard();
    if ((fast || far) && card && !this.deckBusy && !this.walkout()) {
      this.throwActive(card, b, vx, vy, b.x / (distance || 1), b.y / (distance || 1));
      this.flipNext();
      return;
    }
    // Spring home, carrying the release velocity into the spring.
    b.vx = vx * 1000;
    b.vy = vy * 1000;
    b.vr = ((vx * 1000) / d.width) * MAX_DRAG_ROTATION * d.lever;
    this.springHome();
  }

  private springHome(): void {
    if (prefersReducedMotion()) {
      this.activeBody = makeBody(REST);
      this.writeActive();
      return;
    }
    this.homing = true;
    this.kick();
  }

  private writeActive(): void {
    const node = this.activeEl()?.nativeElement;
    if (node) node.style.transform = poseTransform(this.activeBody);
  }

  private setLift(p: number): void {
    this.stageEl()?.nativeElement.style.setProperty("--lift", p.toFixed(3));
  }

  // One rAF loop for the flight and the spring home; it sleeps when both
  // are done. Runs outside Angular so frames don't trigger change detection.
  private kick(): void {
    if (this.raf) return;
    this.zone.runOutsideAngular(() => {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    });
  }

  private readonly tick = (now: number): void => {
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 30);
    this.lastFrame = now;
    let running = false;

    const f = this.flight;
    if (f) {
      stepBody(f.body, f.target, FLIGHT, dt);
      const travelled = (f.body.x * f.dx + f.body.y * f.dy) / f.distance;
      const node = this.thrownEl()?.nativeElement;
      if (node) {
        node.style.transform = poseTransform(f.body);
        node.style.opacity = String(Math.max(0, Math.min(1, (1 - travelled) * 3)));
      }
      // Gone once it clears the deck or reaches the top of its arc.
      if (travelled >= 0.97 || f.body.vx * f.dx + f.body.vy * f.dy <= 0) {
        this.flight = null;
        this.zone.run(() => this.thrown.set(null));
      } else {
        running = true;
      }
    }

    if (this.homing) {
      stepBody(this.activeBody, REST, HOME, dt);
      if (isSettled(this.activeBody, REST)) {
        this.activeBody = makeBody(REST);
        this.homing = false;
      } else {
        running = true;
      }
      this.writeActive();
    }

    this.raf = running ? requestAnimationFrame(this.tick) : 0;
  };

  private stopThrowing(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.flight = null;
    this.drag = null;
    this.homing = false;
    this.suppressClick = false;
    this.activeBody = makeBody(REST);
    this.thrown.set(null);
  }

  // Face-down card at `depth`: a fixed tilt, and the pile rises toward the
  // slot above as a drag nears a throw (--lift, set during the drag).
  deckCardTransform(depth: number): string {
    const tilt = DECK_TILTS[Math.min(depth, DECK_TILTS.length - 1)];
    const d = `max(0, ${depth} - var(--lift, 0) * 0.6)`;
    return `translateY(calc(${d} * 9px)) rotate(${tilt}deg) scale(calc(1 - ${d} * 0.035))`;
  }

  ngOnDestroy(): void {
    this.clearDeckTimers();
  }

  private clearDeckTimers(): void {
    this.deckTimers.forEach(clearTimeout);
    this.deckTimers = [];
    this.deckBusy = false;
    this.walkout.set(null);
    this.stopThrowing();
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
