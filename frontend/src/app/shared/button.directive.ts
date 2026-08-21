import { Directive, HostBinding, Input } from "@angular/core";

export type ButtonVariant = "primary" | "outline" | "secondary" | "danger";
export type ButtonSize = "sm" | "md";

// "Scoreboard" — the app's shared button styling, replacing the earlier
// "Court Line" gradient pill (picked over three other directions via a
// side-by-side comparison — see the "Button Directions" design canvas).
// Flat rectangles instead of pills, a hard bottom edge on primary instead of
// a soft glow, uppercase Rajdhani (the app's display font) instead of mono —
// reads like a stat panel rather than a rounded chip. An attribute directive
// rather than a wrapping component so the host stays a real <button>/<a> —
// routerLink, type="submit", [disabled], (click) all keep working
// unchanged; only the class list is swapped in.
const BASE = "inline-flex items-center justify-center gap-1.5 rounded-[5px] font-display font-bold uppercase tracking-[0.03em] transition-all disabled:opacity-35 disabled:pointer-events-none";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "text-white bg-highlight border-b-[3px] border-b-highlight-dim hover:bg-[#FF7D4E] disabled:border-b-transparent",
  outline:
    "text-highlight bg-highlight/10 border-2 border-highlight hover:bg-highlight/20",
  secondary:
    "text-ink bg-transparent border-2 border-line hover:border-[#3a3a3b]",
  danger:
    "text-ink bg-transparent border-2 border-line hover:border-red-500 hover:bg-red-500/10 hover:text-red-500",
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
