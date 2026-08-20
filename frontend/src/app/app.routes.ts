import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./features/dashboard/dashboard.component").then((m) => m.DashboardComponent),
  },
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
    path: "store",
    loadComponent: () => import("./features/store/store").then((m) => m.StoreComponent),
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