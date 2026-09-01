import { Component, OnInit, OnDestroy, inject, signal } from "@angular/core";
import { I18nService } from "../core/i18n.service";
import { NavIconComponent } from "./nav-icon";
import { ButtonDirective } from "./button.directive";
import { isInAppBrowser } from "./in-app-browser";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallPlatform = "ios" | "android";

const DISMISS_KEY = "clutch-install-banner-dismissed-until";
const VISIT_COUNT_KEY = "clutch-visit-count";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks
const SHOW_DELAY_MS = 3500; // let the splash screen settle first
// Never nag on the very first visit — this is a "you've been using this a
// bit" nudge, not a landing-page popup. Bypassed for a "high-intent"
// arrival (see isHighIntentArrival) — a visitor who just tapped
// open-in-browser-banner.ts's "Open in Browser" from Messenger/Instagram
// landed here specifically *to* install, on a real Safari/Chrome tab whose
// localStorage never saw the in-app WebView's own (separate, sandboxed)
// visit count. Making them come back a 2nd time to see this would silently
// defeat the whole point of that other banner.
const MIN_VISITS_BEFORE_SHOWING = 2;

/**
 * A dismissible "add to home screen" nudge for iOS Safari / Android Chrome
 * — neither platform lets an installed-but-unopened web app be told apart
 * from "never visited", so this leans entirely on localStorage (visit
 * count + a dismiss cooldown) plus feature detection (standalone-mode,
 * `beforeinstallprompt`) to decide whether to show at all.
 *
 * Deliberately doesn't depend on a service worker — Chrome's native
 * `beforeinstallprompt` normally wants one to consider the app installable,
 * but this app doesn't ship one (see app.component.ts's
 * unregisterStaleServiceWorker comment for why), so Android almost always
 * falls back to the same manual numbered-steps panel as iOS rather than a
 * one-tap native install button. If `beforeinstallprompt` does fire (e.g.
 * a service worker gets added later), the native button path still works
 * unmodified.
 */
@Component({
  selector: "app-install-banner",
  standalone: true,
  imports: [NavIconComponent, ButtonDirective],
  templateUrl: "./install-banner.html",
})
export class InstallBannerComponent implements OnInit, OnDestroy {
  protected i18n = inject(I18nService);

  readonly visible = signal(false);
  readonly expanded = signal(false);
  readonly platform = signal<InstallPlatform | null>(null);
  readonly hasNativePrompt = signal(false);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.deferredPrompt = event as BeforeInstallPromptEvent;
    this.hasNativePrompt.set(true);
  };

  private readonly onAppInstalled = (): void => {
    this.hide(true);
  };

  ngOnInit(): void {
    if (this.isStandalone()) return;
    // Its "tap the Share icon" / "tap the menu icon" steps assume a real
    // browser's own chrome — inside Messenger's/Instagram's in-app WebView
    // neither exists, so those steps would just be wrong. open-in-browser-
    // banner.ts (shown page-locally on referral/promo links) is the
    // correct nudge for that context: escape to a real browser first.
    if (isInAppBrowser()) return;

    const platform = this.detectPlatform();
    if (!platform) return;
    this.platform.set(platform);

    window.addEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    window.addEventListener("appinstalled", this.onAppInstalled);

    const highIntent = this.isHighIntentArrival();

    try {
      const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (Date.now() < dismissedUntil) return;

      const visits = Number(localStorage.getItem(VISIT_COUNT_KEY) ?? 0) + 1;
      localStorage.setItem(VISIT_COUNT_KEY, String(visits));
      if (visits < MIN_VISITS_BEFORE_SHOWING && !highIntent) return;
    } catch {
      // Private browsing / storage disabled — no memory of past visits or
      // dismissals, so it just shows every time. Not worth failing over.
    }

    setTimeout(() => this.visible.set(true), SHOW_DELAY_MS);
  }

  ngOnDestroy(): void {
    window.removeEventListener("beforeinstallprompt", this.onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", this.onAppInstalled);
  }

  private isStandalone(): boolean {
    return (
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  }

  // Landed on the register page with a ?ref=/?promo= link — the exact
  // shape open-in-browser-banner.ts targets on the way *out* of Messenger/
  // Instagram. If they're here at all in a real browser, they either
  // followed that banner's instructions or opened the link directly in
  // Safari/Chrome to begin with; either way this is a deliberate visit
  // worth treating as install-ready immediately, not "just passing through".
  private isHighIntentArrival(): boolean {
    if (!location.pathname.startsWith("/register")) return false;
    const params = new URLSearchParams(location.search);
    return params.has("ref") || params.has("promo");
  }

  private detectPlatform(): InstallPlatform | null {
    const ua = navigator.userAgent;
    // iPadOS 13+ reports its UA as a plain "Macintosh" — multi-touch support
    // is the only reliable way left to tell it apart from an actual Mac.
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (isIOS) return "ios";
    if (/android/i.test(ua)) return "android";
    return null;
  }

  showSteps(): void {
    this.expanded.set(true);
  }

  async install(): Promise<void> {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.hasNativePrompt.set(false);
    this.hide(false);
  }

  dismiss(): void {
    this.hide(false);
  }

  private hide(installed: boolean): void {
    this.visible.set(false);
    this.expanded.set(false);
    try {
      // An actual install means "done" — back off effectively forever,
      // rather than the same cooldown a plain dismiss gets.
      const cooldown = installed ? DISMISS_COOLDOWN_MS * 100 : DISMISS_COOLDOWN_MS;
      localStorage.setItem(DISMISS_KEY, String(Date.now() + cooldown));
    } catch {
      // Not persisted — it may reappear next visit, not worth failing over.
    }
  }
}
