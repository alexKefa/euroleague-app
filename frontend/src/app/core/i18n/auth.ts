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

  "auth.usernamePlaceholder": { en: "Username (optional)", el: "Όνομα χρήστη (προαιρετικό)" },
  "auth.usernameHint": {
    en: "Shown on leaderboards, leagues, and trades. Leave blank and we'll generate one.",
    el: "Εμφανίζεται στις κατατάξεις, τις λίγκες και τις ανταλλαγές. Άσε το κενό για αυτόματη δημιουργία.",
  },
  "auth.usernameTaken": { en: "That username is already taken.", el: "Αυτό το όνομα χρήστη χρησιμοποιείται ήδη." },
  "auth.usernameInvalid": {
    en: "Username must be 3-20 characters: letters, numbers, and underscores only.",
    el: "Το όνομα χρήστη πρέπει να έχει 3-20 χαρακτήρες: γράμματα, αριθμούς και κάτω παύλα μόνο.",
  },

  "auth.createAccountTitle": { en: "Create an account", el: "Δημιουργία λογαριασμού" },
  "auth.referredBy": { en: "Referred by code", el: "Πρόσκληση με κωδικό" },
  "auth.promoCodeNote": { en: "Promo code", el: "Κωδικός προσφοράς" },
  "auth.promoCodeApplied": { en: "Promo code applied — a bonus pack is on its way!", el: "Ο κωδικός προσφοράς εφαρμόστηκε — έρχεται ένα δωρεάν πακέτο!" },
  "auth.favoriteTeamOptional": { en: "Favorite team (optional)", el: "Αγαπημένη ομάδα (προαιρετικό)" },
  "auth.creatingAccount": { en: "Creating account…", el: "Δημιουργία λογαριασμού…" },
  "auth.createAccountButton": { en: "Create account", el: "Δημιουργία λογαριασμού" },
  "auth.alreadyHaveAccount": { en: "Already have an account?", el: "Έχεις ήδη λογαριασμό;" },

  "auth.forgotPasswordLink": { en: "Forgot password?", el: "Ξέχασες τον κωδικό;" },
  "auth.forgotPasswordTitle": { en: "Reset your password", el: "Επαναφορά κωδικού" },
  "auth.forgotPasswordHint": {
    en: "Enter your email and we'll send you a link to reset your password.",
    el: "Γράψε το email σου και θα σου στείλουμε έναν σύνδεσμο για επαναφορά κωδικού.",
  },
  "auth.sendResetLink": { en: "Send reset link", el: "Αποστολή συνδέσμου" },
  "auth.sendingResetLink": { en: "Sending…", el: "Αποστολή…" },
  "auth.resetLinkSent": {
    en: "If that email is registered, a reset link is on its way — check your inbox.",
    el: "Αν αυτό το email είναι εγγεγραμμένο, ο σύνδεσμος επαναφοράς έρχεται — έλεγξε τα εισερχόμενά σου.",
  },
  "auth.backToLogin": { en: "Back to login", el: "Επιστροφή στη σύνδεση" },

  "auth.resetPasswordTitle": { en: "Choose a new password", el: "Επίλεξε νέο κωδικό" },
  "auth.newPasswordPlaceholder": { en: "New password (min 8 characters)", el: "Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)" },
  "auth.confirmPasswordPlaceholder": { en: "Confirm new password", el: "Επιβεβαίωση νέου κωδικού" },
  "auth.passwordsDontMatch": { en: "Passwords don't match.", el: "Οι κωδικοί δεν ταιριάζουν." },
  "auth.resetPassword": { en: "Reset password", el: "Επαναφορά κωδικού" },
  "auth.resettingPassword": { en: "Resetting…", el: "Γίνεται επαναφορά…" },
  "auth.resetPasswordSuccess": {
    en: "Password updated — you can now log in.",
    el: "Ο κωδικός ενημερώθηκε — μπορείς τώρα να συνδεθείς.",
  },
  "auth.resetLinkInvalid": {
    en: "This reset link is invalid or has expired.",
    el: "Αυτός ο σύνδεσμος επαναφοράς δεν ισχύει ή έχει λήξει.",
  },
  "auth.resetLinkMissing": {
    en: "This link is missing its reset token. Request a new one below.",
    el: "Αυτός ο σύνδεσμος δεν έχει token επαναφοράς. Ζήτησε έναν νέο παρακάτω.",
  },

  "auth.invalidCredentials": { en: "Invalid email or password.", el: "Λανθασμένο email ή κωδικός πρόσβασης." },
  "auth.emailExists": {
    en: "An account with that email already exists.",
    el: "Υπάρχει ήδη λογαριασμός με αυτό το email.",
  },
  "auth.genericError": { en: "Something went wrong.", el: "Κάτι πήγε στραβά." },
};
