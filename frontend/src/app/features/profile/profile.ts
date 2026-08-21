import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { AuthService } from "../../core/auth.service";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { Team, Collectible } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";

@Component({
  selector: "app-profile",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RetryImgDirective, ButtonDirective, ChipDirective, DropdownComponent],
  templateUrl: "./profile.html",
})
export class ProfileComponent implements OnInit {
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private api = inject(ApiService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  readonly teams = signal<Team[]>([]);
  readonly savingTeamId = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  readonly referralLink = computed(() => {
    const code = this.auth.currentUser()?.referralCode;
    return code ? `${location.origin}/register?ref=${code}` : null;
  });
  readonly referralCopied = signal(false);

  // Admin-only tools — collectibles list is only fetched for the grant-a-
  // card form's dropdown, so there's no point loading it for non-admins.
  readonly collectibles = signal<Collectible[]>([]);
  readonly collectibleDropdownOptions = computed<DropdownOption[]>(() =>
    this.collectibles().map((c) => ({ value: c.id, label: `${c.name} — ${c.team.code} (${c.tier})` }))
  );
  readonly teamDropdownOptions = computed<DropdownOption[]>(() =>
    this.teams().map((t) => ({ value: t.id, label: t.code, logoUrl: t.logoUrl }))
  );
  readonly tierDropdownOptions = computed<DropdownOption[]>(() => [
    { value: "common", label: this.i18n.t("store.tierCommon") },
    { value: "rare", label: this.i18n.t("store.tierRare") },
    { value: "legendary", label: this.i18n.t("store.tierLegendary") },
  ]);

  readonly pointsSubmitting = signal(false);
  readonly pointsError = signal<string | null>(null);
  readonly pointsSuccess = signal<string | null>(null);
  readonly pointsForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    points: [10, [Validators.required]],
    reason: ["", [Validators.required]],
  });

  readonly cardSubmitting = signal(false);
  readonly cardError = signal<string | null>(null);
  readonly cardSuccess = signal<string | null>(null);
  readonly cardForm = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    collectibleId: ["", [Validators.required]],
  });

  readonly addSubmitting = signal(false);
  readonly addError = signal<string | null>(null);
  readonly addForm = this.fb.nonNullable.group({
    name: ["", [Validators.required]],
    teamId: ["", [Validators.required]],
    tier: ["common", [Validators.required]],
    pointsCost: [50, [Validators.required, Validators.min(1)]],
    imageUrl: [""],
  });

  ngOnInit(): void {
    this.api.getTeams().subscribe({ next: (rows) => this.teams.set(rows), error: () => {} });

    if (this.auth.currentUser()?.isAdmin) {
      this.refreshCollectibles();
    }
  }

  private refreshCollectibles(): void {
    this.api.getCollectibles().subscribe({ next: (rows) => this.collectibles.set(rows), error: () => {} });
  }

  setFavoriteTeam(teamId: string): void {
    if (this.savingTeamId()) return;
    const current = this.auth.currentUser()?.favoriteTeamId;
    const next = current === teamId ? null : teamId;

    this.savingTeamId.set(teamId);
    this.saveError.set(null);

    this.auth.updateFavoriteTeam(next).subscribe({
      next: () => this.savingTeamId.set(null),
      error: () => {
        this.savingTeamId.set(null);
        this.saveError.set(this.i18n.t("profile.saveTeamFailed"));
      },
    });
  }

  logout(): void {
    this.auth.logout().subscribe({ next: () => this.router.navigateByUrl("/") });
  }

  copyReferralLink(): void {
    const link = this.referralLink();
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      this.referralCopied.set(true);
      setTimeout(() => this.referralCopied.set(false), 2000);
    });
  }

  // Backend responses carry a stable `code` alongside their English
  // `error` text (see trades.ts's tradeErrorMessage() for the original
  // pattern this mirrors) so the frontend can translate without the
  // server needing to know about languages at all.
  private adminErrorMessage(err: unknown, fallbackKey: string): string {
    const body = (err as { error?: { code?: string; error?: string } } | undefined)?.error;
    const key = body?.code ? `profile.adminErr.${body.code}` : undefined;
    const translated = key ? this.i18n.t(key) : undefined;
    if (translated && translated !== key) return translated;
    return body?.error ?? this.i18n.t(fallbackKey);
  }

  submitPointsGrant(): void {
    if (this.pointsForm.invalid || this.pointsForm.value.points === 0) return;
    this.pointsSubmitting.set(true);
    this.pointsError.set(null);
    this.pointsSuccess.set(null);

    const { email, points, reason } = this.pointsForm.getRawValue();
    this.api.adjustPoints(email, Number(points), reason).subscribe({
      next: () => {
        this.pointsSubmitting.set(false);
        this.pointsSuccess.set(
          `${this.i18n.t("profile.grantedPrefix")} ${points} ${this.i18n.t("profile.grantedPointsTo")} ${email}.`
        );
        this.pointsForm.patchValue({ email: "", reason: "" });
      },
      error: (err) => {
        this.pointsSubmitting.set(false);
        this.pointsError.set(this.adminErrorMessage(err, "profile.grantPointsFailed"));
      },
    });
  }

  submitCardGrant(): void {
    if (this.cardForm.invalid) return;
    this.cardSubmitting.set(true);
    this.cardError.set(null);
    this.cardSuccess.set(null);

    const { email, collectibleId } = this.cardForm.getRawValue();
    const card = this.collectibles().find((c) => c.id === collectibleId);
    this.api.grantCard(email, collectibleId).subscribe({
      next: () => {
        this.cardSubmitting.set(false);
        this.cardSuccess.set(
          `${this.i18n.t("profile.grantedPrefix")} ${card?.name ?? ""} ${this.i18n.t("profile.grantedCardTo")} ${email}.`
        );
        this.cardForm.patchValue({ email: "" });
      },
      error: (err) => {
        this.cardSubmitting.set(false);
        this.cardError.set(this.adminErrorMessage(err, "profile.grantCardFailed"));
      },
    });
  }

  submitAddCollectible(): void {
    if (this.addForm.invalid) return;
    this.addSubmitting.set(true);
    this.addError.set(null);

    const { name, teamId, tier, pointsCost, imageUrl } = this.addForm.getRawValue();
    this.api.addCollectible(name, teamId, tier, Number(pointsCost), imageUrl || undefined).subscribe({
      next: () => {
        this.addSubmitting.set(false);
        this.addForm.patchValue({ name: "", imageUrl: "" });
        this.refreshCollectibles();
      },
      error: (err) => {
        this.addSubmitting.set(false);
        this.addError.set(this.adminErrorMessage(err, "profile.addCollectibleFailed"));
      },
    });
  }
}
