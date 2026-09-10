import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";

@Component({
  selector: "app-forgot-password",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ButtonDirective],
  templateUrl: "./forgot-password.component.html",
})
export class ForgotPasswordComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly submitting = signal(false);
  // The backend always responds 200 with the same generic message
  // regardless of whether the email exists (routes/auth.ts) — that's the
  // security property, not something this page needs to re-derive. A real
  // HTTP error (rate-limited, network down) is a genuinely different case
  // and still shown as one, since surfacing it doesn't leak anything about
  // whether the address has an account.
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const { email } = this.form.getRawValue();
    this.auth.forgotPassword(email).subscribe({
      next: () => {
        this.sent.set(true);
        this.submitting.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("auth.genericError"));
        this.submitting.set(false);
      },
    });
  }
}
