import { Component, inject, signal } from "@angular/core";
import { FormControl, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { ButtonDirective } from "../../shared/button.directive";
import { NavIconComponent } from "../../shared/nav-icon";
import { PageHeaderComponent } from "../../shared/page-header";
import { CODE_LENGTH, isValidCourtCode, normalizeCourtCode } from "../../../../../shared/court/protocol";

/** /court: practice, open your own shared court, or join one by code. */
@Component({
  selector: "app-court-hub",
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, ButtonDirective, NavIconComponent, PageHeaderComponent],
  template: `
    <div class="max-w-3xl mx-auto p-4 sm:p-6">
      <app-page-header [title]="i18n.t('court.hub.title')" [subtitle]="i18n.t('court.hub.subtitle')" icon="ball" />

      <div class="grid gap-4 sm:grid-cols-2">
        <!-- Your court -->
        <section class="relative overflow-hidden rounded-3xl p-5 bg-team-primary text-team-secondary shadow-card sm:col-span-2">
          <app-nav-icon name="ball" [size]="120" class="absolute -right-6 -bottom-8 opacity-15 pointer-events-none" />
          <h2 class="relative font-display text-2xl">{{ i18n.t("court.hub.myCourt") }}</h2>
          <p class="relative mt-1 text-sm opacity-90">{{ i18n.t("court.hub.myCourtBody") }}</p>
          @if (auth.isAuthenticated()) {
            <button
              type="button"
              class="relative mt-4 rounded-full bg-team-secondary px-5 py-2.5 font-bold text-team-primary disabled:opacity-60"
              [disabled]="creating()"
              (click)="openMyCourt()"
            >
              {{ creating() ? i18n.t("court.loading") : i18n.t("court.hub.open") }}
            </button>
            @if (createError()) {
              <p class="relative mt-2 text-sm">{{ i18n.t("court.err.network") }}</p>
            }
          } @else {
            <a routerLink="/login" class="relative mt-4 inline-block rounded-full bg-team-secondary px-5 py-2.5 font-bold text-team-primary">
              {{ i18n.t("court.hub.loginToPlay") }}
            </a>
          }
        </section>

        <!-- Join by code -->
        <section class="rounded-3xl border border-line bg-card p-5 shadow-card">
          <h2 class="font-display text-xl">{{ i18n.t("court.hub.join") }}</h2>
          <p class="mt-1 text-sm text-muted">{{ i18n.t("court.hub.joinBody") }}</p>
          <form class="mt-4 flex gap-2" (submit)="$event.preventDefault(); join()">
            <input
              [formControl]="codeInput"
              class="min-w-0 flex-1 rounded-full border border-line bg-page px-4 py-2 font-display text-lg uppercase tracking-[0.25em] outline-none focus:border-team-primary"
              [attr.maxlength]="codeLength + 2"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              [placeholder]="i18n.t('court.hub.codePlaceholder')"
              [attr.aria-label]="i18n.t('court.hub.join')"
            />
            <button type="submit" appButton appButtonSize="sm" [disabled]="joining()">{{ i18n.t("court.hub.go") }}</button>
          </form>
          @if (joinError(); as key) {
            <p class="mt-2 text-sm text-muted">{{ i18n.t(key) }}</p>
          }
        </section>

        <!-- Practice -->
        <a routerLink="/court/practice" class="group rounded-3xl border border-line bg-card p-5 shadow-card transition hover:border-team-primary">
          <h2 class="font-display text-xl">{{ i18n.t("court.hub.practice") }}</h2>
          <p class="mt-1 text-sm text-muted">{{ i18n.t("court.hub.practiceBody") }}</p>
          <span class="mt-4 inline-block font-bold text-team-primary">{{ i18n.t("court.hub.practiceGo") }} →</span>
        </a>
      </div>
    </div>
  `,
})
export class CourtHubComponent {
  protected i18n = inject(I18nService);
  protected auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);

  protected readonly codeLength = CODE_LENGTH;
  protected readonly codeInput = new FormControl("", { nonNullable: true, validators: [Validators.required] });
  protected readonly creating = signal(false);
  protected readonly createError = signal(false);
  protected readonly joining = signal(false);
  protected readonly joinError = signal<string | null>(null);

  protected async openMyCourt(): Promise<void> {
    this.creating.set(true);
    this.createError.set(false);
    try {
      const { code } = await firstValueFrom(this.api.createCourt());
      await this.router.navigateByUrl(`/court/${code}`);
    } catch {
      this.createError.set(true);
    } finally {
      this.creating.set(false);
    }
  }

  protected async join(): Promise<void> {
    const code = normalizeCourtCode(this.codeInput.value);
    if (!isValidCourtCode(code)) {
      this.joinError.set("court.err.badCode");
      return;
    }
    this.joining.set(true);
    this.joinError.set(null);
    try {
      const info = await firstValueFrom(this.api.getCourt(code));
      if (!info.exists) this.joinError.set("court.err.notFound");
      else if (!info.active) this.joinError.set("court.err.closed");
      else await this.router.navigateByUrl(`/court/${code}`);
    } catch {
      this.joinError.set("court.err.network");
    } finally {
      this.joining.set(false);
    }
  }
}
