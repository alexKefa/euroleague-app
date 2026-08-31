import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { League } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { PageHintComponent } from "../../shared/page-hint";
import { SkeletonComponent } from "../../shared/skeleton";

@Component({
  selector: "app-leagues",
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, ButtonDirective, PageHintComponent, SkeletonComponent],
  templateUrl: "./leagues.html",
})
export class LeaguesComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly myLeagues = signal<League[]>([]);

  readonly createForm = this.fb.nonNullable.group({ name: ["", [Validators.required, Validators.maxLength(40)]] });
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);

  readonly joinForm = this.fb.nonNullable.group({ code: ["", [Validators.required]] });
  readonly joining = signal(false);
  readonly joinError = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

    this.refresh();
  }

  private refresh(): void {
    this.api.getMyLeagues().subscribe({
      next: (rows) => {
        this.myLeagues.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Backend returns a stable `code` alongside its English `error` text
  // (routes/leagues.ts), same pattern as trades.ts's tradeErrorMessage.
  private errorMessage(err: unknown, fallbackKey: string): string {
    const body = (err as { error?: { code?: string; error?: string } } | undefined)?.error;
    const key = body?.code ? `leagues.err.${body.code}` : undefined;
    const translated = key ? this.i18n.t(key) : undefined;
    if (translated && translated !== key) return translated;
    return body?.error ?? this.i18n.t(fallbackKey);
  }

  create(): void {
    if (this.createForm.invalid || this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);

    this.api.createLeague(this.createForm.getRawValue().name.trim()).subscribe({
      next: () => {
        this.creating.set(false);
        this.createForm.reset({ name: "" });
        this.refresh();
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(this.errorMessage(err, "leagues.createFailed"));
      },
    });
  }

  join(): void {
    if (this.joinForm.invalid || this.joining()) return;
    this.joining.set(true);
    this.joinError.set(null);

    this.api.joinLeague(this.joinForm.getRawValue().code.trim()).subscribe({
      next: () => {
        this.joining.set(false);
        this.joinForm.reset({ code: "" });
        this.refresh();
      },
      error: (err) => {
        this.joining.set(false);
        this.joinError.set(this.errorMessage(err, "leagues.joinFailed"));
      },
    });
  }

  memberCountLabel(league: League): string {
    return league.memberCount === 1
      ? this.i18n.t("leagues.memberCountSingular")
      : this.i18n.t("leagues.memberCountPlural");
  }
}
