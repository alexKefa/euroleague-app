import { Injectable, effect, inject, signal, untracked } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { API_BASE_URL } from "./api-config";
import { AuthService } from "./auth.service";
import { I18nService } from "./i18n.service";
import { PUSH_SW_URL, browserSupportsPush, getPushSubscription } from "./push-subscription";

/**
 * on / off: can be toggled. denied: blocked in browser settings.
 * needs-install: iPhone/iPad Safari only allows push from the installed
 * (home-screen) app. unsupported: the browser has no push, or the server
 * has no VAPID keys configured.
 */
export type PushStatus = "loading" | "on" | "off" | "denied" | "needs-install" | "unsupported";

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Web push notifications (2026-10-05): lock reminders, round results, trade
 * offers and admin broadcasts (backend services/push.ts). The worker
 * (public/push-sw.js) only shows notifications; it doesn't cache anything.
 */
@Injectable({ providedIn: "root" })
export class PushService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private i18n = inject(I18nService);
  private router = inject(Router);

  readonly status = signal<PushStatus>("loading");
  readonly busy = signal(false);
  private publicKey: string | null = null;
  private configLoaded: Promise<void> | null = null;

  constructor() {
    if (browserSupportsPush()) {
      // A tapped notification while the app is already open (push-sw.js).
      navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { type?: string; url?: string } | null;
        if (data?.type === "push-navigate" && typeof data.url === "string" && data.url.startsWith("/")) {
          this.router.navigateByUrl(data.url);
        }
      });
    }

    // Logged in (or the language changed) with notifications already on:
    // re-send the subscription so the server has this device's owner and
    // language right.
    effect(() => {
      const authed = this.auth.isAuthenticated();
      const lang = this.i18n.lang();
      untracked(() => {
        if (authed) this.refresh(lang);
        else this.status.set("loading");
      });
    });
  }

  private loadConfig(): Promise<void> {
    this.configLoaded ??= firstValueFrom(this.http.get<{ enabled: boolean; publicKey: string | null }>(`${API_BASE_URL}/push/config`))
      .then((c) => {
        this.publicKey = c.enabled ? c.publicKey : null;
      })
      .catch(() => {
        this.configLoaded = null;
      });
    return this.configLoaded;
  }

  private async refresh(lang: "en" | "el"): Promise<void> {
    if (!browserSupportsPush()) {
      this.status.set(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    await this.loadConfig();
    if (!this.publicKey) {
      this.status.set("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      this.status.set("denied");
      return;
    }
    const sub = await getPushSubscription();
    if (sub && Notification.permission === "granted") {
      this.status.set("on");
      this.save(sub, lang).catch(() => {});
    } else {
      this.status.set("off");
    }
  }

  private save(sub: PushSubscription, lang: "en" | "el"): Promise<unknown> {
    const json = sub.toJSON();
    return firstValueFrom(this.http.post(`${API_BASE_URL}/push/subscribe`, { endpoint: json.endpoint, keys: json.keys, lang }));
  }

  /** Must run from a tap: browsers only show the permission prompt for a user gesture. */
  async enable(): Promise<void> {
    if (this.busy() || !browserSupportsPush()) return;
    this.busy.set(true);
    try {
      // Ask first, before any other await: iOS only honours the prompt while
      // the tap's user activation is still fresh.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        this.status.set(permission === "denied" ? "denied" : "off");
        return;
      }
      await this.loadConfig();
      if (!this.publicKey) {
        this.status.set("unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(this.publicKey) }));
      await this.save(sub, this.i18n.lang());
      this.status.set("on");
    } catch (err) {
      console.error("Enabling push failed:", err);
      this.status.set(Notification.permission === "denied" ? "denied" : "off");
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const sub = await getPushSubscription();
      if (sub) {
        await firstValueFrom(this.http.post(`${API_BASE_URL}/push/unsubscribe`, { endpoint: sub.endpoint })).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      this.status.set("off");
    } finally {
      this.busy.set(false);
    }
  }
}
