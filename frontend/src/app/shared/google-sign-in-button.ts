import { Component, OnDestroy, inject, input, output, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { AuthService } from "../core/auth.service";
import { I18nService } from "../core/i18n.service";
import { ButtonDirective } from "./button.directive";

// Minimal typing for the Google Identity Services OAuth token client.
interface TokenResponse {
  access_token?: string;
  error?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleOAuth2Api {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string }) => void;
  }): TokenClient;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2Api } };
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
 * "Continue with Google" (2026-10-09), shared by Login and Register. Our own
 * button (2026-10-09, "make it fully custom like our buttons") with Google's
 * "G" mark: it opens Google's account picker through the OAuth token
 * client, and the backend checks the access token with Google. Renders
 * nothing unless the backend reports a client id (GET /auth/config).
 */
@Component({
  selector: "app-google-sign-in-button",
  standalone: true,
  imports: [ButtonDirective],
  template: `
    @if (enabled()) {
      <div class="flex items-center gap-3 my-4" aria-hidden="true">
        <span class="h-px flex-1 bg-line"></span>
        <span class="text-[12px] text-muted font-semibold uppercase tracking-wider">{{ i18n.t('auth.orDivider') }}</span>
        <span class="h-px flex-1 bg-line"></span>
      </div>
      <button
        type="button"
        appButton="outline"
        class="w-full !h-12 !rounded-2xl text-base gap-2.5"
        [disabled]="busy() || !ready()"
        (click)="start()"
      >
        <svg class="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{{ busy() ? i18n.t('auth.googleWorking') : i18n.t(text() === 'signup' ? 'auth.googleSignUp' : 'auth.googleContinue') }}</span>
      </button>
    }
  `,
})
export class GoogleSignInButtonComponent implements OnDestroy {
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);

  // "signup" on Register, "continue" on Login.
  readonly text = input<"continue" | "signup">("continue");
  readonly referralCode = input<string | null>(null);
  readonly promoCode = input<string | null>(null);

  readonly signedIn = output<GoogleSignInResult>();
  /** i18n key of the failure, for the host page's own error line. */
  readonly failed = output<string>();

  protected readonly enabled = signal(false);
  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  private tokenClient: TokenClient | null = null;
  private destroyed = false;

  constructor() {
    this.auth.getAuthConfig().subscribe(({ googleClientId }) => {
      if (!googleClientId) return;
      this.enabled.set(true);
      // Load now, not on click: the popup has to open inside the tap itself
      // or browsers block it.
      loadGis()
        .then(() => {
          const oauth2 = window.google?.accounts.oauth2;
          if (!oauth2 || this.destroyed) return;
          this.tokenClient = oauth2.initTokenClient({
            client_id: googleClientId,
            scope: "openid email profile",
            callback: (r) => this.onToken(r),
            // Closing the popup isn't an error worth showing.
            error_callback: (e) => {
              this.busy.set(false);
              if (e?.type && e.type !== "popup_closed") this.failed.emit("auth.googleFailed");
            },
          });
          this.ready.set(true);
        })
        .catch(() => this.failed.emit("auth.googleFailed"));
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  protected start(): void {
    if (!this.tokenClient || this.busy()) return;
    this.busy.set(true);
    this.tokenClient.requestAccessToken();
  }

  private onToken(r: TokenResponse): void {
    if (!r.access_token) {
      this.busy.set(false);
      if (r.error && r.error !== "access_denied") this.failed.emit("auth.googleFailed");
      return;
    }
    this.auth.googleSignIn(r.access_token, this.referralCode(), this.promoCode()).subscribe({
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
