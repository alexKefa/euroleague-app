import { Component, computed, inject } from "@angular/core";
import { Router } from "@angular/router";
import { I18nService } from "../core/i18n.service";
import { PackRewardsService } from "../core/pack-rewards.service";
import { NavIconComponent } from "./nav-icon";
import { packSourceIcon, packSourceText } from "./pack-source";

/**
 * "You earned a pack: 18 correct picks milestone!" (2026-09-30, direct
 * request after a milestone pack went unnoticed). Reward packs were only
 * announced by banners on Predictions/Fantasy, so a toast in the shared
 * stack now announces them on whatever page the user is on. One reward
 * names its reason and opens that exact pack; several collapse into a count.
 */
@Component({
  selector: "app-pack-reward-toast",
  standalone: true,
  imports: [NavIconComponent],
  templateUrl: "./pack-reward-toast.html",
  styleUrl: "./jump-ball-toast.css",
})
export class PackRewardToastComponent {
  protected rewards = inject(PackRewardsService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  // A Fantasy card reward toast shows once the pack toast is out of the way.
  readonly showCards = computed(() => this.rewards.newRewards().length === 0 && this.rewards.newCardRewards().length > 0);

  readonly cardMessage = computed(() => {
    const list = this.rewards.newCardRewards();
    if (list.length === 1) {
      const key = list[0].kind === "coachCard" ? "packs.cardToastCoach" : "packs.cardToastCaptain";
      return this.i18n.t(key).replace("{name}", list[0].name);
    }
    return this.i18n.t("packs.cardToastMany").replace("{n}", String(list.length));
  });

  viewCards(): void {
    this.rewards.dismissCards();
    this.router.navigate(["/inventory"]);
  }

  dismissCards(): void {
    this.rewards.dismissCards();
  }

  readonly message = computed(() => {
    const list = this.rewards.newRewards();
    if (list.length === 1) {
      const reason = packSourceText(this.i18n, list[0].source) ?? this.i18n.t(`packs.label.${list[0].packType}`);
      return this.i18n.t("packs.rewardToastOne").replace("{reason}", reason);
    }
    return this.i18n.t("packs.rewardToastMany").replace("{n}", String(list.length));
  });

  readonly icon = computed(() => {
    const list = this.rewards.newRewards();
    return list.length === 1 ? packSourceIcon(list[0].source) : "packs";
  });

  open(): void {
    const list = this.rewards.newRewards();
    this.rewards.dismiss();
    this.router.navigate(["/packs"], list.length === 1 ? { queryParams: { open: list[0].id } } : {});
  }

  dismiss(): void {
    this.rewards.dismiss();
  }
}
