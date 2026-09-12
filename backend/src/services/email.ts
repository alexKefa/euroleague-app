import { Resend } from "resend";

// Same "no-op without an API key, degrade quietly" posture as
// sync/oddsSync.ts's ODDS_API_KEY check — local dev has no reason to be
// blocked on a real Resend account, so a missing key just logs the reset
// link to the console instead of sending an email.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Resend's own shared sending domain — works without verifying a custom
// domain, which this app doesn't have yet (see CLAUDE.md's "TODO: custom
// domain"). Swap to a "Clutch <noreply@yourdomain>" address once that
// domain exists and is verified in the Resend dashboard. Note: Resend's
// sandbox mode (no verified domain) only actually delivers to the email
// address the Resend account itself was signed up with — every other
// recipient gets a 403 until a domain is verified.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "Clutch <onboarding@resend.dev>";

// Where the emailed link points — the frontend's own origin, not the API's.
// Defaults to local dev's ng serve port; set to the Railway URL in
// production. Trailing slash stripped defensively — a Railway var set as
// "https://host.app/" would otherwise produce a double-slash reset link.
const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:4200").replace(/\/+$/, "");

// The app's real PWA icon (frontend/public/icons/, same "C" mark as
// favicon-v7.svg) — reused as-is
// rather than duplicated as inline SVG, since email clients need a hosted
// raster image for reliable rendering (see the comment above the <img> tag
// below). Shares APP_BASE_URL's own "local dev has no publicly-reachable
// host" limitation — a local send embeds an unreachable localhost URL, same
// as the reset link itself already does; harmless since local sends are
// only ever for testing, not real users.
const LOGO_URL = `${APP_BASE_URL}/icons/icon-v7-192x192.png`;

// Same brand orange as the web app's login/register hero mark
// (login.component.html's inline SVG stroke="#FF6B35") — kept as a literal
// hex here rather than importing anything, since this HTML string is sent
// to Resend as-is and has no access to the frontend's CSS variables.
const BRAND_ORANGE = "#FF6B35";

export type EmailLang = "en" | "el";

// Mirrors I18nService's own "el unless explicitly en" default (lang.ts) —
// the app itself defaults to Greek everywhere, this email should too. Kept
// as its own tiny dictionary rather than pulling from the frontend's
// translations.ts (that file is Angular-bundled, not importable from the
// backend) — just the handful of strings this one email needs.
const EMAIL_COPY: Record<
  EmailLang,
  {
    subject: string;
    preheader: string;
    eyebrow: string;
    heading: string;
    body: string;
    button: string;
    fallbackNote: string;
    expiry: string;
    footer: string;
    ignoreNote: string;
  }
> = {
  en: {
    subject: "Reset your Clutch password",
    preheader: "Tap the button to choose a new password. This link expires in 1 hour.",
    eyebrow: "Password reset",
    heading: "Reset your password",
    body: "Someone requested a password reset for this Clutch account. If that was you, tap the button below to choose a new one.",
    button: "Reset password",
    fallbackNote: "Or paste this link into your browser:",
    expiry: "This link expires in 1 hour.",
    footer: "Clutch — your EuroLeague companion",
    ignoreNote: "Didn't request this? You can safely ignore this email — your password won't change.",
  },
  el: {
    subject: "Επαναφορά του κωδικού σου στο Clutch",
    preheader: "Πάτησε το κουμπί για να επιλέξεις νέο κωδικό. Ο σύνδεσμος λήγει σε 1 ώρα.",
    eyebrow: "Επαναφορά κωδικού",
    heading: "Επαναφορά κωδικού",
    body: "Κάποιος ζήτησε επαναφορά κωδικού για αυτόν τον λογαριασμό στο Clutch. Αν ήσουν εσύ, πάτησε το παρακάτω κουμπί για να επιλέξεις νέο κωδικό.",
    button: "Επαναφορά κωδικού",
    fallbackNote: "Ή αντέγραψε αυτόν τον σύνδεσμο στον browser σου:",
    expiry: "Ο σύνδεσμος λήγει σε 1 ώρα.",
    footer: "Clutch — ο σύντροφός σου στο EuroLeague",
    ignoreNote: "Δεν το ζήτησες εσύ; Μπορείς να αγνοήσεις αυτό το email — ο κωδικός σου δεν θα αλλάξει.",
  },
};

