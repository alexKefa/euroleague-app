import { bootstrapApplication } from "@angular/platform-browser";
import { registerLocaleData } from "@angular/common";
import localeEl from "@angular/common/locales/el";
import { appConfig } from "./app/app.config";
import { AppComponent } from "./app/app.component";

// Needed for the `date` pipe to format news timestamps in Greek (day-first,
// 24h clock, Greek month names) when the app's language is set to Greek —
// Angular throws at runtime if a locale is passed to `date` without its
// data registered first. en-US needs no registration, it's the built-in default.
registerLocaleData(localeEl);

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
