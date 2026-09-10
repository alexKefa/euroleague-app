import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators, ValidatorFn, AbstractControl } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";

function passwordsMatchValidator(): ValidatorFn {
  return (group: AbstractControl) => {
    const password = group.get("password")?.value;
    const confirmPassword = group.get("confirmPassword")?.value;
    return password === confirmPassword ? null : { passwordsMismatch: true };
  };
}

@Component({
  selector: "app-reset-password",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ButtonDirective],
  templateUrl: "./reset-password.component.html",
})
export class ResetPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal(false);
  // Null only if the link itself is malformed (no ?token= at all) — an
  // expired/already-used token still reaches the server and comes back as
  // a normal error() from the API instead.
  readonly token = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      password: ["", [Validators.required, Validators.minLength(8)]],
      confirmPassword: ["", [Validators.required]],
    },
    { validators: passwordsMatchValidator() }
  );

  ngOnInit(): void {
    this.token.set(this.route.snapshot.queryParamMap.get("token"));
  }

  submit(): void {
    const token = this.token();
    if (this.form.invalid || !token) return;
    this.submitting.set(true);
    this.error.set(null);

    const { password } = this.form.getRawValue();
    this.auth.resetPassword(token, password).subscribe({
      next: () => {
        this.success.set(true);
        this.submitting.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? this.i18n.t("auth.resetLinkInvalid"));
        this.submitting.set(false);
      },
    });
  }

  goToLogin(): void {
    this.router.navigateByUrl("/login");
  }
}
