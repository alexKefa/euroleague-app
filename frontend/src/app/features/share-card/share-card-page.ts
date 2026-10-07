import { AfterViewInit, Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { forkJoin } from "rxjs";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { PlayerDetail, PlayerGameLog } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHeaderComponent } from "../../shared/page-header";
import { SkeletonComponent } from "../../shared/skeleton";
import { KitCardComponent, KitPlayer } from "./kit-card";
import { exportCard } from "./share-export";
import {
  DEFAULT_STATS,
  Period,
  STAT_KEYS,
  STAT_LABELS,
  StatKey,
  computeLine,
  gamesForPeriod,
  opponentsFaced,
  splitName,
} from "./share-card.logic";

interface Loaded {
  detail: PlayerDetail;
  log: PlayerGameLog;
}

type PeriodKind = Period["kind"];

/**
 * /share (2026-10-07): the share-card maker. ?player=<id> for a player card,
 * ?a=<id>&b=<id> for a head-to-head (same params as /compare). Preview on
 * top, period / stats / size below, then Share.
 */
@Component({
  selector: "app-share-card-page",
  standalone: true,
  imports: [RouterLink, ButtonDirective, PageHeaderComponent, SkeletonComponent, KitCardComponent],
  template: `
    <div class="max-w-xl mx-auto p-4 sm:p-6">
      <a [routerLink]="navHistory.previousUrl() ?? '/stats'" class="back-link">{{ i18n.t('nav.back') }}</a>
      <app-page-header [title]="i18n.t('shareCard.title')" [subtitle]="i18n.t('shareCard.subtitle')" icon="share" class="mt-4" />

      @if (loadError()) {
        <p class="mt-6 text-sm text-red-500 font-semibold">{{ i18n.t('shareCard.loadError') }}</p>
      } @else if (!loaded().length) {
        <app-skeleton class="block mt-6 rounded-2xl" [style.aspect-ratio]="'4 / 5'" />
      } @else {
        <!-- Preview: the real 1080px card, scaled to the column. -->
        <div #previewBox class="mt-6 w-full">
          <div class="relative overflow-hidden rounded-2xl shadow-card" [style.height.px]="previewHeight()">
            <div class="origin-top-left absolute top-0 left-0" [style.transform]="'scale(' + scale() + ')'">
              <app-kit-card #kit [size]="size()" [mode]="mode()" [players]="kitPlayers()" [stats]="stats()" [periodLabel]="periodLabel()" />
            </div>
          </div>
        </div>

        <section class="mt-6 grid gap-5">
          <div>
            <p class="text-sm font-semibold mb-2">{{ i18n.t('shareCard.period') }}</p>
            <div class="flex flex-wrap gap-2">
              @for (k of periodKinds; track k) {
                <button
                  type="button"
                  (click)="pickPeriod(k)"
                  [disabled]="!periodAvailable()[k]"
                  [class]="chipClass(period().kind === k)"
                >{{ i18n.t(periodKey[k]) }}</button>
              }
            </div>
            @if (period().kind === 'vsTeam') {
              <div class="flex flex-wrap gap-2 mt-3">
                @for (t of opponents(); track t.id) {
                  <button type="button" (click)="pickTeam(t.id)" [class]="chipClass(vsTeamId() === t.id)">{{ t.name }}</button>
                }
              </div>
            }
            @if (!currentHasGames()) {
              <p class="text-xs text-muted mt-2">{{ i18n.t('shareCard.noGames') }}</p>
            }
          </div>

          <div>
            <p class="text-sm font-semibold mb-2">{{ i18n.t('shareCard.stats') }} <span class="text-muted font-normal">· {{ i18n.t('shareCard.statsHint') }}</span></p>
            <div class="flex flex-wrap gap-2">
              @for (k of statKeys; track k) {
                <button
                  type="button"
                  (click)="toggleStat(k)"
                  [disabled]="statDisabled(k)"
                  [class]="chipClass(stats().includes(k))"
                >{{ statLabels[k] }}</button>
              }
            </div>
          </div>

          <div>
            <p class="text-sm font-semibold mb-2">{{ i18n.t('shareCard.size') }}</p>
            <div class="flex gap-2">
              <button type="button" (click)="size.set('post')" [class]="chipClass(size() === 'post')">{{ i18n.t('shareCard.post') }} · 4:5</button>
              <button type="button" (click)="size.set('story')" [class]="chipClass(size() === 'story')">{{ i18n.t('shareCard.story') }} · 9:16</button>
            </div>
          </div>

          <div class="grid gap-2">
            <button type="button" appButton class="w-full !h-12" (click)="share()" [disabled]="busy() || !currentHasGames()">
              {{ busy() ? i18n.t('shareCard.creating') : i18n.t('shareCard.share') }}
            </button>
            @if (status() === 'downloaded') {
              <p class="text-xs text-muted text-center">{{ i18n.t('shareCard.downloaded') }}</p>
            }
            @if (status() === 'error') {
              <p class="text-xs text-red-500 text-center font-semibold">
                {{ i18n.t('shareCard.error') }}
                <button type="button" class="underline ml-1" (click)="share()">{{ i18n.t('shareCard.retry') }}</button>
              </p>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class ShareCardPageComponent implements OnInit, AfterViewInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  @ViewChild("kit") kit?: KitCardComponent;
  @ViewChild("previewBox") previewBox?: ElementRef<HTMLDivElement>;

  protected readonly statKeys = STAT_KEYS;
  protected readonly statLabels = STAT_LABELS;
  protected readonly periodKinds: PeriodKind[] = ["season", "last5", "lastGame", "vsTeam"];
  protected readonly periodKey: Record<PeriodKind, string> = {
    season: "shareCard.periodSeason",
    last5: "shareCard.periodLast5",
    lastGame: "shareCard.periodLastGame",
    vsTeam: "shareCard.periodVsTeam",
  };

  protected readonly loaded = signal<Loaded[]>([]);
  protected readonly loadError = signal(false);
  protected readonly period = signal<Period>({ kind: "season" });
  protected readonly stats = signal<StatKey[]>([...DEFAULT_STATS]);
  protected readonly size = signal<"post" | "story">("post");
  protected readonly busy = signal(false);
  protected readonly status = signal<"idle" | "downloaded" | "error">("idle");
  private readonly boxWidth = signal(360);

  protected readonly mode = computed(() => (this.loaded().length > 1 ? "h2h" : "player"));
  protected readonly scale = computed(() => this.boxWidth() / 1080);
  protected readonly previewHeight = computed(() => (this.size() === "story" ? 1920 : 1350) * this.scale());
  protected readonly vsTeamId = computed(() => {
    const p = this.period();
    return p.kind === "vsTeam" ? p.teamId : null;
  });

  // In a head-to-head, only teams both players faced.
  protected readonly opponents = computed(() => {
    const lists = this.loaded().map((l) => opponentsFaced(l.log.rows, l.detail.team.id));
    if (!lists.length) return [];
    return lists[0].filter((t) => lists.every((list) => list.some((o) => o.id === t.id)));
  });

  protected readonly periodAvailable = computed<Record<PeriodKind, boolean>>(() => {
    const hasGames = (period: Period) => this.loaded().every((l) => gamesForPeriod(l.log.rows, period, l.detail.team.id).length > 0);
    return {
      season: hasGames({ kind: "season" }),
      last5: hasGames({ kind: "last5" }),
      lastGame: hasGames({ kind: "lastGame" }),
      vsTeam: this.opponents().length > 0,
    };
  });

  protected readonly currentHasGames = computed(() =>
    this.loaded().length > 0 && this.loaded().every((l) => gamesForPeriod(l.log.rows, this.period(), l.detail.team.id).length > 0)
  );

  protected readonly kitPlayers = computed<KitPlayer[]>(() =>
    this.loaded().map((l) => {
      const games = gamesForPeriod(l.log.rows, this.period(), l.detail.team.id);
      const { first, last } = splitName(l.detail.player.name);
      return {
        first,
        last,
        jersey: l.detail.player.jerseyNumber,
        teamCode: l.detail.team.code,
        primary: l.detail.team.primaryColor || "#1f2937",
        secondary: l.detail.team.secondaryColor || "#ffffff",
        photoUrl: l.detail.player.photoUrl,
        line: computeLine(games, this.period().kind === "lastGame"),
      };
    })
  );

  protected readonly periodLabel = computed(() => {
    const p = this.period();
    const first = this.loaded()[0];
    if (!first) return "";
    const fill = (key: string, values: Record<string, string | number>) =>
      Object.entries(values).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), this.i18n.t(key));
    const h2h = this.mode() === "h2h";
    const games = gamesForPeriod(first.log.rows, p, first.detail.team.id);
    switch (p.kind) {
      case "season":
        return fill("shareCard.labelSeason", { season: first.log.season ?? "" });
      case "last5":
        return games.length < 5 && !h2h ? fill("shareCard.labelLastN", { n: games.length }) : this.i18n.t("shareCard.labelLast5");
      case "lastGame": {
        const g = games[0]?.game;
        if (!g || h2h) return this.i18n.t("shareCard.labelLastGame");
        const opp = g.homeTeam.id === first.detail.team.id ? g.awayTeam : g.homeTeam;
        return fill("shareCard.labelLastGameVs", { team: opp.name });
      }
      case "vsTeam": {
        const team = this.opponents().find((t) => t.id === p.teamId)?.name ?? "";
        return h2h ? fill("shareCard.labelVsTeam", { team }) : fill("shareCard.labelVsTeamGames", { team, n: games.length });
      }
    }
  });

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    const ids = (q.get("player") ? [q.get("player")!] : [q.get("a"), q.get("b")]).filter((id): id is string => !!id);
    if (!ids.length) {
      this.loadError.set(true);
      return;
    }
    forkJoin(ids.map((id) => forkJoin({ detail: this.api.getPlayer(id), log: this.api.getPlayerGames(id) }))).subscribe({
      next: (rows) => {
        this.loaded.set(rows);
        // The preview box only exists once the loaded branch has rendered.
        setTimeout(() => this.observeWidth());
      },
      error: () => this.loadError.set(true),
    });
  }

  ngAfterViewInit(): void {
    this.observeWidth();
  }

  private observer: ResizeObserver | null = null;
  private observeWidth(): void {
    const el = this.previewBox?.nativeElement;
    if (!el || this.observer) return;
    this.observer = new ResizeObserver(([entry]) => this.boxWidth.set(entry.contentRect.width));
    this.observer.observe(el);
    this.boxWidth.set(el.clientWidth);
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  protected pickPeriod(kind: PeriodKind): void {
    if (kind === "vsTeam") {
      const first = this.opponents()[0];
      if (first) this.period.set({ kind: "vsTeam", teamId: first.id });
      return;
    }
    this.period.set({ kind } as Period);
  }

  protected pickTeam(teamId: string): void {
    this.period.set({ kind: "vsTeam", teamId });
  }

  protected statDisabled(key: StatKey): boolean {
    const selected = this.stats().includes(key);
    return selected ? this.stats().length <= 3 : this.stats().length >= 5;
  }

  protected toggleStat(key: StatKey): void {
    if (this.statDisabled(key)) return;
    this.stats.update((list) => (list.includes(key) ? list.filter((k) => k !== key) : STAT_KEYS.filter((k) => list.includes(k) || k === key)));
  }

  protected chipClass(active: boolean): string {
    const base = "h-9 px-3.5 rounded-full text-sm font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
    return active ? `${base} bg-team-primary text-team-secondary border-team-primary` : `${base} bg-card text-ink border-line hover:border-team-primary/50`;
  }

  protected async share(): Promise<void> {
    const el = this.kit?.cardEl.nativeElement;
    if (!el || this.busy()) return;
    this.busy.set(true);
    this.status.set("idle");
    const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const names = this.kitPlayers().map((p) => slug(p.last)).join("-vs-");
    try {
      const result = await exportCard(el, `clutch-${names}-${this.period().kind}.png`);
      if (result === "downloaded") this.status.set("downloaded");
    } catch {
      this.status.set("error");
    } finally {
      this.busy.set(false);
    }
  }
}
