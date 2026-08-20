import { Component, Input } from "@angular/core";

// Small logo + three-letter code, used anywhere a bare team code (PAN, OLY,
// ...) would otherwise stand alone — falls back to code-only if the team
// has no logoUrl, rather than showing a broken image.
@Component({
  selector: "app-team-badge",
  standalone: true,
  template: `
    <span class="inline-flex items-center gap-1.5">
      @if (logoUrl) {
        <img [src]="logoUrl" [alt]="code" class="h-5 w-5 object-contain shrink-0" />
      }
      <span>{{ code }}</span>
    </span>
  `,
})
export class TeamBadgeComponent {
  @Input({ required: true }) code!: string;
  @Input() logoUrl: string | null = null;
}
