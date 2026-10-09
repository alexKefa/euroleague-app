import { Component, ElementRef, OnDestroy, effect, inject, input, output, signal, untracked, viewChild } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { ThemeService } from "../core/theme.service";

// Minimal typing for the Google Identity Services script we use.
interface GoogleIdApi {
  initialize(config: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup" }): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisScript: Promise<void> | null = null;

function loadGis(): Promise<void> {
  gisScript ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisScript = null; // allow a retry on the next mount
      reject(new Error("Google sign-in script failed to load"));
    };
    document.head.appendChild(s);
  });
  return gisScript;
}

export type GoogleSignInResult = { created: boolean; promo: { packType: string; quantity: number; bonusPoints: number } | null };

/**
 * "Continue with Google" (2026-10-09), shared by Login and Register. Renders
 * nothing unless the backend reports a client id (GET /auth/config). Uses
 * Google's own rendered button (required by their branding rules), in the
 * app's language and colour scheme.
 */
@Component({
  selector: "app-google-sign-in-button",
  standalone: true,
  template: `
    @if (enabled()) {
      <div class="flex items-center gap-3 my-4" aria-hidden="true">
        <span class="h-px flex-1 bg-line"></span>
        <span class="text-[12px] text-muted font-semibold uppercase tracking-wider">{{ i18n.t('auth.orDivider') }}</span>
        <span class="h-px flex-1 bg-line"></span>
      </div>
      <div #slot class="flex justify-center min-h-[44px]" [class.opacity-50]="busy()"></div>
    }
  `,
})
export class GoogleSignInButtonComponent implements OnDestroy {
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private theme = inject(ThemeService);

  // "signup_with" on Register, "continue_with" on Login.
  readonly text = input<"continue_with" | "signup_with">("continue_with");
  readonly referralCode = input<string | null>(null);
  readonly promoCode = input<string | null>(null);

  readonly signedIn = output<GoogleSignInResult>();
  /** i18n key of the failure, for the host page's own error line. */
  readonly failed = output<string>();

  protected readonly enabled = signal(false);
  protected readonly busy = signal(false);
  private readonly slot = viewChild<ElementRef<HTMLDivElement>>("slot");
  private clientId: string | null = null;
  private destroyed = false;

  constructor() {
    this.auth.getAuthConfig().subscribe(({ googleClientId }) => {
      this.clientId = googleClientId;
      this.enabled.set(!!googleClientId);
    });

    // Render once the slot exists, and again when language or theme change.
    effect(() => {
      const el = this.slot()?.nativeElement;
      const lang = this.i18n.lang();
      const dark = this.theme.colorScheme() !== "light";
      if (!el || !this.clientId) return;
      untracked(() => this.render(el, lang, dark));
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  private render(el: HTMLElement, lang: string, dark: boolean): void {
    loadGis()
      .then(() => {
        const id = window.google?.accounts.id;
        if (!id || this.destroyed || !this.clientId) return;
        id.initialize({ client_id: this.clientId, callback: (r) => this.onCredential(r.credential), ux_mode: "popup" });
        el.replaceChildren();
        id.renderButton(el, {
          type: "standard",
          theme: dark ? "filled_black" : "outline",
          size: "large",
          shape: "pill",
          text: this.text(),
          locale: lang,
          width: Math.min(el.clientWidth || 320, 400),
        });
      })
      .catch(() => this.failed.emit("auth.googleFailed"));
  }

  private onCredential(credential: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.auth.googleSignIn(credential, this.referralCode(), this.promoCode()).subscribe({
      next: ({ created, promo }) => {
        this.busy.set(false);
        this.signedIn.emit({ created, promo });
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        const code = err.error?.code;
        this.failed.emit(code === "EMAIL_NOT_VERIFIED" || code === "NO_EMAIL" ? "auth.googleUnverified" : "auth.googleFailed");
      },
    });
  }
}
