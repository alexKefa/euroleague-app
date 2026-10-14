import { CanDeactivateFn } from "@angular/router";
import type { AnalyticsBuilderComponent } from "./analytics-builder";

// Asks before leaving the builder with unsaved workspace changes.
export const unsavedBuilderChanges: CanDeactivateFn<AnalyticsBuilderComponent> = (component) => component.requestLeave();
