import { CanDeactivateFn } from "@angular/router";
import type { AnalyticsBuilderComponent } from "./analytics-builder";

// Asks before leaving the builder with unsaved workspace changes. Opening a
// player from the table doesn't ask: the workspace is kept for this tab
// (BuilderStore's session snapshot) and comes back with the back button.
export const unsavedBuilderChanges: CanDeactivateFn<AnalyticsBuilderComponent> = (component, _route, _state, next) =>
  next?.url.startsWith("/players/") ? true : component.requestLeave();
