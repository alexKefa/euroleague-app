import { Component } from "@angular/core";

// Bare decorative half-court backdrop for the Fantasy Five lineup builder —
// same hand-rolled-SVG approach and geometry as shot-chart.ts (viewBox
// 320x210, 1 unit = 5cm, FIBA-approximate key/arc/restricted-area), just
// without the shot markers, zone legend, or player-photo watermark, since
// here the "markers" are the draggable player slots overlaid on top by the
// caller (frontend/src/app/features/fantasy/fantasy.html) as real HTML
// elements, not SVG nodes — Angular CDK's drag-drop needs actual DOM
// elements to attach to, not raw SVG shapes, so this component stays
// purely decorative and pointer-events-none; the interactive slots are a
// sibling absolutely-positioned overlay, not children of this SVG.
@Component({
  selector: "app-court-background",
  standalone: true,
  template: `
    <svg viewBox="0 0 320 210" class="w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid meet">
      <path [attr.d]="courtOutlinePath" fill="none" class="stroke-line" stroke-width="1.5" />
      <rect
        [attr.x]="keyLeftX"
        [attr.y]="freeThrowLineY"
        [attr.width]="keyWidth"
        [attr.height]="keyHeight"
        fill="none"
        class="stroke-line"
        stroke-width="1.5"
      />
      <circle [attr.cx]="basketX" [attr.cy]="freeThrowLineY" [attr.r]="freeThrowCircleRadius" fill="none" class="stroke-line" stroke-width="1.5" />
      <path [attr.d]="restrictedAreaPath" fill="none" class="stroke-line" stroke-width="1.2" />
      <path [attr.d]="threePointArcPath" fill="none" class="stroke-line" stroke-width="1.5" />
      <line [attr.x1]="backboardX1" [attr.x2]="backboardX2" [attr.y1]="backboardY" [attr.y2]="backboardY" class="stroke-ink" stroke-width="2" />
      <circle
        [attr.cx]="basketX"
        [attr.cy]="basketY"
        [attr.r]="rimRadius"
        fill="none"
        class="stroke-highlight"
        stroke-width="1.6"
        style="filter: drop-shadow(0 0 3px rgba(255, 107, 53, 0.5))"
      />
    </svg>
  `,
})
export class CourtBackgroundComponent {
  // --- Court geometry, copied from shot-chart.ts (kept in sync by hand —
  // see that file's own comment on where these FIBA-approximate numbers
  // come from) ---
  readonly basketX = 160;
  readonly basketY = 185;
  readonly baselineY = 210;
  readonly backboardY = this.basketY + 3;
  readonly backboardX1 = this.basketX - 18;
  readonly backboardX2 = this.basketX + 18;
  readonly rimRadius = 4.5;

  readonly restrictedAreaRadius = 25;
  readonly restrictedAreaLeftX = this.basketX - this.restrictedAreaRadius;
  readonly restrictedAreaRightX = this.basketX + this.restrictedAreaRadius;

  readonly keyHalfWidth = 49;
  readonly keyLeftX = this.basketX - this.keyHalfWidth;
  readonly keyWidth = this.keyHalfWidth * 2;
  readonly freeThrowLineY = 96;
  readonly keyHeight = this.baselineY - this.freeThrowLineY;
  readonly freeThrowCircleRadius = 18;

  readonly threePointRadius = 135;
  readonly threePointCornerX = this.basketX + 132;
  private readonly cornerArcMeetY = Math.sqrt(this.threePointRadius ** 2 - 132 ** 2);
  readonly threePointArcTopY = this.basketY - this.cornerArcMeetY;
  readonly threePointLeftCornerX = this.basketX - 132;

  readonly courtOutlinePath = `
    M 6 ${this.baselineY}
    L 6 6
    L 314 6
    L 314 ${this.baselineY}
  `;

  readonly threePointArcPath = `
    M ${this.threePointLeftCornerX} ${this.baselineY}
    L ${this.threePointLeftCornerX} ${this.threePointArcTopY}
    A ${this.threePointRadius} ${this.threePointRadius} 0 0 1 ${this.threePointCornerX} ${this.threePointArcTopY}
    L ${this.threePointCornerX} ${this.baselineY}
  `;

  readonly restrictedAreaPath = `M ${this.restrictedAreaLeftX} ${this.basketY} A ${this.restrictedAreaRadius} ${this.restrictedAreaRadius} 0 0 1 ${this.restrictedAreaRightX} ${this.basketY}`;
}
