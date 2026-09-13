import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { stashPendingPromoClaim, consumePendingPromoClaim } from "../../shared/pending-promo-claim";

type ClaimState = "loading" | "granted" | "already_claimed" | "invalid" | "error" | "no_code";

/**
 * The public landing spot for a promo QR code (services/promoCodes.ts) —
 * e.g. a flyer at a live event, distinct from the marketing /welcome flyer
 * QR. Reads ?promo=CODE:
 *  - logged out: stashes the code (pendingPromoClaim) and bounces to
 *    /welcome, same public pitch page cold traffic already lands on —
 *    login.component.ts/register.component.ts pick the stash back up once
 *    the visitor actually signs in.
 *  - logged in: redeems immediately via POST /api/promo-codes/redeem.
 *
 * The granted pack sits unopened in "My Packs" (/inventory -> Cards hub)
 * exactly like a wheel win or a round reward — this page never rolls a
 * card itself.
 */
@Component({
  selector: "app-claim",
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonDirective, LogoSpinnerComponent],
  templateUrl: "./claim.html",
})
export class ClaimComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly state = signal<ClaimState>("loading");
  readonly grantedPackLabel = signal<string | null>(null);

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get("promo");
    if (!code) {
      this.state.set("no_code");
      return;
    }

    if (!this.auth.currentUser()) {
      stashPendingPromoClaim(code);
      this.router.navigateByUrl("/welcome");
      return;
    }

    this.redeem(code);
  }

  private redeem(code: string): void {
    this.state.set("loading");
    this.api.redeemPromoCode(code).subscribe({
      next: (res) => {
        consumePendingPromoClaim();
        if (res.status === "granted") {
          this.grantedPackLabel.set(this.i18n.t(`packs.label.${res.packType}`));
        }
        this.state.set(res.status);
      },
      error: () => this.state.set("error"),
    });
  }
}
