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

export type EmailLang = "en" | "el";

// Mirrors I18nService's own "el unless explicitly en" default (lang.ts) —
// the app itself defaults to Greek everywhere, this email should too. Kept
// as its own tiny dictionary rather than pulling from the frontend's
// translations.ts (that file is Angular-bundled, not importable from the
// backend) — just the handful of strings this one email needs.
const EMAIL_COPY: Record<EmailLang, { subject: string; heading: string; body: string; button: string; footer: string }> = {
  en: {
    subject: "Reset your Clutch password",
    heading: "Reset your password",
    body: "Someone requested a password reset for this Clutch account. If that was you, click the link below to choose a new password. This link expires in 1 hour.",
    button: "Reset password",
    footer: "If you didn't request this, you can safely ignore this email — your password won't change.",
  },
  el: {
    subject: "Επαναφορά του κωδικού σου στο Clutch",
    heading: "Επαναφορά κωδικού",
    body: "Κάποιος ζήτησε επαναφορά κωδικού για αυτόν τον λογαριασμό στο Clutch. Αν ήσουν εσύ, πάτησε τον παρακάτω σύνδεσμο για να επιλέξεις νέο κωδικό. Ο σύνδεσμος λήγει σε 1 ώρα.",
    button: "Επαναφορά κωδικού",
    footer: "Αν δεν το ζήτησες εσύ, μπορείς να αγνοήσεις αυτό το email — ο κωδικός σου δεν θα αλλάξει.",
  },
};

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
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>${copy.heading}</h2>
        <p>${copy.body}</p>
        <p><a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background: #FF6B35; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">${copy.button}</a></p>
        <p>${copy.footer}</p>
      </div>
    `,
  });
}
