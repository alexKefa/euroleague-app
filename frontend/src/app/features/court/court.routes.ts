import { Routes } from "@angular/router";

// Clutch Court. Three.js, Rapier and the Colyseus SDK load only through
// these lazy routes (the hub itself pulls none of them).
export const COURT_ROUTES: Routes = [
  {
    path: "",
    pathMatch: "full",
    loadComponent: () => import("./court-hub").then((m) => m.CourtHubComponent),
  },
  {
    path: "practice",
    loadComponent: () => import("./court-page").then((m) => m.CourtPageComponent),
  },
  {
    path: ":code",
    loadComponent: () => import("./court-page").then((m) => m.CourtPageComponent),
  },
];
