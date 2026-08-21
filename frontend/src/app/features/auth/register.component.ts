import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { Team } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ButtonDirective } from "../../shared/button.directive";

@Component({
  selector: "app-register",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, RetryImgDirective, ButtonDirective],
  templateUrl: "./register.component.html",
})
export class RegisterComponent implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly teams = signal<Team[]>([]);
  readonly favoriteTeamId = signal<string | null>(null);

  // From a shared referral link (?ref=CODE, see profile.html) — validity is
  // checked server-side at submit time; an unrecognized code is silently
  // ignored there rather than blocking registration over it, so there's no
  // need to validate it here just to show this note.
  readonly referralCode = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(8)]],
  });

  ngOnInit(): void {
    this.api.getTeams().subscribe({ next: (rows) => this.teams.set(rows), error: () => {} });
    this.referralCode.set(this.route.snapshot.queryParamMap.get("ref"));
  }

  pickTeam(teamId: string): void {
    this.favoriteTeamId.set(this.favoriteTeamId() === teamId ? null : teamId);
  }

  submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();
    this.auth.register(email, password, this.favoriteTeamId(), this.referralCode()).subscribe({
      next: () => this.router.navigateByUrl("/"),
      error: (err) => {
        this.error.set(
          err?.status === 409 ? this.i18n.t("auth.emailExists") : this.i18n.t("auth.genericError")
        );
        this.submitting.set(false);
      },
    });
  }
}