// Table-based layout with every style inlined — email clients (Outlook's
// Word rendering engine especially) don't reliably support flexbox/grid or
// a <style> block the way a browser does, so this deliberately doesn't
// reuse any of the web app's own CSS. A basketball emoji stands in for the
// isometric bar-mark logo (branding.md's SVG) — embedding real SVG/raster
// art in an email means hosting it somewhere and fighting image-blocking
// defaults in most mail clients, not worth it for one small mark. Dark
// card on a light neutral page background, colors all hardcoded rather
// than theme-reactive, since this renders inside the *recipient's* mail
// client, which has no idea about this app's light/dark toggle.
export function buildResetPasswordEmailHtml(lang: EmailLang, resetUrl: string): string {
  const copy = EMAIL_COPY[lang];
  return buildResetPasswordEmailHtmlFromCopy(copy, resetUrl);
}

function buildResetPasswordEmailHtmlFromCopy(copy: (typeof EMAIL_COPY)[EmailLang], resetUrl: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${copy.subject}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f2f1ee; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <!-- Preheader: hidden inbox-preview text, shown by most mail clients next to the subject line -->
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${copy.preheader}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f1ee;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

            <!-- Logo, above the card — the app's real mark (same PNG as the
                 PWA home-screen icon), not a placeholder emoji/wordmark.
                 Hosted, not inlined: email clients (Outlook especially)
                 don't render inline SVG reliably, but a plain <img> is
                 universally supported. -->
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <img src="${LOGO_URL}" width="56" height="56" alt="Clutch" style="display:block; border-radius:14px;" />
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background-color:#17161c; border-radius:24px; padding:36px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="padding-bottom:14px;">
                      <span style="display:inline-block; font-size:11px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${BRAND_ORANGE};">
                        ${copy.eyebrow}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-bottom:16px;">
                      <span style="font-size:22px; font-weight:800; color:#ffffff;">${copy.heading}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-bottom:26px;">
                      <p style="margin:0; font-size:14px; line-height:22px; color:#c7c5cf; text-align:center;">
                        ${copy.body}
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-bottom:22px;">
                      <a href="${resetUrl}"
                         style="display:inline-block; background-color:${BRAND_ORANGE}; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:13px 32px; border-radius:14px;">
                        ${copy.button}
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-bottom:6px;">
                      <p style="margin:0; font-size:11px; line-height:18px; color:#8b8993; text-align:center;">
                        ${copy.fallbackNote}
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-bottom:20px;">
                      <p style="margin:0; font-size:11px; line-height:18px; color:${BRAND_ORANGE}; text-align:center; word-break:break-all;">
                        <a href="${resetUrl}" style="color:${BRAND_ORANGE}; text-decoration:underline;">${resetUrl}</a>
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="border-top:1px solid #2b2a33; padding-top:18px;">
                      <p style="margin:0 0 6px 0; font-size:11px; line-height:17px; color:#8b8993; text-align:center;">
                        ${copy.expiry}
                      </p>
                      <p style="margin:0; font-size:11px; line-height:17px; color:#8b8993; text-align:center;">
                        ${copy.ignoreNote}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer, below the card -->
            <tr>
              <td align="center" style="padding-top:22px;">
                <p style="margin:0; font-size:11px; color:#a5a3ad;">${copy.footer}</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildResetPasswordEmailText(copy: (typeof EMAIL_COPY)[EmailLang], resetUrl: string): string {
  return `${copy.heading}\n\n${copy.body}\n\n${resetUrl}\n\n${copy.expiry}\n${copy.ignoreNote}`;
}

export async function sendPasswordResetEmail(to: string, token: string, lang: EmailLang = "el"): Promise<void> {
  const resetUrl = `${APP_BASE_URL}/reset-password?token=${token}`;
  const copy = EMAIL_COPY[lang];

  if (!resend) {
    console.log(`[email] RESEND_API_KEY not set — password reset link for ${to}: ${resetUrl}`);
    return;
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: copy.subject,
    html: buildResetPasswordEmailHtmlFromCopy(copy, resetUrl),
    text: buildResetPasswordEmailText(copy, resetUrl),
  });
}
