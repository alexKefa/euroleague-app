import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { consumePendingPromoClaim } from "../../shared/pending-promo-claim";

@Component({
  selector: "app-login",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ButtonDirective],
  templateUrl: "./login.component.html",
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  protected i18n = inject(I18nService);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => {
        // A promo QR link (features/claim/claim.ts) stashed a code before
        // sending a logged-out visitor here via /welcome — pick it back up
        // now that they're actually signed in, instead of just landing on
        // the dashboard with the code forgotten.
        const pendingPromo = consumePendingPromoClaim();
        this.router.navigateByUrl(pendingPromo ? `/claim?promo=${encodeURIComponent(pendingPromo)}` : "/");
      },
      error: () => {
        this.error.set(this.i18n.t("auth.invalidCredentials"));
        this.submitting.set(false);
      },
    });
  }
}