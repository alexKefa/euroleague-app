import { Injectable, signal } from "@angular/core";
import { Lang, translations } from "./i18n/translations";

const LANG_KEY = "clutch-lang";

@Injectable({ providedIn: "root" })
export class I18nService {
  readonly lang = signal<Lang>(this.loadLang());

  setLang(lang: Lang): void {
    this.lang.set(lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Private-browsing/storage-disabled — the choice still applies for
      // the current session, it just won't persist across reloads.
    }
  }

  t(key: string): string {
    const entry = translations[key];
    if (!entry) return key;
    return entry[this.lang()] ?? entry.en;
  }

  private loadLang(): Lang {
    try {
      return localStorage.getItem(LANG_KEY) === "el" ? "el" : "en";
    } catch {
      return "en";
    }
  }
}
