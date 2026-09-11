import { Component, DestroyRef, inject, OnInit, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { ThemeService } from "../../core/theme.service";
import { CollectibleTier, PlayerAdvancedStatsRow, Team } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { TeamCodePipe } from "../../shared/team-display-code";
import { TeamBadgeComponent } from "../../shared/team-badge";
import { CourtBackgroundComponent } from "../../shared/court-background";
import { CollectibleCardComponent } from "../store/collectible-card";

interface ShowcaseCard {
  tier: CollectibleTier;
  name: string;
  teamCode: string;
  teamColor: string | null;
  imageUrl: string | null;
  pointsPerGame: number | null;
}

type StepVisual = "team" | "scores" | "predictions" | "fantasy" | "cards" | "leagues" | "cta";

interface LandingStep {
  icon: NavIconName;
  titleKey: string;
  // Optional — the closing "cta" step has no body copy, just the title and
  // its big button (see the template's @if around the body <p>).
  bodyKey?: string;
  visual: StepVisual;
}

// The interactive "pick your team" demo used to be its own section ahead of
// this carousel — folded in as the carousel's own first step instead (one
// interactive showcase, not two stacked ones competing for the same kind of
// attention right after the hero).
const STEPS: LandingStep[] = [
  { icon: "ball", titleKey: "landing.featureTeamTitle", bodyKey: "landing.featureTeamBody", visual: "team" },
  { icon: "schedule", titleKey: "landing.featureScoresTitle", bodyKey: "landing.featureScoresBody", visual: "scores" },
  { icon: "picks", titleKey: "landing.featurePredictionsTitle", bodyKey: "landing.featurePredictionsBody", visual: "predictions" },
  { icon: "fantasy", titleKey: "landing.featureFantasyTitle", bodyKey: "landing.featureFantasyBody", visual: "fantasy" },
  { icon: "cards", titleKey: "landing.featureCardsTitle", bodyKey: "landing.featureCardsBody", visual: "cards" },
  { icon: "trophy", titleKey: "landing.featureLeaguesTitle", bodyKey: "landing.featureLeaguesBody", visual: "leagues" },
  // Closing slide, deliberately last — a real actionable button (not
  // another mockup) rather than one more thing to read, so no body copy.
  { icon: "zap", titleKey: "landing.finalTitle", visual: "cta" },
];

const AUTOPLAY_MS = 4500;

// The "cards" step's 4-card hand — a real fanned spread (rotation +
// a slight vertical drop on the outer two, pivoting from the bottom edge so
// it reads as held cards, not just flat overlapping rectangles). Fixed to 4
// entries since showcaseCards() below is always exactly 3 player tiers + 1
// coach.
const CARD_FAN_TRANSFORMS = [
  "rotate(-12deg) translateY(10px)",
  "rotate(-4deg) translateY(0px)",
  "rotate(4deg) translateY(0px)",
  "rotate(12deg) translateY(10px)",
];

// CollectibleCardComponent's own name/badge/banner text is fixed-px, not
// proportional to its `maxWidth` input — rendering it directly at a small
// size (tried at 104px, then 76px) left that fixed-size chrome dominating
// the whole card face and hiding the photo underneath it entirely
// (confirmed live: "description bigger than the card, image not visible").
// 130px is the same size Album's own grid uses (album.html) — proportions
// are known-good there. Every fan card renders at that real size and is
// then scaled down as a whole (photo, banner, badge together) to the
// actual on-page footprint, rather than shrinking the box directly.
const CARD_RENDER_WIDTH = 130;
const CARD_FAN_SIZE = { width: 80, height: 112 };

// Perceived brightness (standard luma weights), 0-255. Returns null for
// anything that isn't a plain "#rgb"/"#rrggbb" hex string (every real team
// color is, but this is fed straight from the DB, not validated at the
// schema level) so the caller can fall back to using the color as-is.
// Fisher-Yates, returns a new array — used once when advancedStatsRows
// arrives (not inside showcaseCards' own computed(), which needs to stay a
// pure function of its signal inputs; reshuffling on every recompute would
// make the showcased players change any time an unrelated dependency, like
// teams(), ticks).
function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hexLuma(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const full = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Public, unauthenticated entry point for cold traffic — the QR card and any
// shared link point here, not at "/" (the dashboard), since someone who's
// never seen the app has no idea what "Clutch" even is yet. A logged-in user
// who lands here anyway (e.g. re-scanning the same QR on their own phone) is
// bounced straight to the dashboard in ngOnInit rather than shown the pitch
// again. app.component.ts's hideChrome() suppresses the logged-in app
// shell's top bar/rail/tab bar specifically on this route.
@Component({
  selector: "app-landing",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonDirective,
    ChipDirective,
    NavIconComponent,
    RetryImgDirective,
    TeamCodePipe,
    CollectibleCardComponent,
    TeamBadgeComponent,
    CourtBackgroundComponent,
  ],
  templateUrl: "./landing.html",
  styleUrl: "./landing.css",
})
export class LandingComponent implements OnInit {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected i18n = inject(I18nService);
  // Read-only: only colorScheme() is ever read here, never applyTeam() —
  // see the comment on selectedTeam below for why this demo must never
  // touch the real global theme.
  private theme = inject(ThemeService);

  protected readonly steps = STEPS;
  protected readonly cardFanTransforms = CARD_FAN_TRANSFORMS;
  protected readonly cardFanSize = CARD_FAN_SIZE;
  protected readonly cardRenderWidth = CARD_RENDER_WIDTH;
  protected readonly cardFanScale = CARD_FAN_SIZE.width / CARD_RENDER_WIDTH;
  protected readonly activeStep = signal(0);

  // Live "reskin" demo — a team pick here only ever writes to local CSS
  // custom properties scoped to the preview panel below (see landing.html),
  // never to ThemeService.applyTeam(). That call also caches to
  // localStorage and mutates <html> globally, which would clobber a real
  // logged-in user's actual favorite-team colors if this ever ran while
  // they were signed in — this page's own preview has no business touching
  // that state at all.
  protected readonly teams = signal<Team[]>([]);
  protected readonly selectedTeamId = signal<string | null>(null);
  protected readonly selectedTeam = computed<Team | null>(
    () => this.teams().find((t) => t.id === this.selectedTeamId()) ?? null
  );

  // "predictions" carousel step's mock pick — a real classic matchup with
  // real logos (app-team-badge), not plain 3-letter text pills. Panathinaikos'
  // real internal code is "PAN", not "PAO" (the site's own public
  // abbreviation — see CLAUDE.md's "teams.code vs. the public-site team
  // abbreviation" note); falls back to whichever two teams loaded first if
  // either real code isn't found, so this never renders empty.
  protected readonly predictionsDemoTeams = computed<[Team | null, Team | null]>(() => {
    const list = this.teams();
    const a = list.find((t) => t.code === "PAN") ?? list[0] ?? null;
    const b = list.find((t) => t.code === "OLY") ?? list[1] ?? null;
    return [a, b];
  });
  // Several EuroLeague primary colors are themselves dark navy/near-black
  // (same real issue ThemeService.ambientGlowBackground already documents
  // for the app's own glow) — used raw, a team like Partizan would render
  // near-invisible text/borders against this dark preview card. A flat
  // "mix N% white into everything" first attempt overcorrected the other
  // direction: an already-vivid color like Olympiacos red got diluted into
  // pink. This only touches colors that actually need it, based on the raw
  // color's own luminance — a genuinely bright/saturated brand color (red,
  // orange, a mid blue) passes through completely untouched, full
  // intensity; only a color dark enough to actually risk disappearing gets
  // lifted, and the darkest (near-black) ones are blended toward the app's
  // own neutral --color-muted grey rather than white, since mixing a
  // near-black color with white still (per the report) reads as a washed
  // pastel — a true near-black doesn't carry enough of its own hue for
  // "lighter" to mean anything other than "grey".
  protected readonly previewPrimary = computed(() => {
    const raw = this.selectedTeam()?.primaryColor ?? "#FF6B35";
    const luma = hexLuma(raw);
    const light = this.theme.colorScheme() === "light";

    if (luma === null) return raw;
    if (luma < 35) {
      return `color-mix(in srgb, ${raw} 35%, var(--color-muted) 65%)`;
    }
    if (luma < 60) {
      return light
        ? `color-mix(in srgb, ${raw} 90%, var(--color-ink) 10%)`
        : `color-mix(in srgb, ${raw} 88%, white 12%)`;
    }
    return raw;
  });

  // "cards" carousel step — one real card per catalog tier (common, rare,
  // legendary, coach), rendered with the actual CollectibleCardComponent
  // (not a hand-drawn mockup) so it's a true preview of the real Store/
  // Album art, not an approximation of it. Player names/photos/team colors
  // come straight from the same public /players/advanced-stats payload
  // /compare and /stats already use unauthenticated — coach has no photo by
  // design (see CollectibleCardComponent's own coach-silhouette fallback),
  // so its card uses the real head coach's name off a team that has one.
  protected readonly advancedStatsRows = signal<PlayerAdvancedStatsRow[]>([]);
  protected readonly showcaseCards = computed<ShowcaseCard[]>(() => {
    const tiers: Exclude<CollectibleTier, "coach">[] = ["common", "rare", "legendary"];
    const playerCards = this.advancedStatsRows()
      .filter((row) => row.player.photoUrl)
      .slice(0, 3)
      .map((row, i) => ({
        tier: tiers[i],
        name: row.player.name,
        teamCode: row.team.code,
        teamColor: row.team.primaryColor,
        imageUrl: row.player.photoUrl,
        pointsPerGame: row.stats.pointsPerGame,
      }));

    const coachTeam = this.teams().find((t) => t.headCoach);
    const coachCard: ShowcaseCard = {
      tier: "coach",
      name: coachTeam?.headCoach ?? "Coach",
      teamCode: coachTeam?.code ?? "",
      teamColor: coachTeam?.primaryColor ?? null,
      imageUrl: null,
      pointsPerGame: null,
    };

    return [...playerCards, coachCard];
  });

  private autoplayHandle?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    if (this.auth.currentUser()) {
      this.router.navigateByUrl("/");
      return;
    }

    this.api.getTeams().subscribe((teams) => {
      this.teams.set(teams);
      // Pick a team with real kit colors set, not just whichever sorts
      // first — a team with null primary/secondary would make the very
      // first thing a visitor sees the flat default accent instead of the
      // "look, it actually changes" payoff this demo exists for.
      const withColors = teams.find((t) => t.primaryColor);
      this.selectedTeamId.set((withColors ?? teams[0])?.id ?? null);
    });

    // Shuffled here, once, rather than taking the payload's own order —
    // that order groups by team, so the "3 random players" showcase kept
    // landing on 3 players from the same club (reported live: Barcelona).
    this.api.getAdvancedStats().subscribe((res) => this.advancedStatsRows.set(shuffled(res.rows)));

    this.autoplayHandle = setInterval(() => {
      this.activeStep.update((i) => (i + 1) % this.steps.length);
    }, AUTOPLAY_MS);
    this.destroyRef.onDestroy(() => {
      if (this.autoplayHandle) clearInterval(this.autoplayHandle);
    });
  }

  selectTeam(team: Team): void {
    this.selectedTeamId.set(team.id);
    this.stopAutoplay();
  }

  goToStep(i: number): void {
    this.activeStep.set(i);
    this.stopAutoplay();
  }

  nextStep(): void {
    this.activeStep.update((i) => (i + 1) % this.steps.length);
    this.stopAutoplay();
  }

  prevStep(): void {
    this.activeStep.update((i) => (i - 1 + this.steps.length) % this.steps.length);
    this.stopAutoplay();
  }

  private stopAutoplay(): void {
    if (this.autoplayHandle) {
      clearInterval(this.autoplayHandle);
      this.autoplayHandle = undefined;
    }
  }
}
