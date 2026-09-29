import { Component, effect, inject, signal } from "@angular/core";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Announcement, AnnouncementInput } from "../../core/models";
import { ButtonDirective } from "../../shared/button.directive";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";

// Same list the backend validates against (routes/announcements.ts's
// ANNOUNCEMENT_ICONS) — keep the two in sync.
const ICONS: NavIconName[] = [
  "bell", "zap", "trophy", "star", "flame", "medal", "ball", "cards", "packs", "wheel",
  "picks", "schedule", "news", "teams", "trade", "share", "tip", "album", "vote",
];
const DEFAULT_TTL_DAYS = 14;

type Status = "live" | "scheduled" | "expired" | "off";

/** `<input type="datetime-local">` wants local "YYYY-MM-DDTHH:mm". */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "What's new" announcements editor (2026-09-29, "can i add announcements
 * from admin panel?") — a card on the admin Tools page. Writes to
 * routes/announcements.ts; the global toast (shared/whats-new.ts) shows each
 * logged-in user the newest live one they haven't seen, once. Both languages
 * are required, and the preview renders the toast exactly as users will see
 * it in either one.
 */
@Component({
  selector: "app-admin-announcements",
  standalone: true,
  imports: [ReactiveFormsModule, ButtonDirective, ConfirmDialogComponent, LogoSpinnerComponent, NavIconComponent],
  templateUrl: "./admin-announcements.html",
})
export class AdminAnnouncementsComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private fb = inject(FormBuilder);

  readonly icons = ICONS;
  readonly list = signal<Announcement[]>([]);
  readonly loading = signal(true);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  readonly previewLang = signal<"en" | "el">("en");
  readonly confirmingDelete = signal<Announcement | null>(null);

  readonly form = this.fb.nonNullable.group({
    titleEn: ["", [Validators.required, Validators.maxLength(400)]],
    titleEl: ["", [Validators.required, Validators.maxLength(400)]],
    bodyEn: ["", [Validators.required, Validators.maxLength(400)]],
    bodyEl: ["", [Validators.required, Validators.maxLength(400)]],
    link: [""],
    ctaEn: [""],
    ctaEl: [""],
    icon: ["bell" as string, [Validators.required]],
    publishAt: [""],
    expiresAt: [""],
    active: [true],
  });

  // The preview reads the form live; FormGroup values aren't signals, so
  // mirror them into one on every change.
  readonly draft = signal(this.form.getRawValue());

  private fetched = false;

  constructor() {
    this.resetForm();
    this.form.valueChanges.subscribe(() => this.draft.set(this.form.getRawValue()));
    // Same late-session-restore guard as admin-tools.ts.
    effect(() => {
      if (this.auth.currentUser()?.isAdmin && !this.fetched) {
        this.fetched = true;
        this.refresh();
      }
    });
  }

  private refresh(): void {
    this.api.getAllAnnouncements().subscribe({
      next: (rows) => {
        this.list.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  status(a: Announcement): Status {
    if (!a.active) return "off";
    const now = Date.now();
    if (Date.parse(a.publishAt) > now) return "scheduled";
    if (Date.parse(a.expiresAt) <= now) return "expired";
    return "live";
  }

  statusClass(s: Status): string {
    return {
      live: "bg-emerald-500/15 text-emerald-600",
      scheduled: "bg-sky-500/15 text-sky-600",
      expired: "bg-line text-muted",
      off: "bg-line text-muted",
    }[s];
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString(this.i18n.lang() === "el" ? "el-GR" : "en-GB", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }

  resetForm(): void {
    const now = new Date();
    this.form.reset({
      titleEn: "", titleEl: "", bodyEn: "", bodyEl: "", link: "", ctaEn: "", ctaEl: "",
      icon: "bell",
      publishAt: toLocalInput(now),
      expiresAt: toLocalInput(new Date(now.getTime() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000)),
      active: true,
    });
    this.editingId.set(null);
    this.error.set(null);
  }

  edit(a: Announcement): void {
    this.form.reset({
      titleEn: a.titleEn, titleEl: a.titleEl, bodyEn: a.bodyEn, bodyEl: a.bodyEl,
      link: a.link ?? "", ctaEn: a.ctaEn ?? "", ctaEl: a.ctaEl ?? "",
      icon: a.icon,
      publishAt: toLocalInput(new Date(a.publishAt)),
      expiresAt: toLocalInput(new Date(a.expiresAt)),
      active: a.active,
    });
    this.editingId.set(a.id);
    this.error.set(null);
    this.saved.set(false);
  }

  private toInput(): AnnouncementInput {
    const v = this.form.getRawValue();
    return {
      titleEn: v.titleEn, titleEl: v.titleEl, bodyEn: v.bodyEn, bodyEl: v.bodyEl,
      link: v.link.trim() || null, ctaEn: v.ctaEn.trim() || null, ctaEl: v.ctaEl.trim() || null,
      icon: v.icon,
      publishAt: new Date(v.publishAt).toISOString(),
      expiresAt: new Date(v.expiresAt).toISOString(),
      active: v.active,
    };
  }

  private errorMessage(err: unknown): string {
    const code = (err as { error?: { code?: string } } | undefined)?.error?.code;
    const key = code ? `admin.announceErr.${code}` : "";
    const translated = key ? this.i18n.t(key) : "";
    return translated && translated !== key ? translated : this.i18n.t("admin.announceErr.generic");
  }

  submit(): void {
    if (this.form.invalid || !this.form.value.publishAt || !this.form.value.expiresAt) return;
    this.saving.set(true);
    this.error.set(null);
    this.saved.set(false);
    const id = this.editingId();
    const req = id ? this.api.updateAnnouncement(id, this.toInput()) : this.api.createAnnouncement(this.toInput());
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        this.resetForm();
        this.refresh();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(this.errorMessage(err));
      },
    });
  }

  toggleActive(a: Announcement): void {
    const { id: _id, ...rest } = a;
    this.api.updateAnnouncement(a.id, { ...rest, active: !a.active }).subscribe({
      next: () => this.refresh(),
      error: (err) => this.error.set(this.errorMessage(err)),
    });
  }

  confirmDelete(): void {
    const a = this.confirmingDelete();
    this.confirmingDelete.set(null);
    if (!a) return;
    this.api.deleteAnnouncement(a.id).subscribe({
      next: () => {
        if (this.editingId() === a.id) this.resetForm();
        this.refresh();
      },
      error: (err) => this.error.set(this.errorMessage(err)),
    });
  }
}
