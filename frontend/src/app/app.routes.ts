import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./features/dashboard/dashboard.component").then((m) => m.DashboardComponent),
  },
  // No app code ever links here (the root path "" is the actual dashboard
  // route) — this exists purely so a browser sitting on /home from a stale
  // bookmark/history entry lands on the dashboard instead of a router
  // "Cannot match any routes" error.
  { path: "home", redirectTo: "", pathMatch: "full" },
  {
    path: "news",
    loadComponent: () => import("./features/news/news").then((m) => m.NewsComponent),
  },
  {
    path: "schedule",
    loadComponent: () => import("./features/schedule/schedule").then((m) => m.ScheduleComponent),
  },
  {
    path: "games/:id",
    loadComponent: () => import("./features/game/game-detail").then((m) => m.GameDetailComponent),
  },
  {
    path: "predictions",
    loadComponent: () =>
      import("./features/predictions/predictions").then((m) => m.PredictionsComponent),
  },
  {
    path: "predictions-analytics",
    loadComponent: () =>
      import("./features/predictions-analytics/predictions-analytics").then(
        (m) => m.PredictionsAnalyticsComponent
      ),
  },
  {
    path: "store",
    loadComponent: () => import("./features/store/store").then((m) => m.StoreComponent),
  },
  {
    path: "stats",
    loadComponent: () =>
      import("./features/stats/advanced-stats").then((m) => m.AdvancedStatsComponent),
  },
  {
    path: "compare",
    loadComponent: () =>
      import("./features/compare/player-compare").then((m) => m.PlayerCompareComponent),
  },
  {
    path: "standings",
    loadComponent: () =>
      import("./features/standings/standings").then((m) => m.StandingsComponent),
  },
  {
    path: "analytics-builder",
    loadComponent: () =>
      import("./features/analytics-builder/analytics-builder").then((m) => m.AnalyticsBuilderComponent),
  },
  {
    path: "teams",
    loadComponent: () =>
      import("./features/teams/teams-hub").then((m) => m.TeamsHubComponent),
  },
  {
    path: "teams/:id",
    loadComponent: () =>
      import("./features/team/roster").then((m) => m.TeamRosterComponent),
  },
  {
    path: "players/:id",
    loadComponent: () =>
      import("./features/player/player-detail").then((m) => m.PlayerDetailComponent),
  },
  {
    path: "wheel",
    loadComponent: () => import("./features/wheel/wheel").then((m) => m.WheelComponent),
  },
  {
    path: "packs",
    loadComponent: () => import("./features/packs/packs").then((m) => m.PacksComponent),
  },
  {
    path: "inventory",
    loadComponent: () => import("./features/inventory/inventory").then((m) => m.InventoryComponent),
  },
  {
    path: "album",
    loadComponent: () => import("./features/album/album").then((m) => m.AlbumComponent),
  },
  {
    path: "album/:teamId",
    loadComponent: () => import("./features/album/album").then((m) => m.AlbumComponent),
  },
  {
    path: "trades",
    loadComponent: () => import("./features/trades/trades").then((m) => m.TradesComponent),
  },
  {
    path: "profile",
    loadComponent: () => import("./features/profile/profile").then((m) => m.ProfileComponent),
  },
  {
    path: "login",
    loadComponent: () => import("./features/auth/login.component").then((m) => m.LoginComponent),
  },
  {
    path: "register",
    loadComponent: () =>
      import("./features/auth/register.component").then((m) => m.RegisterComponent),
  },
];