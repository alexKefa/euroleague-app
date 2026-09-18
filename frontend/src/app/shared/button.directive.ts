import { Directive, HostBinding, Input } from "@angular/core";

export type ButtonVariant = "primary" | "outline" | "secondary" | "danger";
export type ButtonSize = "sm" | "md";

// "Scoreboard" — the app's shared button styling, replacing the earlier
// "Court Line" gradient pill (picked over three other directions via a
// side-by-side comparison — see the "Button Directions" design canvas).
// Flat rectangles instead of pills, a hard bottom edge on primary instead of
// a soft glow, the app's display font instead of mono — reads
// like a stat panel rather than a rounded chip. Sentence case, not
// uppercase — all-caps across every button in the app read as cheap. An
// attribute directive
// rather than a wrapping component so the host stays a real <button>/<a> —
// routerLink, type="submit", [disabled], (click) all keep working
// unchanged; only the class list is swapped in.
// active:scale-[0.97] gives every variant a tactile "pressed" nudge on
// click/tap; duration-100 (overriding transition-all's slower default) so
// the press itself reads instant while hover/color changes stay smooth.
const BASE = "inline-flex items-center justify-center gap-1.5 rounded-2xl font-display font-bold transition-all duration-150 active:duration-100 active:scale-[0.97] disabled:opacity-35 disabled:pointer-events-none";

// primary/outline switched from the fixed bg-highlight brand orange to the
// user's own team color (2026-09-18, explicit ask: "change everywhere on
// the app the default orange color with the preferred team... go for it")
// — this is the app's single most-used CTA style (login, register, submit,
// every primary action), so it's the highest-impact swap in that pass.
// text-white -> text-team-secondary on primary is not cosmetic, it's a
// contrast fix: some teams' primary color is near-white (Real Madrid,
// Dubai Basketball), and white text on a near-white fill would be
// unreadable — team-secondary is each team's own chosen contrast color,
// so it's built to read against team-primary already. border-b-highlight-
// dim (the "lip" shade) has no team-color-dim token, so it's approximated
// with border-b-team-primary/60 — translucent team-primary blended against
// the page's own dark background reads as a dimmer shade, same technique
// used on inventory.html's/teams-hub.html's tiles earlier this session.
// hover:bg-[#FF7D4E] (a hardcoded lighten of the fixed orange) likewise has
// no team equivalent — hover:brightness-110 gives the same "lighten on
// hover" feel relative to whatever the fill color actually is.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // The bottom border is a raised 3D "lip" (the Scoreboard button's whole
  // identity) — pressing it collapses the lip and drops the button down to
  // fill the gap, like a real chunky button being pushed into its socket,
  // instead of just scaling like the flatter variants below.
  primary:
    "text-team-secondary bg-team-primary border-b-[3px] border-b-team-primary/60 hover:brightness-110 active:translate-y-[3px] active:border-b-0 disabled:border-b-transparent",
  outline:
    "text-team-primary bg-team-primary/10 border-2 border-team-primary hover:bg-team-primary/20 active:bg-team-primary/25",
  secondary:
    "text-ink bg-transparent border-2 border-line hover:border-[#3a3a3b] active:bg-white/5",
  danger:
    "text-ink bg-transparent border-2 border-line hover:border-red-500 hover:bg-red-500/10 hover:text-red-500 active:bg-red-500/15 active:border-red-500 active:text-red-500",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "text-sm px-5 py-2.5",
  sm: "text-xs px-4 py-1.5",
};

@Directive({
  selector: "[appButton]",
  standalone: true,
})
export class ButtonDirective {
  // "" is a real value here, not just a type-checking workaround: a bare
  // `appButton` attribute (no `="..."`, used for the default primary style)
  // binds the empty string to this same-named Input, which strict template
  // checking rejects unless "" is part of the declared type.
  @Input("appButton") variant: ButtonVariant | "" = "primary";
  @Input() appButtonSize: ButtonSize = "md";

  @HostBinding("class")
  get classes(): string {
    const variant = this.variant || "primary";
    return `${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[this.appButtonSize]}`;
  }
}
