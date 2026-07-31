import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./features/dashboard/dashboard.component").then((m) => m.DashboardComponent),
  },
  {
    path: "teams/:id",
    loadComponent: () =>
      import("./features/team/roster").then((m) => m.TeamRosterComponent),
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