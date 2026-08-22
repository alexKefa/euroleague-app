import { Component, Input } from "@angular/core";

// A spinning basketball for inline "working…" states — same seam-lined
// ball glyph as nav-icon.ts's "ball" case (the dashboard points-hint icon,
// the wheel's hub), just standalone and spun via CSS instead of static, so
// a busy button reads as "this app" rather than a generic ellipsis.
@Component({
  selector: "app-ball-spinner",
  standalone: true,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      class="animate-spin"
      style="animation-duration: 0.7s"
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.1" />
      <path
        d="M12 3.5v17M3.5 12h17M6 6c2 2 2 10-0.5 12M18 6c-2 2-2 10 0.5 12"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  `,
})
export class BallSpinnerComponent {
  @Input() size = 14;
}
