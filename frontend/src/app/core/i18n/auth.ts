import { Lang } from "./lang";

// Login + register pages. Shared words ("Log in", "Register") reuse the
// nav.* keys from chrome.ts instead of duplicating translations.
export const authTranslations: Record<string, Record<Lang, string>> = {
  "auth.emailPlaceholder": { en: "Email", el: "Email" },
  "auth.passwordPlaceholder": { en: "Password", el: "Κωδικός πρόσβασης" },
  "auth.passwordMinLengthPlaceholder": {
    en: "Password (min 8 characters)",
    el: "Κωδικός πρόσβασης (τουλάχιστον 8 χαρακτήρες)",
  },
  "auth.loggingIn": { en: "Logging in…", el: "Σύνδεση…" },
  "auth.noAccount": { en: "No account?", el: "Δεν έχεις λογαριασμό;" },

  "auth.createAccountTitle": { en: "Create an account", el: "Δημιουργία λογαριασμού" },
  "auth.referredBy": { en: "Referred by code", el: "Πρόσκληση με κωδικό" },
  "auth.favoriteTeamOptional": { en: "Favorite team (optional)", el: "Αγαπημένη ομάδα (προαιρετικό)" },
  "auth.creatingAccount": { en: "Creating account…", el: "Δημιουργία λογαριασμού…" },
  "auth.createAccountButton": { en: "Create account", el: "Δημιουργία λογαριασμού" },
  "auth.alreadyHaveAccount": { en: "Already have an account?", el: "Έχεις ήδη λογαριασμό;" },

  "auth.invalidCredentials": { en: "Invalid email or password.", el: "Λανθασμένο email ή κωδικός πρόσβασης." },
  "auth.emailExists": {
    en: "An account with that email already exists.",
    el: "Υπάρχει ήδη λογαριασμός με αυτό το email.",
  },
  "auth.genericError": { en: "Something went wrong.", el: "Κάτι πήγε στραβά." },
};
