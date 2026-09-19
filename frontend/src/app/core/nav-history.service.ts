import { Injectable, computed, inject, signal } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { filter } from "rxjs/operators";

const MAX_STACK = 50;

// Tracks the URLs this session has actually navigated through inside the
// app — not the raw browser history, which could include an external
// referrer or nothing at all on a fresh tab/shared link. Fixes a real
// class of bug across this app: a drill-down page (player detail, a team
// roster, a game, Compare, ...) is reachable from several different
// places, but its own "back" link used to hard-code a single assumed
// parent route in the template (e.g. player-detail always linked back to
// the player's own team roster, even for a visitor who arrived from the
// Injury Report, Stats, or Compare instead — reported live 2026-09-19).
// Every page's back-link now reads `previousUrl()` and falls back to its
// old fixed destination only when there's no real in-app previous page to
// return to (this session's first render, a refresh, or a shared link).
@Injectable({ providedIn: "root" })
export class NavHistoryService {
  private router = inject(Router);
  private readonly stack = signal<string[]>([]);

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.stack.update((s) => {
        const next = [...s, e.urlAfterRedirects];
        return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next;
      });
    });
  }

  readonly previousUrl = computed(() => {
    const s = this.stack();
    return s.length >= 2 ? s[s.length - 2] : null;
  });
}
