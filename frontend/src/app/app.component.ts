import { Component, OnInit, inject } from "@angular/core";
import { RouterOutlet, RouterLink, RouterLinkActive } from "@angular/router";
import { AuthService } from "./core/auth.service";
import { NavIconComponent, NavIconName } from "./shared/nav-icon";

interface NavLink {
  path: string;
  label: string;
  icon: NavIconName;
  exact?: boolean;
}

const NAV_LINKS: NavLink[] = [
  { path: "/", label: "Home", icon: "home", exact: true },
  { path: "/news", label: "News", icon: "news" },
  { path: "/predictions", label: "Picks", icon: "picks" },
  { path: "/store", label: "Store", icon: "store" },
];

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NavIconComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit {
  protected auth = inject(AuthService);
  protected readonly navLinks = NAV_LINKS;

  ngOnInit(): void {
    this.auth.restoreSession().subscribe();
  }

  logout(): void {
    this.auth.logout().subscribe();
  }
}
