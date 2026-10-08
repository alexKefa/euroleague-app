import { Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { OwnedPack } from "../../core/models";
import { PackRewardsService } from "../../core/pack-rewards.service";
import { ButtonDirective } from "../../shared/button.directive";
import { CountUpComponent } from "../../shared/count-up";
import { PackArtComponent } from "../../shared/pack-art";

/**
 * "Packs to open" (2026-10-08): only while the user has unopened packs. The
 * count is PackRewardsService's (already loaded app-wide for the Cards nav
 * dot); the art and "Includes a Coach Pack" line need GET /packs/owned,
 * fetched only when that count is above 0, so users without packs pay no
 * extra request.
 */
@Component({
  selector: "app-packs-waiting",
  standalone: true,
  imports: [RouterLink, ButtonDirective, CountUpComponent, PackArtComponent],
  template: `
    @if (auth.isAuthenticated() && count() > 0) {
      <section class="bg-card rounded-3xl border border-line shadow-card p-4 mb-4 flex items-center gap-4">
        <div class="relative shrink-0 w-[76px] h-[92px]" aria-hidden="true">
          @for (p of fan(); track p.id; let i = $index) {
            <app-pack-art
              class="absolute top-0 w-[52px]"
              [type]="p.packType"
              [style.left.px]="i * 12"
              [style.transform]="'rotate(' + (i - (fan().length - 1) / 2) * 7 + 'deg)'"
              [style.z-index]="i"
            />
          }
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-display text-xl leading-tight">
            <app-count-up [value]="count()" [fromZero]="false" [pop]="true" />
            {{ i18n.t(count() === 1 ? "dashboard.packsWaiting.one" : "dashboard.packsWaiting.many") }}
          </p>
          @if (highlightKey(); as key) {
            <p class="text-sm font-semibold text-team-primary mt-0.5">{{ i18n.t(key) }}</p>
          }
        </div>
        <a routerLink="/packs" appButton appButtonSize="sm" class="shrink-0">{{ i18n.t("dashboard.packsWaiting.open") }}</a>
      </section>
    }
  `,
})
export class PacksWaitingComponent {
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private api = inject(ApiService);
  private packRewards = inject(PackRewardsService);

  readonly count = this.packRewards.unopenedCount;
  private readonly packs = signal<OwnedPack[]>([]);
  private fetchedForCount = -1;

  // Up to 3 packs, special ones (coach / legendary) first so they're on top.
  protected readonly fan = computed(() => {
    const rank = (p: OwnedPack) => (p.packType === "wheelCoach" ? 0 : this.isLegendary(p) ? 1 : 2);
    return [...this.packs()].sort((a, b) => rank(a) - rank(b)).slice(0, 3).reverse();
  });

  protected readonly highlightKey = computed(() => {
    const packs = this.packs();
    if (packs.some((p) => p.packType === "wheelCoach")) return "dashboard.packsWaiting.coach";
    if (packs.some((p) => this.isLegendary(p))) return "dashboard.packsWaiting.legendary";
    return null;
  });

  constructor() {
    // Refetch only when the count changes to a new non-zero value.
    effect(() => {
      const n = this.count();
      if (n <= 0 || !this.auth.isAuthenticated()) {
        untracked(() => this.packs.set([]));
        return;
      }
      if (n === this.fetchedForCount) return;
      this.fetchedForCount = n;
      untracked(() =>
        this.api.getOwnedPacks().subscribe({
          next: (rows) => this.packs.set(rows),
          error: () => {}, // the count alone still renders
        }),
      );
    });
  }

  private isLegendary(p: OwnedPack): boolean {
    return p.packType === "wheelLegendary" || p.packType === "elite";
  }
}
