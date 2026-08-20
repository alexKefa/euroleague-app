import { Component, Input } from "@angular/core";

/** A sealed trading-card-pack glyph — angled foil flap + a rip-tab seal, distinct from nav-icon's "store" bag shape. */
@Component({
  selector: "app-pack-icon",
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none">
      <path d="M6.5 8L8 5h8l1.5 3" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <rect x="5" y="8" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="2" />
      <path d="M12 11.5v4M9.5 13.5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `,
})
export class PackIconComponent {
  @Input() size = 20;
}
