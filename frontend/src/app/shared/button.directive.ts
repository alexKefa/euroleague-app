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

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // The bottom border is a raised 3D "lip" (the Scoreboard button's whole
  // identity) — pressing it collapses the lip and drops the button down to
  // fill the gap, like a real chunky button being pushed into its socket,
  // instead of just scaling like the flatter variants below.
  primary:
    "text-white bg-highlight border-b-[3px] border-b-highlight-dim hover:bg-[#FF7D4E] active:translate-y-[3px] active:border-b-0 disabled:border-b-transparent",
  outline:
    "text-highlight bg-highlight/10 border-2 border-highlight hover:bg-highlight/20 active:bg-highlight/25",
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
