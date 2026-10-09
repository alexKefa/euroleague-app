import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { consumePendingPromoClaim, peekPendingPromoClaim } from "../../shared/pending-promo-claim";
import { clearPendingReferral, peekPendingReferral } from "../../shared/pending-referral";
import { TeamPickDialogComponent } from "../../shared/team-pick-dialog";
import { pendingLeagueJoinUrl } from "../../shared/pending-league-join";
import { GoogleSignInButtonComponent, type GoogleSignInResult } from "../../shared/google-sign-in-button";

@Component({
  selector: "app-login",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ButtonDirective, GoogleSignInButtonComponent, TeamPickDialogComponent],
  templateUrl: "./login.component.html",
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  protected i18n = inject(I18nService);

  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly error = signal<string | null>(null);
  // Stashed codes from an earlier referral/promo link, so a brand-new
  // Google account made from this page still gets them (same as Register).
  readonly pendingReferral = peekPendingReferral();
  readonly pendingPromo = peekPendingPromoClaim();
  readonly showTeamDialog = signal(false);

  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required]],
  });

  // Google on the Login page (2026-10-09, "on google login we should select
  // team etc etc. like normal flow"): a new account takes the same path as
  // Register (team pick, then Predictions); an existing one just signs in.
  onGoogleSignIn(res: GoogleSignInResult): void {
    if (!res.created) {
      this.afterSignIn();
      return;
    }
    // Sign-up already redeemed the stashed codes server-side.
    consumePendingPromoClaim();
    clearPendingReferral();
    this.showTeamDialog.set(true);
  }

  // Same destination as Register after the team pick.
  onTeamDialogClosed(): void {
    this.router.navigateByUrl(pendingLeagueJoinUrl() ?? "/predictions");
  }

  // After email/password or Google sign-in.
  afterSignIn(): void {
    // A promo QR link (features/claim/claim.ts) stashed a code before
    // sending a logged-out visitor here via /welcome — pick it back up
    // now that they're actually signed in, instead of just landing on
    // the dashboard with the code forgotten.
    const pendingPromo = consumePendingPromoClaim();
    this.router.navigateByUrl(pendingPromo ? `/claim?promo=${encodeURIComponent(pendingPromo)}` : (pendingLeagueJoinUrl() ?? "/"));
  }

  submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => this.afterSignIn(),
      error: () => {
        this.error.set(this.i18n.t("auth.invalidCredentials"));
        this.submitting.set(false);
      },
    });
  }
}