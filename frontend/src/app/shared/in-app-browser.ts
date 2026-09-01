// Facebook/Messenger, Instagram, Line, WeChat, and Snapchat all open a
// shared link inside their own locked-down in-app WebView rather than the
// device's real browser — no address bar, no browser menu, and (Instagram/
// Messenger specifically) no `beforeinstallprompt` either, so "Add to Home
// Screen" isn't offered at all until the visitor escapes to a real browser
// (see open-in-browser-banner.ts, and install-banner.ts's own use of this).
// There's no API to detect this directly — user-agent substring sniffing is
// the standard approach, since these are the exact markers each of those
// apps' own WebViews are known to leave in place. A false negative just
// means the nudge doesn't show, not a functional break.
const IN_APP_BROWSER_UA_PATTERN = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat/i;

export function isInAppBrowser(): boolean {
  return IN_APP_BROWSER_UA_PATTERN.test(navigator.userAgent || "");
}
