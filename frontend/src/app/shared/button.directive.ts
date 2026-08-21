import { Directive, HostBinding, Input } from "@angular/core";

export type ButtonVariant = "primary" | "outline" | "secondary";
export type ButtonSize = "sm" | "md";

// "Court Line" — the app's shared button styling, picked over two other
// directions via a side-by-side comparison (see the "Clutch Button
// Directions" design canvas). Keeps the rounded-full pill shape already
// used everywhere else in the app (nav icons, filter chips, team pickers)
// but gives it real depth: a raised gradient, a lit top edge, a
// color-matched glow — reads as tactile/pressable instead of a flat tag.
// An attribute directive rather than a wrapping component so the host stays
// a real <button>/<a> — routerLink, type="submit", [disabled], (click) all
// keep working unchanged; only the class list is swapped in.
const BASE = "inline-flex items-center justify-center gap-1.5 rounded-full font-mono font-bold transition-all disabled:opacity-40 disabled:pointer-events-none";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "text-white uppercase tracking-[0.04em] bg-[linear-gradient(180deg,#FF8558_0%,#FF6B35_45%,#E2551F_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_14px_rgba(255,107,53,0.35)] hover:brightness-110 active:scale-[0.97] disabled:shadow-none",
  outline:
    "text-highlight uppercase tracking-[0.04em] bg-highlight/10 border-[1.5px] border-highlight hover:bg-highlight/20 active:scale-[0.97]",
  secondary:
    "text-ink bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_3px_10px_rgba(0,0,0,0.5)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_4px_14px_rgba(0,0,0,0.6)] active:scale-[0.97]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "text-xs px-5 py-2.5",
  sm: "text-[11px] px-4 py-1.5",
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
