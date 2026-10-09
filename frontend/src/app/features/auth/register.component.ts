import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { OpenInBrowserBannerComponent } from "../../shared/open-in-browser-banner";
import { TeamPickDialogComponent } from "../../shared/team-pick-dialog";
import { peekPendingPromoClaim, consumePendingPromoClaim } from "../../shared/pending-promo-claim";
import { clearPendingReferral, peekPendingReferral, stashPendingReferral } from "../../shared/pending-referral";
import { GoogleSignInButtonComponent, type GoogleSignInResult } from "../../shared/google-sign-in-button";
import { pendingLeagueJoinUrl } from "../../shared/pending-league-join";

@Component({
  selector: "app-register",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ButtonDirective, OpenInBrowserBannerComponent, TeamPickDialogComponent, GoogleSignInButtonComponent],
  templateUrl: "./register.component.html",
})
export class RegisterComponent implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);

  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly error = signal<string | null>(null);

  // Team picking moved out of this form entirely (2026-09-15, "Direction C"
  // from that day's design-canvas comparison) — TeamPickDialogComponent
  // shows once, right after a successful registration, instead of a chip
  // grid competing with the actual account fields for space on mobile.
  readonly showTeamDialog = signal(false);

  // From a shared referral link (?ref=CODE, see profile.html) — validity is
  // checked server-side at submit time; an unrecognized code is silently
  // ignored there rather than blocking registration over it, so there's no
  // need to validate it here just to show this note.
  readonly referralCode = signal<string | null>(null);

  // From a promo link (?promo=CODE, e.g. a YouTube video description —
  // see scripts/create-promo-code.ts). Same "validity checked server-side,
  // silently ignored if bad" shape as referralCode above.
  readonly promoCode = signal<string | null>(null);
  readonly promoApplied = signal(false);

  // Optional — left blank, the backend generates a "clutch-user-######"
  // handle same as before this field existed. Pattern mirrors the backend's
  // isValidUsername (services/username.ts) so a bad value is caught before
  // the round trip.
  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(8)]],
    username: ["", [Validators.pattern(/^[a-zA-Z0-9_]{3,20}$/)]],
  });

  ngOnInit(): void {
    const ref = this.route.snapshot.queryParamMap.get("ref");
    if (ref) stashPendingReferral(ref);
    this.referralCode.set(ref ?? peekPendingReferral());
    // A promo QR link (features/claim/claim.ts) may have sent the visitor
    // here via /welcome instead of straight to /register?promo=CODE — fall
    // back to the code it stashed so it still applies either way.
    this.promoCode.set(this.route.snapshot.queryParamMap.get("promo") ?? peekPendingPromoClaim());
  }

  // A new account (email/password or Google): team pick, after a pause on
  // the "promo applied" note if a promo came with the signup.
  private afterSignUp(promo: GoogleSignInResult["promo"]): void {
    // Registration itself already redeemed this.promoCode() directly
    // (routes/auth.ts) — clear the stash so a later /claim visit
    // doesn't try the same code again.
    consumePendingPromoClaim();
    clearPendingReferral();
    if (!promo) {
      this.showTeamDialog.set(true);
      return;
    }
    // Brief pause on the "promo applied" note before the team dialog
    // takes over — otherwise it'd never be visible, immediately
    // covered by the dialog's own backdrop.
    this.promoApplied.set(true);
    setTimeout(() => this.showTeamDialog.set(true), 1400);
  }

  // Google on the Register page: a new account goes through the same team
  // pick; an existing one (that email already had an account) just signs in.
  onGoogleSignUp(res: GoogleSignInResult): void {
    if (res.created) {
      this.afterSignUp(res.promo);
      return;
    }
    const pendingPromo = consumePendingPromoClaim();
    this.router.navigateByUrl(pendingPromo ? `/claim?promo=${encodeURIComponent(pendingPromo)}` : "/");
  }

  submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const { email, password, username } = this.form.getRawValue();
    this.auth
      .register(email, password, null, this.referralCode(), this.promoCode(), username.trim() || null)
      .subscribe({
        next: ({ promo }) => this.afterSignUp(promo),
        error: (err) => {
          const code = err?.error?.code;
          this.error.set(
            code === "USERNAME_TAKEN"
              ? this.i18n.t("auth.usernameTaken")
              : code === "INVALID_USERNAME"
                ? this.i18n.t("auth.usernameInvalid")
                : err?.status === 409
                  ? this.i18n.t("auth.emailExists")
                  : this.i18n.t("auth.genericError")
          );
          this.submitting.set(false);
        },
      });
  }

  // Straight to Predictions (2026-10-05): 44% of signups never made a pick
  // when they landed on Home. The first-picks card there offers a free pack.
  onTeamDialogClosed(): void {
    this.router.navigateByUrl(pendingLeagueJoinUrl() ?? "/predictions");
  }
}
