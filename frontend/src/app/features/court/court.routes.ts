import { Routes } from "@angular/router";

// Clutch Court. Three.js + Rapier load only through these lazy routes.
// /court/:code (multiplayer) arrives in M2.
export const COURT_ROUTES: Routes = [
  { path: "", redirectTo: "practice", pathMatch: "full" },
  {
    path: "practice",
    loadComponent: () => import("./court-page").then((m) => m.CourtPageComponent),
  },
];
