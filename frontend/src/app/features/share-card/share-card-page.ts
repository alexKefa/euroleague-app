import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { forkJoin } from "rxjs";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { PlayerDetail, PlayerGameLog } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHeaderComponent } from "../../shared/page-header";
import { SkeletonComponent } from "../../shared/skeleton";
import { KitCardOptions, KitPlayer, cardHeight, drawKitCard } from "./kit-canvas";
import { renderCard, shareFile } from "./share-export";
import {
  DEFAULT_STATS,
  Period,
  STAT_KEYS,
  STAT_LABELS,
  StatKey,
  computeLine,
  gamesForPeriod,
  opponentInGame,
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
  imports: [RouterLink, ButtonDirective, PageHeaderComponent, SkeletonComponent],
  template: `
    <div class="max-w-xl mx-auto p-4 sm:p-6">
      <a [routerLink]="navHistory.previousUrl() ?? '/stats'" class="back-link">{{ i18n.t('nav.back') }}</a>
      <app-page-header [title]="i18n.t('shareCard.title')" [subtitle]="i18n.t('shareCard.subtitle')" icon="share" class="mt-4" />

      @if (loadError()) {
        <p class="mt-6 text-sm text-red-500 font-semibold">{{ i18n.t('shareCard.loadError') }}</p>
      } @else if (!loaded().length) {
        <app-skeleton class="block mt-6 rounded-2xl" [style.aspect-ratio]="'4 / 5'" />
      } @else {
        <!-- Preview: the same canvas drawing that becomes the shared image, shown at column width. -->
        <canvas
          #preview
          class="mt-6 block w-full h-auto rounded-2xl shadow-card"
          [attr.width]="1080"
          [attr.height]="previewHeight()"
          [attr.aria-label]="i18n.t('shareCard.title')"
          role="img"
        ></canvas>

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
              <button type="button" (click)="setSize('post')" [class]="chipClass(size() === 'post')">{{ i18n.t('shareCard.post') }} · 4:5</button>
              <button type="button" (click)="setSize('story')" [class]="chipClass(size() === 'story')">{{ i18n.t('shareCard.story') }} · 9:16</button>
            </div>
          </div>

          <div class="grid gap-2">
            <button type="button" appButton class="w-full !h-12" (click)="share()" [disabled]="busy() || !currentHasGames()">
              {{ busy() ? i18n.t('shareCard.creating') : i18n.t('shareCard.share') }}
            </button>
            @if (status() === 'needsTap') {
              <!-- Phones only allow sharing right after a tap; rendering can outlast that, so the ready image gets its own tap. -->
              <button type="button" appButton="outline" class="w-full !h-12" (click)="shareNow()">{{ i18n.t('shareCard.tapToShare') }}</button>
            }
            @if (status() === 'downloaded') {
              <p class="text-xs text-muted text-center">{{ i18n.t('shareCard.downloaded') }}</p>
            }
            @if (status() === 'error') {
              <p class="text-xs text-red-500 text-center font-semibold">
                {{ i18n.t('shareCard.error') }}
                <button type="button" class="underline ml-1 disabled:opacity-40" [disabled]="!currentHasGames()" (click)="share()">{{ i18n.t('shareCard.retry') }}</button>
              </p>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class ShareCardPageComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  private readonly preview = viewChild<ElementRef<HTMLCanvasElement>>("preview");

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
  protected readonly status = signal<"idle" | "downloaded" | "error" | "needsTap">("idle");
  // The last rendered image, kept when the browser refused share() so a second tap can share it.
  private readonly pendingFile = signal<File | null>(null);

  protected readonly mode = computed(() => (this.loaded().length > 1 ? "h2h" : "player"));
  protected readonly previewHeight = computed(() => cardHeight(this.size()));
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
      case "last5": {
        // In a head-to-head the label follows whoever has fewer games.
        const n = Math.min(...this.loaded().map((l) => gamesForPeriod(l.log.rows, p, l.detail.team.id).length));
        return n < 5 ? fill("shareCard.labelLastN", { n }) : this.i18n.t("shareCard.labelLast5");
      }
      case "lastGame": {
        const row = games[0];
        if (!row || h2h) return this.i18n.t("shareCard.labelLastGame");
        return fill("shareCard.labelLastGameVs", { team: opponentInGame(first.log.rows, row, first.detail.team.id).name });
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
        // A head-to-head compares the same season: if B's latest season
        // differs from A's, reload B's games for A's season.
        const [a, b] = rows;
        if (b && a.log.season && b.log.season !== a.log.season) {
          this.api.getPlayerGames(b.detail.player.id, a.log.season).subscribe({
            next: (log) => this.loaded.set([a, { ...b, log }]),
            error: () => this.loadError.set(true),
          });
          return;
        }
        this.loaded.set(rows);
      },
      error: () => this.loadError.set(true),
    });
  }

  // Everything the card drawing needs; the preview and the export both use it.
  protected readonly cardOptions = computed<KitCardOptions | null>(() =>
    this.loaded().length
      ? { size: this.size(), mode: this.mode(), players: this.kitPlayers(), stats: this.stats(), periodLabel: this.periodLabel() }
      : null
  );

  constructor() {
    // Redraw the preview whenever the card changes. Drawing is async (fonts,
    // photo); a newer draw supersedes an older one still in flight.
    let drawId = 0;
    effect(() => {
      const canvas = this.preview()?.nativeElement;
      const options = this.cardOptions();
      if (!canvas || !options) return;
      const id = ++drawId;
      const target = document.createElement("canvas");
      drawKitCard(target, options).then(() => {
        if (id !== drawId) return;
        canvas.width = target.width;
        canvas.height = target.height;
        canvas.getContext("2d")?.drawImage(target, 0, 0);
      });
    });
  }

  protected setSize(size: "post" | "story"): void {
    this.size.set(size);
    this.resetShare();
  }

  private resetShare(): void {
    this.pendingFile.set(null);
    this.status.set("idle");
  }

  protected pickPeriod(kind: PeriodKind): void {
    this.resetShare();
    if (kind === "vsTeam") {
      const first = this.opponents()[0];
      if (first) this.period.set({ kind: "vsTeam", teamId: first.id });
      return;
    }
    this.period.set({ kind } as Period);
  }

  protected pickTeam(teamId: string): void {
    this.resetShare();
    this.period.set({ kind: "vsTeam", teamId });
  }

  protected statDisabled(key: StatKey): boolean {
    const selected = this.stats().includes(key);
    return selected ? this.stats().length <= 3 : this.stats().length >= 5;
  }

  protected toggleStat(key: StatKey): void {
    if (this.statDisabled(key)) return;
    this.resetShare();
    this.stats.update((list) => (list.includes(key) ? list.filter((k) => k !== key) : STAT_KEYS.filter((k) => list.includes(k) || k === key)));
  }

  protected chipClass(active: boolean): string {
    const base = "h-9 px-3.5 rounded-full text-sm font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
    return active ? `${base} bg-team-primary text-team-secondary border-team-primary` : `${base} bg-card text-ink border-line hover:border-team-primary/50`;
  }

  protected async shareNow(): Promise<void> {
    const file = this.pendingFile();
    if (!file) return;
    try {
      const result = await shareFile(file);
      if (result === "shared" || result === "cancelled") this.resetShare();
      else if (result === "downloaded") this.status.set("downloaded");
    } catch {
      this.status.set("error");
    }
  }

  protected async share(): Promise<void> {
    const options = this.cardOptions();
    if (!options || this.busy()) return;
    this.busy.set(true);
    this.status.set("idle");
    const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const names = this.kitPlayers().map((p) => slug(p.last)).join("-vs-");
    try {
      const file = await renderCard(options, `clutch-${names}-${this.period().kind}.png`);
      const result = await shareFile(file);
      if (result === "needsTap") this.pendingFile.set(file);
      if (result === "downloaded" || result === "needsTap") this.status.set(result);
    } catch {
      this.status.set("error");
    } finally {
      this.busy.set(false);
    }
  }
}
